import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { loadConfig, loadNetworkConfig } from './config';
const networkConfig = (env: NodeJS.ProcessEnv = {}) =>
  loadNetworkConfig('testnet4', {
    BITCOIN_RPC_URL: 'http://127.0.0.1:48332',
    FULCRUM_HOST: '127.0.0.1',
    FULCRUM_PORT: '51001',
    ...env,
  });
import { CoreClient } from './core';
import { ElectrumClient } from './electrum';
import { Limiter } from './limit';
import { NetworkRegistry } from './networks';

const hash = 'a'.repeat(64),
  otherHash = 'b'.repeat(64);
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function listen(server: http.Server | net.Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return address.port;
}
interface Rpc {
  id: number;
  method: string;
  params: unknown[];
}
async function fixture(
  options: {
    chain?: string;
    genesis?: string;
    electrum?: (rpc: Rpc, socket: net.Socket) => boolean;
    core?: (rpc: Rpc, response: http.ServerResponse) => boolean;
    env?: NodeJS.ProcessEnv;
    authentication?: () => string;
  } = {},
) {
  const coreCalls: Rpc[] = [],
    electrumCalls: Rpc[] = [];
  const core = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body) as Rpc;
    coreCalls.push(rpc);
    expect(req.headers.authorization).toBe(
      `Basic ${Buffer.from(options.authentication?.() ?? 'test:secret').toString('base64')}`,
    );
    if (options.core?.(rpc, res)) return;
    const result =
      rpc.method === 'getblockchaininfo'
        ? { chain: options.chain ?? 'testnet4', blocks: 123 }
        : rpc.method === 'getblockhash'
          ? hash
          : { txid: hash };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: rpc.id, result }));
  });
  const corePort = await listen(core);
  cleanups.push(() => core.closeAllConnections());
  const sockets = new Set<net.Socket>();
  const electrum = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const rpc = JSON.parse(buffer.slice(0, end)) as Rpc;
        buffer = buffer.slice(end + 1);
        electrumCalls.push(rpc);
        if (options.electrum?.(rpc, socket)) continue;
        const result =
          rpc.method === 'server.version'
            ? ['mock', '1.4']
            : rpc.method === 'server.features'
              ? { genesis_hash: options.genesis ?? hash }
              : rpc.method === 'server.ping'
                ? null
                : [];
        socket.write(`${JSON.stringify({ id: rpc.id, result })}\n`);
      }
    });
  });
  const electrumPort = await listen(electrum);
  cleanups.push(() => {
    for (const socket of sockets) socket.destroy();
  });
  const config = networkConfig({
    BITCOIN_RPC_USER: 'test',
    BITCOIN_RPC_PASSWORD: 'secret',
    BITCOIN_RPC_URL: `http://127.0.0.1:${corePort}`,
    FULCRUM_PORT: String(electrumPort),
    UPSTREAM_REQUEST_TIMEOUT_MS: '300',
    ...options.env,
  });
  const created = createApp(loadConfig(options.env ?? {}, { testnet4: config }), {
    staticDirectory: false,
  });
  const server = http.createServer(created.app);
  const port = await listen(server);
  cleanups.push(() => {
    created.close();
    server.closeAllConnections();
  });
  const base = `http://127.0.0.1:${port}`;
  const rpc = (
    method: string,
    params: unknown[] = [],
    target = 'electrum',
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ network: 'testnet4', target, method, params }),
    });
  return { base, rpc, config, coreCalls, electrumCalls };
}

