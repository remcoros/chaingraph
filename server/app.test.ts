import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadConfig } from './config';
import { ElectrumClient } from './electrum';
import { Limiter } from './limit';

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
  const config = loadConfig({
    BITCOIN_RPC_USER: 'test',
    BITCOIN_RPC_PASSWORD: 'secret',
    BITCOIN_RPC_URL: `http://127.0.0.1:${corePort}`,
    FULCRUM_PORT: String(electrumPort),
    UPSTREAM_REQUEST_TIMEOUT_MS: '300',
    ...options.env,
  });
  const created = createApp(config, { staticDirectory: false });
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
      body: JSON.stringify({ target, method, params }),
    });
  return { base, rpc, config, coreCalls, electrumCalls };
}

describe('read-only proxy', () => {
  it('reports matching upstream status and negotiates Electrum first', async () => {
    const f = await fixture();
    expect(await (await fetch(`${f.base}/api/status`)).json()).toEqual({
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
      http.get(`${f.base}/api/status`, { headers: { host: 'evil.invalid' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
    });
    expect(reboundStatus).toBe(403);
    expect(
      (await fetch(`${f.base}/api/status`, { headers: { 'sec-fetch-site': 'cross-site' } })).status,
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
    expect(await (await fetch(`${f.base}/api/status`)).json()).toMatchObject({
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
    expect(await (await fetch(`${f.base}/api/status`)).json()).toMatchObject({ connected: true });
    stalled = true;
    expect(await (await fetch(`${f.base}/api/status`)).json()).toMatchObject({
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
    expect(await (await fetch(`${f.base}/api/status`)).json()).toEqual({
      network: 'testnet4',
      connected: false,
      error: 'Request timed out',
    });
  });
  it('serves disconnected status without credentials and rejects RPC without contacting upstreams', async () => {
    const f = await fixture({
      env: { BITCOIN_RPC_USER: undefined, BITCOIN_RPC_PASSWORD: undefined },
    });
    expect(await (await fetch(`${f.base}/api/status`)).json()).toEqual({
      network: 'testnet4',
      connected: false,
      error: 'Bitcoin RPC is not configured; demo workspaces remain available',
    });
    expect((await f.rpc('getblockchaininfo', [], 'core')).status).toBe(503);
    expect(f.coreCalls).toHaveLength(0);
    expect(f.electrumCalls).toHaveLength(0);
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
    expect(loadConfig({}).coreUser).toBeUndefined();
    expect(() => loadConfig({ BITCOIN_RPC_USER: 'u' })).toThrow('authentication mode');
    expect(() =>
      loadConfig({
        BITCOIN_RPC_USER: 'u',
        BITCOIN_RPC_PASSWORD: 'p',
        BITCOIN_RPC_COOKIE_FILE: '/cookie',
      }),
    ).toThrow('authentication mode');
    expect(() =>
      loadConfig({
        BITCOIN_RPC_USER: 'u',
        BITCOIN_RPC_PASSWORD: 'p',
        CORE_RPC_MAX_CONCURRENCY: '-1',
      }),
    ).toThrow('CORE_RPC_MAX_CONCURRENCY');
    expect(() =>
      loadConfig({
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
    const config = loadConfig({
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
