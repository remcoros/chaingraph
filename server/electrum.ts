import net from 'node:net';
import tls from 'node:tls';
import type { ServerConfig } from './config';
import { SafeError } from './errors';
import { Limiter } from './limit';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

/** One multiplexed Electrum connection. Retains transport state, never wallet data. */
export class ElectrumClient {
  private socket?: net.Socket;
  private connecting?: Promise<void>;
  private pending = new Map<number, Pending>();
  private id = 0;
  private buffer = '';
  private closed = false;
  private genesis?: string;
  private version: unknown;
  private limiter: Limiter;
  constructor(private config: ServerConfig) {
    this.limiter = new Limiter(
      config.electrumConcurrency,
      config.electrumPending,
      config.queueTimeoutMs,
    );
  }

  private fail(socket: net.Socket, error: SafeError) {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.genesis = undefined;
    this.version = undefined;
    this.buffer = '';
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    socket.destroy();
  }
  private receive(socket: net.Socket, chunk: string) {
    if (this.socket !== socket) return;
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > this.config.maxResponseBytes) {
        this.fail(socket, new SafeError('Upstream response exceeds configured size limit', 413));
        return;
      }
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        if (message.id === undefined || message.id === null) continue; // Subscription notifications carry no request result.
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        pending.cleanup();
        if (message.error) pending.reject(new SafeError('Electrum rejected the request'));
        else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
        else pending.reject(new SafeError('Invalid Electrum response'));
      } catch {
        this.fail(socket, new SafeError('Invalid Electrum response'));
        return;
      }
    }
    if (Buffer.byteLength(this.buffer) > this.config.maxResponseBytes)
      this.fail(socket, new SafeError('Upstream response exceeds configured size limit', 413));
  }
  private raw(method: string, params: unknown[], signal?: AbortSignal): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed)
      return Promise.reject(new SafeError('Electrum is disconnected'));
    if (signal?.aborted) return Promise.reject(new SafeError('Request cancelled', 408));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
      };
      const timer = setTimeout(
        () => this.fail(socket, new SafeError('Electrum request timed out', 504)),
        this.config.requestTimeoutMs,
      );
      // Electrum has no per-request cancellation. Keep its concurrency slot until
      // the reply/deadline, so repeated HTTP aborts cannot create unbounded work
      // on the shared socket. Discard the result once its caller has gone away.
      this.pending.set(id, {
        resolve: (value) =>
          signal?.aborted ? reject(new SafeError('Request cancelled', 408)) : resolve(value),
        reject,
        cleanup,
      });
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) this.fail(socket, new SafeError('Electrum connection failed'));
      });
    });
  }
  private async connect(): Promise<void> {
    if (this.closed) throw new SafeError('Server is shutting down', 503);
    if (this.connecting) return this.connecting;
    if (this.socket && this.genesis) return;
    this.connecting = (async () => {
      const { electrumHost: host, electrumPort: port, electrumTls: encrypted } = this.config;
      const socket = encrypted
        ? tls.connect({
            host,
            port,
            servername: net.isIP(host) ? undefined : host,
            rejectUnauthorized: true,
          })
        : net.connect({ host, port });
      this.socket = socket;
      socket.setEncoding('utf8');
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 30000);
      socket.on('data', (chunk) => this.receive(socket, String(chunk)));
      socket.on('error', () => this.fail(socket, new SafeError('Electrum connection failed')));
      socket.on('close', () => this.fail(socket, new SafeError('Electrum disconnected')));
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            socket.off(event, connected);
            socket.off('error', failed);
            socket.off('close', failed);
          };
          const connected = () => {
            cleanup();
            resolve();
          };
          const failed = () => {
            cleanup();
            reject(new SafeError('Electrum connection failed'));
          };
          const event = encrypted ? 'secureConnect' : 'connect';
          const timer = setTimeout(() => {
            cleanup();
            socket.destroy();
            reject(new SafeError('Electrum connection timed out', 504));
          }, this.config.connectTimeoutMs);
          socket.once(event, connected);
          socket.once('error', failed);
          socket.once('close', failed);
        });
        const version = await this.raw('server.version', ['ChainGraph', '1.4']);
        if (
          !Array.isArray(version) ||
          version.length !== 2 ||
          typeof version[0] !== 'string' ||
          !version[0].length ||
          typeof version[1] !== 'string' ||
          !/^1\.4(?:\.\d+)?$/.test(version[1])
        )
          throw new SafeError('Unsupported Electrum protocol negotiation', 503);
        this.version = version;
        const features = (await this.raw('server.features', [])) as {
          genesis_hash?: unknown;
          hash_function?: unknown;
        } | null;
        if (
          !features ||
          typeof features.genesis_hash !== 'string' ||
          !/^[0-9a-f]{64}$/i.test(features.genesis_hash)
        )
          throw new SafeError('Invalid Electrum network identity');
        if (features.hash_function !== undefined && features.hash_function !== 'sha256')
          throw new SafeError('Unsupported Electrum script hash function', 503);
        this.genesis = features.genesis_hash.toLowerCase();
      } catch (error) {
        this.fail(socket, new SafeError('Electrum connection failed'));
        throw error instanceof SafeError ? error : new SafeError('Electrum connection failed');
      }
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }
  async call(
    method: string,
    params: unknown[],
    expectedGenesis: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.limiter.run(async () => {
      await this.connect();
      if (signal?.aborted) throw new SafeError('Request cancelled', 408);
      if (this.genesis !== expectedGenesis.toLowerCase())
        throw new SafeError('Electrum network does not match Bitcoin RPC', 503);
      if (method === 'server.version') return this.version;
      const result = await this.raw(method, params, signal);
      if (method === 'server.ping' && result !== null)
        throw new SafeError('Invalid Electrum ping response');
      if (
        method === 'blockchain.scripthash.get_history' &&
        Array.isArray(result) &&
        result.length > this.config.maxHistory
      )
        throw new SafeError('Address history exceeds configured transaction limit', 413);
      return result;
    }, signal);
  }
  close() {
    this.closed = true;
    if (this.socket) this.fail(this.socket, new SafeError('Server is shutting down', 503));
  }
}