describe('read-only proxy', () => {
  it('reports matching upstream status and negotiates Electrum first', async () => {
    const f = await fixture();
    expect(await (await fetch(`${f.base}/api/status?network=testnet4`)).json()).toEqual({
      network: 'testnet4',
      connected: true,
      height: 123,
    });
    expect(f.electrumCalls.map((x) => x.method)).toEqual([
      'server.version',
      'server.features',
      'server.ping',
    ]);
    expect(await (await f.rpc('getrawtransaction', [hash, true], 'core')).json()).toEqual({
      result: { txid: hash },
    });
  });
  it('rejects writes, unknown methods, extra fields and malformed parameters before upstream access', async () => {
    const f = await fixture();
    for (const [method, params, target] of [
      ['sendrawtransaction', ['00'], 'core'],
      ['blockchain.transaction.broadcast', ['00'], 'electrum'],
      ['getblockhash', [-1], 'core'],
      ['getrawtransaction', [hash, 99], 'core'],
      ['blockchain.scripthash.get_history', ['bad'], 'electrum'],
      ['__proto__', [], 'core'],
    ] as [string, unknown[], string][])
      expect((await f.rpc(method, params, target)).status).toBe(400);
    const response = await fetch(`${f.base}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'core',
        method: 'getblockchaininfo',
        params: [],
        url: 'http://evil',
      }),
    });
    expect(response.status).toBe(400);
    expect(f.coreCalls).toHaveLength(0);
    expect(f.electrumCalls).toHaveLength(0);
  });
  it('blocks cross-origin and rebound hosts, permits explicitly configured origins', async () => {
    const f = await fixture({ env: { CORS_ALLOW_ORIGINS: 'http://127.0.0.1:3001' } });
    expect(
      (await f.rpc('getblockchaininfo', [], 'core', { origin: 'https://evil.invalid' })).status,
    ).toBe(403);
    const reboundStatus = await new Promise<number | undefined>((resolve) => {
      http.get(
        `${f.base}/api/status?network=testnet4`,
        { headers: { host: 'evil.invalid' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
    });
    expect(reboundStatus).toBe(403);
    expect(
      (
        await fetch(`${f.base}/api/status?network=testnet4`, {
          headers: { 'sec-fetch-site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    const good = await f.rpc('getblockchaininfo', [], 'core', { origin: 'http://127.0.0.1:3001' });
    expect(good.status).toBe(200);
    expect(good.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3001');
    expect(good.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects a Core chain mismatch without submitting the query', async () => {
    const f = await fixture({ chain: 'test' });
    expect((await f.rpc('getrawtransaction', [hash], 'core')).status).toBe(503);
    expect(f.coreCalls.map((x) => x.method)).toEqual(['getblockchaininfo']);
    expect(f.electrumCalls).toHaveLength(0);
    expect(await (await fetch(`${f.base}/api/status?network=testnet4`)).json()).toMatchObject({
      connected: false,
      network: 'testnet4',
    });
  });
  it('verifies the immutable genesis block once while revalidating the chain per request', async () => {
    const f = await fixture();
    expect((await f.rpc('blockchain.scripthash.get_history', [hash])).status).toBe(200);
    expect((await f.rpc('blockchain.scripthash.get_balance', [hash])).status).toBe(200);
    expect(f.coreCalls.filter((rpc) => rpc.method === 'getblockhash')).toHaveLength(1);
    expect(f.coreCalls.filter((rpc) => rpc.method === 'getblockchaininfo')).toHaveLength(2);
  });
  it('never caches malformed or failed genesis lookups, so the next request retries', async () => {
    let attempts = 0;
    const f = await fixture({
      core: (rpc, res) => {
        if (rpc.method === 'getblockhash' && ++attempts === 1) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ id: rpc.id, result: 'not-a-hash' }));
          return true;
        }
        return false;
      },
    });
    const first = await f.rpc('blockchain.scripthash.get_history', [hash]);
    expect(await first.json()).toEqual({ error: 'Invalid Bitcoin genesis block' });
    expect((await f.rpc('blockchain.scripthash.get_history', [hash])).status).toBe(200);
    expect(f.coreCalls.filter((rpc) => rpc.method === 'getblockhash')).toHaveLength(2);
  });
  it('rejects Electrum on another genesis chain', async () => {
    const f = await fixture({ genesis: otherHash });
    expect((await f.rpc('blockchain.scripthash.get_history', [hash])).status).toBe(503);
    expect(f.electrumCalls.map((x) => x.method)).toEqual(['server.version', 'server.features']);
  });
  it('rejects incompatible negotiation and script hashing before application queries', async () => {
    for (const incompatible of ['version', 'hash']) {
      const f = await fixture({
        electrum: (rpc, socket) => {
          if (incompatible === 'version' && rpc.method === 'server.version') {
            socket.write(`${JSON.stringify({ id: rpc.id, result: ['mock', '1.3'] })}\n`);
            return true;
          }
          if (incompatible === 'hash' && rpc.method === 'server.features') {
            socket.write(
              `${JSON.stringify({ id: rpc.id, result: { genesis_hash: hash, hash_function: 'sha512' } })}\n`,
            );
            return true;
          }
          return false;
        },
      });
      expect((await f.rpc('blockchain.scripthash.get_history', [hash])).status).toBe(503);
      expect(
        f.electrumCalls.some((rpc) => rpc.method === 'blockchain.scripthash.get_history'),
      ).toBe(false);
    }
  });
  it('checks current Electrum responsiveness instead of only cached handshake metadata', async () => {
    let stalled = false;
    const f = await fixture({ electrum: (rpc) => stalled && rpc.method === 'server.ping' });
    expect(await (await fetch(`${f.base}/api/status?network=testnet4`)).json()).toMatchObject({
      connected: true,
    });
    stalled = true;
    expect(await (await fetch(`${f.base}/api/status?network=testnet4`)).json()).toMatchObject({
      connected: false,
      error: 'Electrum request timed out',
    });
    expect(f.electrumCalls.filter((rpc) => rpc.method === 'server.ping')).toHaveLength(2);
  });
  it('rereads rotated cookies and rejects malformed credentials before sending HTTP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'chaingraph-cookie-test-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const cookie = join(directory, 'cookie');
    let authentication = 'test:secret';
    await writeFile(cookie, `${authentication}\n`);
    const f = await fixture({
      authentication: () => authentication,
      env: {
        BITCOIN_RPC_USER: undefined,
        BITCOIN_RPC_PASSWORD: undefined,
        BITCOIN_RPC_COOKIE_FILE: cookie,
      },
    });
    expect((await f.rpc('getblockchaininfo', [], 'core')).status).toBe(200);
    authentication = 'rotated:new-secret';
    await writeFile(cookie, authentication);
    expect((await f.rpc('getblockchaininfo', [], 'core')).status).toBe(200);
    const sent = f.coreCalls.length;
    await writeFile(cookie, 'malformed-secret-without-separator');
    expect(await (await f.rpc('getblockchaininfo', [], 'core')).json()).toEqual({
      error: 'Bitcoin RPC authentication cookie is malformed',
    });
    expect(f.coreCalls).toHaveLength(sent);
  });
  it('multiplexes fragmented replies and ignores notifications', async () => {
    const f = await fixture({
      electrum: (rpc, socket) => {
        if (rpc.method !== 'blockchain.transaction.get') return false;
        const payload = `${JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{}] })}\n${JSON.stringify({ id: rpc.id, result: rpc.params[0] })}\n`;
        socket.write(payload.slice(0, 9));
        setTimeout(() => socket.write(payload.slice(9)), rpc.params[0] === hash ? 15 : 30);
        return true;
      },
    });
    // Fragmentation must remain valid on a single stream: issue these sequentially.
    expect(await (await f.rpc('blockchain.transaction.get', [hash])).json()).toEqual({
      result: hash,
    });
    expect(await (await f.rpc('blockchain.transaction.get', [otherHash])).json()).toEqual({
      result: otherHash,
    });
    expect(f.electrumCalls.filter((x) => x.method === 'server.version')).toHaveLength(1);
  });
  it('matches out-of-order response IDs on the shared connection', async () => {
    const f = await fixture({
      electrum: (rpc, socket) => {
        if (rpc.method !== 'blockchain.transaction.get') return false;
        setTimeout(
          () => socket.write(`${JSON.stringify({ id: rpc.id, result: rpc.params[0] })}\n`),
          rpc.params[0] === hash ? 30 : 5,
        );
        return true;
      },
    });
    const responses = await Promise.all([
      f.rpc('blockchain.transaction.get', [hash]),
      f.rpc('blockchain.transaction.get', [otherHash]),
    ]);
    expect(await Promise.all(responses.map((r) => r.json()))).toEqual([
      { result: hash },
      { result: otherHash },
    ]);
    expect(f.electrumCalls.filter((x) => x.method === 'server.version')).toHaveLength(1);
  });
  it('cleans up a disconnect and reconnects on the next request', async () => {
    let first = true;
    const f = await fixture({
      electrum: (rpc, socket) => {
        if (rpc.method !== 'blockchain.transaction.get' || !first) return false;
        first = false;
        socket.destroy();
        return true;
      },
    });
    expect((await f.rpc('blockchain.transaction.get', [hash])).status).toBe(502);
    expect((await f.rpc('blockchain.transaction.get', [hash])).status).toBe(200);
    expect(f.electrumCalls.filter((x) => x.method === 'server.version')).toHaveLength(2);
  });
  it('times out stalled upstream requests without leaking errors', async () => {
    const f = await fixture({ electrum: (rpc) => rpc.method === 'blockchain.transaction.get' });
    const response = await f.rpc('blockchain.transaction.get', [hash]);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'Electrum request timed out' });
  });
  it('limits response bytes and address history without partial successful results', async () => {
    const f = await fixture({
      env: { MAX_RESPONSE_BYTES: '1024', MAX_ADDRESS_HISTORY_TXS: '1' },
      electrum: (rpc, socket) => {
        if (rpc.method === 'blockchain.transaction.get') {
          socket.write(`${JSON.stringify({ id: rpc.id, result: 'x'.repeat(2000) })}\n`);
          return true;
        }
        if (rpc.method === 'blockchain.scripthash.get_history') {
          socket.write(`${JSON.stringify({ id: rpc.id, result: [{}, {}] })}\n`);
          return true;
        }
        return false;
      },
    });
    expect((await f.rpc('blockchain.scripthash.get_history', [hash])).status).toBe(413);
    expect((await f.rpc('blockchain.transaction.get', [hash])).status).toBe(413);
  });
  it('sanitizes upstream errors containing secrets and enforces Core size/timeout limits', async () => {
    const f = await fixture({
      env: { MAX_RESPONSE_BYTES: '1024' },
      core: (rpc, res) => {
        if (rpc.method === 'getrawtransaction') {
          res.end(
            JSON.stringify({
              id: rpc.id,
              error: { message: 'password=secret http://private.example' },
            }),
          );
          return true;
        }
        if (rpc.method === 'getblock') {
          res.end(JSON.stringify({ id: rpc.id, result: 'x'.repeat(2000) }));
          return true;
        }
        if (rpc.method === 'gettxout') return true;
        return false;
      },
    });
    expect(await (await f.rpc('getrawtransaction', [hash], 'core')).json()).toEqual({
      error: 'Bitcoin RPC rejected the request',
    });
    expect((await f.rpc('getblock', [hash], 'core')).status).toBe(413);
    expect((await f.rpc('gettxout', [hash, 0], 'core')).status).toBe(504);
  });
  it('exposes only the machine-readable verbosity-2 fallback code', async () => {
    const f = await fixture({
      core: (rpc, res) => {
        if (rpc.method !== 'getrawtransaction') return false;
        res.end(
          JSON.stringify({
            id: rpc.id,
            error: { code: -32603, message: 'private block path and storage details' },
          }),
        );
        return true;
      },
    });
    expect(await (await f.rpc('getrawtransaction', [hash, 2], 'core')).json()).toEqual({
      error: 'Bitcoin RPC previous-output data is unavailable',
      code: 'core_prevout_unavailable',
    });
    expect(await (await f.rpc('getrawtransaction', [hash, 1], 'core')).json()).toEqual({
      error: 'Bitcoin RPC rejected the request',
    });
  });
  it('reports rejected Core authentication without forwarding its HTTP body', async () => {
    const f = await fixture({
      core: (rpc, res) => {
        if (rpc.method !== 'getrawtransaction') return false;
        res.writeHead(401);
        res.end('private endpoint and credential details');
        return true;
      },
    });
    expect(await (await f.rpc('getrawtransaction', [hash], 'core')).json()).toEqual({
      error: 'Bitcoin RPC authentication failed',
    });
  });
  it('keeps the status contract when the whole-handler deadline expires', async () => {
    const f = await fixture({
      env: { SERVER_HANDLER_TIMEOUT_MS: '20' },
      core: (rpc) => rpc.method === 'getblockchaininfo',
    });
    expect(await (await fetch(`${f.base}/api/status?network=testnet4`)).json()).toEqual({
      network: 'testnet4',
      connected: false,
      error: 'Request timed out',
    });
  });
  it('rejects a configured network without credentials before creating its clients', async () => {
    await expect(
      fixture({ env: { BITCOIN_RPC_USER: undefined, BITCOIN_RPC_PASSWORD: undefined } }),
    ).rejects.toThrow('authentication mode');
  });
  it('disconnects on malformed Electrum frames and recovers for the next request', async () => {
    let first = true;
    const f = await fixture({
      electrum: (rpc, socket) => {
        if (rpc.method !== 'blockchain.transaction.get' || !first) return false;
        first = false;
        socket.write('not JSON\n');
        return true;
      },
    });
    expect(await (await f.rpc('blockchain.transaction.get', [hash])).json()).toEqual({
      error: 'Invalid Electrum response',
    });
    expect((await f.rpc('blockchain.transaction.get', [hash])).status).toBe(200);
  });
});

describe('configuration and resource bounds', () => {
  it('rejects invalid authentication modes and unbounded settings', () => {
    expect(() => networkConfig({})).toThrow('authentication mode');
    expect(() => networkConfig({ BITCOIN_RPC_USER: 'u' })).toThrow('authentication mode');
    expect(() =>
      networkConfig({
        BITCOIN_RPC_USER: 'u',
        BITCOIN_RPC_PASSWORD: 'p',
        BITCOIN_RPC_COOKIE_FILE: '/cookie',
      }),
    ).toThrow('authentication mode');
    expect(() =>
      networkConfig({
        BITCOIN_RPC_USER: 'u',
        BITCOIN_RPC_PASSWORD: 'p',
        CORE_RPC_MAX_CONCURRENCY: '-1',
      }),
    ).toThrow('CORE_RPC_MAX_CONCURRENCY');
    expect(() =>
      networkConfig({
        BITCOIN_RPC_USER: 'u',
        BITCOIN_RPC_PASSWORD: 'p',
        BITCOIN_RPC_URL: 'http://u:p@localhost',
      }),
    ).toThrow('BITCOIN_RPC_URL');
  });
  it('caps queued work and releases cancelled queue entries', async () => {
    const limiter = new Limiter(1, 1, 1000);
    let release!: () => void;
    const active = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const controller = new AbortController();
    const queued = limiter.run(async () => 'queued', controller.signal);
    const assertion = expect(queued).rejects.toThrow('cancelled');
    await expect(limiter.run(async () => 'overflow')).rejects.toThrow('busy');
    controller.abort();
    await assertion;
    release();
    await active;
    await expect(limiter.run(async () => 'next')).resolves.toBe('next');
  });
  it('does not reopen a closed Electrum client', async () => {
    const f = await fixture();
    const client = new ElectrumClient(f.config);
    client.close();
    await expect(client.call('server.version', [], hash)).rejects.toThrow('shutting down');
  });
  it('bounds a stalled TLS handshake', async () => {
    const sockets = new Set<net.Socket>();
    const stalled = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
    });
    const port = await listen(stalled);
    cleanups.push(() => {
      for (const socket of sockets) socket.destroy();
    });
    const config = networkConfig({
      BITCOIN_RPC_USER: 'test',
      BITCOIN_RPC_PASSWORD: 'secret',
      FULCRUM_PORT: String(port),
      FULCRUM_TLS: 'true',
      UPSTREAM_CONNECT_TIMEOUT_MS: '30',
    });
    const client = new ElectrumClient(config);
    cleanups.push(() => client.close());
    await expect(client.call('server.version', [], hash)).rejects.toThrow('connection timed out');
  });
  it('keeps cancelled Electrum work within concurrency limits until its reply or deadline', async () => {
    const f = await fixture({
      env: { FULCRUM_MAX_CONCURRENCY: '1', FULCRUM_MAX_PENDING: '0' },
      electrum: (rpc, socket) => {
        if (rpc.method !== 'blockchain.transaction.get') return false;
        setTimeout(() => socket.write(`${JSON.stringify({ id: rpc.id, result: hash })}\n`), 80);
        return true;
      },
    });
    const client = new ElectrumClient(f.config);
    cleanups.push(() => client.close());
    await client.call('server.version', [], hash);
    const controller = new AbortController();
    const running = client.call('blockchain.transaction.get', [hash], hash, controller.signal);
    const cancelled = expect(running).rejects.toThrow('cancelled');
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(client.call('server.version', [], hash)).rejects.toThrow('busy');
    await cancelled;
    await expect(client.call('server.version', [], hash)).resolves.toEqual(['mock', '1.4']);
  });
});

describe('Core stale keep-alive transport', () => {
  interface StubRequest {
    rpc: Rpc;
    connection: number;
    onConnection: number;
    socket: net.Socket;
  }
  /** Minimal HTTP/1.1 Core stub over raw TCP so tests control socket resets. */
  async function rawCore(
    behavior: (request: StubRequest) => 'respond' | 'reset' | 'hold' | 401,
    env: NodeJS.ProcessEnv = {},
  ) {
    const sockets = new Set<net.Socket>();
    const requests: StubRequest[] = [];
    let connections = 0;
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      const connection = ++connections;
      let onConnection = 0;
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const headEnd = buffer.indexOf('\r\n\r\n');
          if (headEnd < 0) return;
          const length = Number(
            /content-length: (\d+)/i.exec(buffer.slice(0, headEnd).toString('latin1'))?.[1] ?? 0,
          );
          if (buffer.length < headEnd + 4 + length) return;
          const rpc = JSON.parse(
            buffer.slice(headEnd + 4, headEnd + 4 + length).toString('utf8'),
          ) as Rpc;
          buffer = buffer.slice(headEnd + 4 + length);
          const request: StubRequest = { rpc, connection, onConnection: ++onConnection, socket };
          requests.push(request);
          const action = behavior(request);
          if (action === 'reset') socket.destroy();
          else if (action === 'hold') continue;
          else {
            const payload = JSON.stringify(
              action === 401 ? { error: 'Unauthorized' } : { id: rpc.id, result: hash },
            );
            socket.write(
              `HTTP/1.1 ${action === 401 ? '401 Unauthorized' : '200 OK'}\r\ncontent-type: application/json\r\nconnection: keep-alive\r\ncontent-length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
            );
          }
        }
      });
    });
    const port = await listen(server);
    cleanups.push(() => {
      for (const socket of sockets) socket.destroy();
    });
    const config = networkConfig({
      BITCOIN_RPC_USER: 'test',
      BITCOIN_RPC_PASSWORD: 'secret',
      BITCOIN_RPC_URL: `http://127.0.0.1:${port}`,
      ...env,
    });
    const client = new CoreClient(config);
    cleanups.push(() => client.close());
    return { client, requests, sockets, connections: () => connections };
  }

  it('retries a stale pooled socket reset once on a fresh connection', async () => {
    const stub = await rawCore((r) =>
      r.connection === 1 && r.onConnection === 2 ? 'reset' : 'respond',
    );
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    // The second call reuses the pooled keep-alive socket; the peer resets it
    // before any response, so exactly one retry runs over a new connection.
    await expect(stub.client.call('getblockhash', [1])).resolves.toBe(hash);
    expect(stub.connections()).toBe(2);
    expect(stub.requests).toHaveLength(3);
    expect(stub.requests[2].connection).toBe(2);
  });

  it('does not retry a reset on a freshly opened socket', async () => {
    const stub = await rawCore(() => 'reset');
    await expect(stub.client.call('getblockhash', [0])).rejects.toThrow('connection failed');
    expect(stub.connections()).toBe(1);
    expect(stub.requests).toHaveLength(1);
  });

  it('makes at most one retry attempt when the fresh connection also fails', async () => {
    const stub = await rawCore((r) =>
      r.onConnection === 2 || r.connection === 2 ? 'reset' : 'respond',
    );
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    await expect(stub.client.call('getblockhash', [1])).rejects.toThrow('connection failed');
    expect(stub.connections()).toBe(2);
    expect(stub.requests).toHaveLength(3);
  });

  it('does not retry authentication or HTTP error responses on a reused socket', async () => {
    const stub = await rawCore((r) => (r.onConnection === 2 ? 401 : 'respond'));
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    await expect(stub.client.call('getblockhash', [1])).rejects.toThrow('authentication failed');
    expect(stub.connections()).toBe(1);
    expect(stub.requests).toHaveLength(2);
  });

  it('does not retry a failure after the response started', async () => {
    const stub = await rawCore((r) => {
      if (r.onConnection !== 2) return 'respond';
      r.socket.write(
        'HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 100\r\n\r\n{"id":',
      );
      setTimeout(() => r.socket.destroy(), 5);
      return 'hold';
    });
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    await expect(stub.client.call('getblockhash', [1])).rejects.toThrow('connection failed');
    expect(stub.connections()).toBe(1);
    expect(stub.requests).toHaveLength(2);
  });

  it('does not retry an aborted request', async () => {
    const stub = await rawCore((r) => (r.onConnection === 2 ? 'hold' : 'respond'));
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    const controller = new AbortController();
    const pending = stub.client.call('getblockhash', [1], controller.signal);
    const cancelled = expect(pending).rejects.toThrow('timed out or was cancelled');
    await vi.waitFor(() => expect(stub.requests).toHaveLength(2));
    controller.abort();
    await cancelled;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stub.connections()).toBe(1);
    expect(stub.requests).toHaveLength(2);
  });

  it('close promptly cancels a held fresh retry without further attempts', async () => {
    const stub = await rawCore((r) =>
      r.onConnection === 2 ? 'reset' : r.connection === 2 ? 'hold' : 'respond',
    );
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    const pending = stub.client.call('getblockhash', [1]);
    const failed = expect(pending).rejects.toThrow('timed out or was cancelled');
    // Wait until the retry is actually held on its fresh non-pooled socket.
    await vi.waitFor(() => expect(stub.requests).toHaveLength(3));
    const retrySocket = stub.requests[2].socket;
    const started = Date.now();
    stub.client.close();
    await failed;
    // The default request deadline is 30s; close must release far sooner.
    expect(Date.now() - started).toBeLessThan(5000);
    await vi.waitFor(() => expect(retrySocket.destroyed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stub.requests).toHaveLength(3);
    expect(stub.connections()).toBe(2);
  });

  it('aborting during the fresh retry cancels it promptly', async () => {
    const stub = await rawCore((r) =>
      r.onConnection === 2 ? 'reset' : r.connection === 2 ? 'hold' : 'respond',
    );
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    const controller = new AbortController();
    const pending = stub.client.call('getblockhash', [1], controller.signal);
    const cancelled = expect(pending).rejects.toThrow('timed out or was cancelled');
    await vi.waitFor(() => expect(stub.requests).toHaveLength(3));
    const retrySocket = stub.requests[2].socket;
    const started = Date.now();
    controller.abort();
    await cancelled;
    expect(Date.now() - started).toBeLessThan(5000);
    await vi.waitFor(() => expect(retrySocket.destroyed).toBe(true));
    expect(stub.requests).toHaveLength(3);
  });

  it('a delayed stale reset followed by a held retry keeps the original deadline', async () => {
    const stub = await rawCore(
      (r) => {
        if (r.onConnection === 2) {
          // The peer closes the idle pooled socket only after a delay.
          setTimeout(() => r.socket.destroy(), 600);
          return 'hold';
        }
        return r.connection === 2 ? 'hold' : 'respond';
      },
      { UPSTREAM_REQUEST_TIMEOUT_MS: '1000' },
    );
    await expect(stub.client.call('getblockhash', [0])).resolves.toBe(hash);
    const started = Date.now();
    await expect(stub.client.call('getblockhash', [1])).rejects.toThrow(
      'timed out or was cancelled',
    );
    // One 1000ms deadline covers both attempts; the retry starts its own
    // connect timer but never extends the overall request budget.
    expect(Date.now() - started).toBeLessThan(1400);
    expect(stub.requests).toHaveLength(3);
  });
});

