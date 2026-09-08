import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { NetworkConfig } from './config';
import { SafeError } from './errors';
import { Limiter } from './limit';

/** A pooled keep-alive socket reset by the peer before any response arrived.
 * Node documents that servers may close idle pooled connections; a request
 * written to such a stale socket fails with ECONNRESET and `reusedSocket`
 * set. Only that exact transport condition is eligible for one retry. */
class StaleSocketReset extends Error {}

export class CoreClient {
  private limiter: Limiter;
  private id = 0;
  private agent: http.Agent | https.Agent;
  /** Aborted by close() so every in-flight attempt is cancelled promptly,
   * including fresh non-pooled retry sockets that the agent does not own. */
  private lifetime = new AbortController();
  private closed = false;
  constructor(private readonly config: NetworkConfig) {
    this.limiter = new Limiter(config.coreConcurrency, config.corePending, config.queueTimeoutMs);
    const options = {
      keepAlive: true,
      maxSockets: config.coreConcurrency,
      maxFreeSockets: config.coreConcurrency,
    };
    this.agent = config.coreUrl.startsWith('https:')
      ? new https.Agent(options)
      : new http.Agent(options);
  }
  async call(method: string, params: unknown[], signal?: AbortSignal): Promise<unknown> {
    return this.limiter.run(async () => {
      if (this.closed) throw new SafeError('Server is shutting down', 503);
      if (!this.config.coreCookieFile && (!this.config.coreUser || !this.config.corePassword))
        throw new SafeError('Bitcoin RPC is not configured; demo workspaces remain available', 503);
      const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
      const combined = AbortSignal.any(
        signal ? [signal, timeout, this.lifetime.signal] : [timeout, this.lifetime.signal],
      );
      let auth: string;
      try {
        auth = this.config.coreCookieFile
          ? (
              await readFile(this.config.coreCookieFile, { encoding: 'utf8', signal: combined })
            ).trim()
          : `${this.config.coreUser}:${this.config.corePassword}`;
      } catch {
        throw new SafeError('Bitcoin RPC authentication unavailable');
      }
      if (
        this.config.coreCookieFile &&
        (Buffer.byteLength(auth) > 4096 || !/^[^:\s]+:[^\s]+$/.test(auth))
      )
        throw new SafeError('Bitcoin RPC authentication cookie is malformed');
      const id = ++this.id;
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      try {
        let text: string;
        try {
          text = await this.post(auth, body, combined, this.agent);
        } catch (error) {
          // One bounded retry, on a fresh non-pooled socket, only when a stale
          // keep-alive connection was reset before any response. The retry
          // keeps the same overall deadline and limiter slot, and its own
          // failure is final: no recursion, no further attempts.
          if (!(error instanceof StaleSocketReset) || combined.aborted || this.closed) throw error;
          text = await this.post(auth, body, combined, false);
        }
        const value = JSON.parse(text);
        if (!value || value.id !== id || typeof value !== 'object')
          throw new SafeError('Invalid Bitcoin RPC response');
        if (value.error) throw new SafeError('Bitcoin RPC rejected the request');
        if (!Object.hasOwn(value, 'result')) throw new SafeError('Invalid Bitcoin RPC response');
        return value.result;
      } catch (error) {
        if (error instanceof SafeError) throw error;
        if (combined.aborted)
          throw new SafeError('Bitcoin RPC request timed out or was cancelled', 504);
        throw new SafeError('Bitcoin RPC connection failed');
      }
    }, signal);
  }
  /** One HTTP attempt. `agent: false` forces a fresh non-pooled socket. */
  private post(
    auth: string,
    body: string,
    combined: AbortSignal,
    agent: http.Agent | https.Agent | false,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const url = new URL(this.config.coreUrl);
      const transport = url.protocol === 'https:' ? https : http;
      let responded = false;
      const request = transport.request(
        url,
        {
          method: 'POST',
          signal: combined,
          agent,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            authorization: `Basic ${Buffer.from(auth).toString('base64')}`,
          },
        },
        (response) => {
          responded = true;
          clearTimeout(connectTimer);
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > this.config.maxResponseBytes) {
              reject(new SafeError('Upstream response exceeds configured size limit', 413));
              request.destroy();
              response.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () => {
            if (response.statusCode === 401 || response.statusCode === 403) {
              reject(new SafeError('Bitcoin RPC authentication failed'));
              return;
            }
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              reject(new SafeError('Bitcoin RPC request failed'));
              return;
            }
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        },
      );
      const connectTimer = setTimeout(() => {
        reject(new SafeError('Bitcoin RPC connection timed out', 504));
        request.destroy();
      }, this.config.connectTimeoutMs);
      request.once('socket', (socket) => {
        if (!socket.connecting) clearTimeout(connectTimer);
        else
          socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () =>
            clearTimeout(connectTimer),
          );
      });
      request.on('error', (error) => {
        clearTimeout(connectTimer);
        reject(
          !responded &&
            (error as NodeJS.ErrnoException).code === 'ECONNRESET' &&
            request.reusedSocket
            ? new StaleSocketReset()
            : error,
        );
      });
      request.end(body);
    });
  }
  async chainInfo(signal?: AbortSignal): Promise<{ chain: string; blocks: number }> {
    const info = (await this.call('getblockchaininfo', [], signal)) as {
      chain?: unknown;
      blocks?: unknown;
    } | null;
    if (!info || info.chain !== (this.config.network === 'mainnet' ? 'main' : 'testnet4'))
      throw new SafeError('Bitcoin RPC network does not match the configured network', 503);
    if (!Number.isSafeInteger(info.blocks) || Number(info.blocks) < 0)
      throw new SafeError('Invalid Bitcoin chain status');
    return info as { chain: string; blocks: number };
  }
  close() {
    this.closed = true;
    this.lifetime.abort();
    this.agent.destroy();
  }
}