describe('optional exact-outpoint spender lookup', () => {
  const options = { mempool_only: false, return_spending_tx: false };
  const outputs = [{ txid: hash, vout: 0 }];
  const enabled = { CHAINGRAPH_USE_TXOSPENDERINDEX: 'true' };
  it('is absent from discovery by default and rejects direct calls before touching upstreams', async () => {
    const f = await fixture();
    expect(await (await fetch(`${f.base}/api/networks`)).json()).toEqual({
      networks: ['testnet4'],
    });
    const response = await f.rpc('gettxspendingprevout', [outputs, options], 'core');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'core_spender_unavailable' });
    expect(f.coreCalls).toEqual([]);
    expect(f.electrumCalls).toEqual([]);
  });
  it('strictly bounds the opt-in RPC and never permits implicit mempool-only coverage', async () => {
    const f = await fixture({ env: enabled });
    for (const params of [
      [outputs],
      [outputs, false, false],
      [outputs, {}],
      [outputs, { ...options, mempool_only: true }],
      [outputs, { ...options, return_spending_tx: true }],
      [outputs, { ...options, extra: false }],
      [[{ ...outputs[0], extra: 1 }], options],
      [[{ txid: hash, vout: 0x80000000 }], options],
      [[{ txid: hash, vout: -1 }], options],
      [[{ txid: 'bad', vout: 0 }], options],
      [[], options],
      [Array.from({ length: 501 }, () => outputs[0]), options],
    ])
      expect((await f.rpc('gettxspendingprevout', params, 'core')).status).toBe(400);
    expect(f.coreCalls).toEqual([]);
  });
  it('advertises opt-in, deduplicates outpoints and preserves confirmed, mempool and empty observations', async () => {
    const f = await fixture({
      env: enabled,
      core: (rpc, response) => {
        if (rpc.method !== 'gettxspendingprevout') return false;
        const queried = rpc.params[0] as typeof outputs;
        response.end(
          JSON.stringify({
            id: rpc.id,
            result: queried.map((point) => ({
              ...point,
              ...(point.vout === 0
                ? { spendingtxid: otherHash, blockhash: 'c'.repeat(64) }
                : point.vout === 1
                  ? { spendingtxid: 'd'.repeat(64) }
                  : {}),
            })),
          }),
        );
        return true;
      },
    });
    expect(await (await fetch(`${f.base}/api/networks`)).json()).toEqual({
      networks: ['testnet4'],
      spenderIndexNetworks: ['testnet4'],
    });
    const points = [
      outputs[0],
      { txid: hash.toUpperCase(), vout: 0 },
      { txid: hash, vout: 1 },
      { txid: hash, vout: 2 },
    ];
    expect(await (await f.rpc('gettxspendingprevout', [points, options], 'core')).json()).toEqual({
      result: [
        { txid: hash, vout: 0, spendingtxid: otherHash, blockhash: 'c'.repeat(64) },
        { txid: hash, vout: 1, spendingtxid: 'd'.repeat(64) },
        { txid: hash, vout: 2 },
      ],
    });
    expect(f.coreCalls[1].params).toEqual([[outputs[0], points[2], points[3]], options]);
    // No server result cache: the next action asks Core again.
    await f.rpc('gettxspendingprevout', [outputs, options], 'core');
    expect(f.coreCalls.filter((call) => call.method === 'gettxspendingprevout')).toHaveLength(2);
    expect(f.electrumCalls).toEqual([]);
  });
  it('supports the maximum batch within the HTTP body bound', async () => {
    const f = await fixture({
      env: enabled,
      core: (rpc, response) => {
        if (rpc.method !== 'gettxspendingprevout') return false;
        response.end(JSON.stringify({ id: rpc.id, result: rpc.params[0] }));
        return true;
      },
    });
    const points = Array.from({ length: 500 }, (_, vout) => ({ txid: hash, vout }));
    expect((await f.rpc('gettxspendingprevout', [points, options], 'core')).status).toBe(200);
  });
  it('normalizes accepted response hashes and correlates spender block observations without casing differences', async () => {
    const points = [outputs[0], { txid: hash, vout: 1 }];
    const f = await fixture({
      env: enabled,
      core: (rpc, response) => {
        if (rpc.method !== 'gettxspendingprevout') return false;
        response.end(
          JSON.stringify({
            id: rpc.id,
            result: [
              {
                txid: hash.toUpperCase(),
                vout: 0,
                spendingtxid: otherHash.toUpperCase(),
                blockhash: 'C'.repeat(64),
              },
              { txid: hash, vout: 1, spendingtxid: otherHash, blockhash: 'c'.repeat(64) },
            ],
          }),
        );
        return true;
      },
    });
    const response = await f.rpc('gettxspendingprevout', [points, options], 'core');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: points.map((point) => ({
        ...point,
        spendingtxid: otherHash,
        blockhash: 'c'.repeat(64),
      })),
    });
  });
  it.each([
    ['c'.repeat(64), 'd'.repeat(64)],
    [undefined, 'c'.repeat(64)],
    ['c'.repeat(64), undefined],
  ])(
    'rejects conflicting block observations for the same spender and cools down: %j',
    async (first, second) => {
      const points = [outputs[0], { txid: hash, vout: 1 }];
      const f = await fixture({
        env: enabled,
        core: (rpc, response) => {
          if (rpc.method !== 'gettxspendingprevout') return false;
          response.end(
            JSON.stringify({
              id: rpc.id,
              result: [
                { ...points[0], spendingtxid: otherHash.toUpperCase(), blockhash: first },
                { ...points[1], spendingtxid: otherHash, blockhash: second },
              ],
            }),
          );
          return true;
        },
      });
      const response = await f.rpc('gettxspendingprevout', [points, options], 'core');
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'Bitcoin RPC spender lookup is unavailable; retry later',
        code: 'core_spender_unavailable',
      });
      const before = f.coreCalls.length;
      expect((await f.rpc('gettxspendingprevout', [points, options], 'core')).status).toBe(503);
      expect(f.coreCalls).toHaveLength(before);
    },
  );
  it.each([-1, -32601, -32602, -8])(
    'sanitizes index/readiness or old-Core error %s and allows recovery after cooldown',
    async (code) => {
      let failed = true;
      const f = await fixture({
        env: enabled,
        core: (rpc, response) => {
          if (rpc.method !== 'gettxspendingprevout') return false;
          response.end(
            JSON.stringify({
              id: rpc.id,
              ...(failed
                ? { error: { code, message: 'private upstream detail must not escape' } }
                : { result: outputs }),
            }),
          );
          return true;
        },
      });
      const response = await f.rpc('gettxspendingprevout', [outputs, options], 'core');
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({ code: 'core_spender_unavailable' });
      expect(JSON.stringify(body)).not.toContain('private');
      failed = false;
      const before = f.coreCalls.length;
      expect((await f.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(503);
      expect(f.coreCalls).toHaveLength(before);
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 30_001);
      try {
        expect((await f.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(200);
      } finally {
        clock.mockRestore();
      }
    },
  );
  it.each([
    null,
    {},
    [],
    [{ txid: hash, vout: 1 }],
    [
      { txid: hash, vout: 0 },
      { txid: hash, vout: 0 },
    ],
    [{ txid: hash, vout: 0, spendingtxid: 'bad' }],
    [{ txid: hash, vout: 0, blockhash: otherHash }],
    [{ txid: hash, vout: 0, spendingtx: '00' }],
  ])('rejects malformed or partial coverage and cools down: %j', async (result) => {
    const f = await fixture({
      env: enabled,
      core: (rpc, response) => {
        if (rpc.method !== 'gettxspendingprevout') return false;
        response.end(JSON.stringify({ id: rpc.id, result }));
        return true;
      },
    });
    expect((await f.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(503);
    const before = f.coreCalls.length;
    expect((await f.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(503);
    expect(f.coreCalls).toHaveLength(before);
  });
  it('cools down timeouts and preserves the network boundary', async () => {
    const f = await fixture({
      env: { ...enabled, UPSTREAM_REQUEST_TIMEOUT_MS: '30' },
      core: (rpc) => rpc.method === 'gettxspendingprevout',
    });
    expect((await f.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(503);
    const before = f.coreCalls.length;
    expect((await f.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(503);
    expect(f.coreCalls).toHaveLength(before);
    const mismatch = await fixture({ env: enabled, chain: 'main' });
    expect((await mismatch.rpc('gettxspendingprevout', [outputs, options], 'core')).status).toBe(
      503,
    );
    expect(mismatch.coreCalls.map((call) => call.method)).toEqual(['getblockchaininfo']);
  });
  it('does not cool down a caller-cancelled lookup', async () => {
    const controller = new AbortController();
    let cancel = true;
    const f = await fixture({
      env: enabled,
      core: (rpc, response) => {
        if (rpc.method !== 'gettxspendingprevout') return false;
        if (cancel) controller.abort();
        else response.end(JSON.stringify({ id: rpc.id, result: outputs }));
        return true;
      },
    });
    const registry = new NetworkRegistry(loadConfig({}, { testnet4: f.config }));
    cleanups.push(() => registry.close());
    const pair = registry.get('testnet4');
    await expect(pair.spendingPrevouts([outputs, options], controller.signal)).rejects.toThrow();
    cancel = false;
    await expect(
      pair.spendingPrevouts([outputs, options], new AbortController().signal),
    ).resolves.toEqual(outputs);
    expect(f.coreCalls.filter((call) => call.method === 'gettxspendingprevout')).toHaveLength(2);
  });
});
