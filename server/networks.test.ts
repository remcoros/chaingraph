import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { loadConfig, loadNetworkConfig, type Network } from './config';

const queryHash = 'a'.repeat(64);
const genesis = { mainnet: 'c'.repeat(64), testnet4: 'd'.repeat(64) };
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
interface Rpc {
  id: number;
  method: string;
  params: unknown[];
}
async function listen(server: http.Server | net.Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as net.AddressInfo).port;
}
async function upstream(network: Network) {
  const coreCalls: Rpc[] = [],
    electrumCalls: Rpc[] = [];
  const coreSockets = new Set<net.Socket>(),
    electrumSockets = new Set<net.Socket>();
  const state = {
    stallCore: false,
    stallElectrum: false,
    disconnectNext: false,
    badGenesis: false,
    badChain: false,
  };
  const height = network === 'mainnet' ? 900000 : 151000;
  const core = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const call = JSON.parse(text) as Rpc;
    coreCalls.push(call);
    expect(req.headers.authorization).toBe(
      `Basic ${Buffer.from(`${network}:public-${network}`).toString('base64')}`,
    );
    if (state.stallCore) return;
    const result =
      call.method === 'getblockchaininfo'
        ? {
            chain: state.badChain ? 'test' : network === 'mainnet' ? 'main' : 'testnet4',
            blocks: height,
          }
        : call.method === 'getblockhash'
          ? genesis[network]
          : { network, txid: call.params[0] };
    res.end(JSON.stringify({ id: call.id, result }));
  });
  core.on('connection', (socket) => {
    coreSockets.add(socket);
    socket.on('close', () => coreSockets.delete(socket));
  });
  const corePort = await listen(core);
  cleanup.push(() => core.closeAllConnections());
  const electrum = net.createServer((socket) => {
    electrumSockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => electrumSockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const call = JSON.parse(buffer.slice(0, end)) as Rpc;
        buffer = buffer.slice(end + 1);
        electrumCalls.push(call);
        if (call.method === 'blockchain.transaction.get' && state.stallElectrum) continue;
        if (call.method === 'blockchain.transaction.get' && state.disconnectNext) {
          state.disconnectNext = false;
          socket.destroy();
          return;
        }
        const result =
          call.method === 'server.version'
            ? [`public-${network}`, '1.4']
            : call.method === 'server.features'
              ? {
                  genesis_hash: state.badGenesis ? queryHash : genesis[network],
                  hash_function: 'sha256',
                }
              : call.method === 'server.ping'
                ? null
                : call.method === 'blockchain.headers.subscribe'
                  ? { height, hex: '00'.repeat(80) }
                  : call.method === 'blockchain.scripthash.get_history'
                    ? [{ tx_hash: queryHash, height }]
                    : { network, txid: call.params[0] };
        // Notification traffic remains local to this pair and cannot satisfy another request ID.
        socket.write(
          JSON.stringify({ method: 'blockchain.headers.subscribe', params: [{ height }] }) + '\n',
        );
        socket.write(JSON.stringify({ id: call.id, result }) + '\n');
      }
    });
  });
  const electrumPort = await listen(electrum);
  cleanup.push(() => {
    for (const socket of electrumSockets) socket.destroy();
  });
  const config = loadNetworkConfig(network, {
    BITCOIN_RPC_URL: `http://127.0.0.1:${corePort}`,
    BITCOIN_RPC_USER: network,
    BITCOIN_RPC_PASSWORD: `public-${network}`,
    FULCRUM_HOST: '127.0.0.1',
    FULCRUM_PORT: String(electrumPort),
    UPSTREAM_REQUEST_TIMEOUT_MS: '2000',
    CORE_RPC_MAX_CONCURRENCY: '1',
    CORE_RPC_MAX_PENDING: '0',
    FULCRUM_MAX_CONCURRENCY: '1',
    FULCRUM_MAX_PENDING: '0',
  });
  return { state, config, height, coreCalls, electrumCalls, coreSockets, electrumSockets };
}
async function fixture(onlyMainnet = false) {
  const mainnet = await upstream('mainnet');
  const testnet4 = onlyMainnet ? undefined : await upstream('testnet4');
  const config = loadConfig(
    {},
    { mainnet: mainnet.config, ...(testnet4 ? { testnet4: testnet4.config } : {}) },
  );
  const application = createApp(config, { staticDirectory: false });
  const server = http.createServer(application.app);
  const port = await listen(server);
  cleanup.push(() => {
    application.close();
    server.closeAllConnections();
  });
  const base = `http://127.0.0.1:${port}`;
  const rpc = (
    network: string | undefined,
    target = 'core',
    method = 'getrawtransaction',
    params: unknown[] = [queryHash],
    signal?: AbortSignal,
  ) =>
    fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ network, target, method, params }),
      signal,
    });
  const status = (network: string) =>
    fetch(`${base}/api/status?network=${network}`).then((response) => response.json());
  return { base, rpc, status, mainnet, testnet4, close: application.close };
}

describe('simultaneous network routing and isolation', () => {
  it('routes identical transaction IDs, script hashes and subscription requests to independent pairs', async () => {
    const f = await fixture();
    expect(await (await fetch(`${f.base}/api/networks`)).json()).toEqual({
      networks: ['mainnet', 'testnet4'],
    });
    for (const network of ['mainnet', 'testnet4'] as const) {
      expect(await (await f.rpc(network)).json()).toEqual({ result: { network, txid: queryHash } });
      expect(
        await (
          await f.rpc(network, 'electrum', 'blockchain.scripthash.get_history', [queryHash])
        ).json(),
      ).toEqual({ result: [{ tx_hash: queryHash, height: f[network]!.height }] });
      expect(
        await (await f.rpc(network, 'electrum', 'blockchain.headers.subscribe', [])).json(),
      ).toMatchObject({ result: { height: f[network]!.height } });
      expect(f[network]!.coreCalls.filter((call) => call.method === 'getblockhash')).toHaveLength(
        1,
      );
      expect(
        f[network]!.electrumCalls.filter((call) => call.method === 'server.features'),
      ).toHaveLength(1);
    }
    const responses = await Promise.all([f.rpc('mainnet'), f.rpc('testnet4')]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { result: { network: 'mainnet', txid: queryHash } },
      { result: { network: 'testnet4', txid: queryHash } },
    ]);
  });
  it('rejects absent, invalid and unconfigured networks before touching any upstream', async () => {
    const f = await fixture(true);
    expect(await (await fetch(`${f.base}/api/networks`)).json()).toEqual({ networks: ['mainnet'] });
    for (const network of [undefined, 'testnet', '__proto__'])
      expect((await f.rpc(network)).status).toBe(400);
    const absent = await f.rpc('testnet4');
    expect(absent.status).toBe(404);
    expect(await absent.json()).toEqual({
      error: 'This backend does not support testnet4',
      code: 'network_not_configured',
    });
    expect((await fetch(`${f.base}/api/status`)).status).toBe(400);
    expect((await fetch(`${f.base}/api/status?network=mainnet&network=testnet4`)).status).toBe(400);
    expect((await fetch(`${f.base}/api/status?network=testnet4`)).status).toBe(404);
    expect(f.mainnet.coreCalls).toHaveLength(0);
    expect(f.mainnet.electrumCalls).toHaveLength(0);
  });
  it('keeps capability discovery and the healthy network responsive while another pair is saturated and cancelled', async () => {
    const f = await fixture();
    f.mainnet.state.stallCore = true;
    const controller = new AbortController();
    const held = f.rpc('mainnet', 'core', 'getrawtransaction', [queryHash], controller.signal);
    const aborted = expect(held).rejects.toThrow();
    await vi.waitFor(() => expect(f.mainnet.coreCalls).toHaveLength(1));
    expect((await f.rpc('mainnet')).status).toBe(503);
    expect(await (await fetch(`${f.base}/api/networks`)).json()).toEqual({
      networks: ['mainnet', 'testnet4'],
    });
    expect(await f.status('testnet4')).toMatchObject({ connected: true, network: 'testnet4' });
    controller.abort();
    await aborted;
    await vi.waitFor(() => expect(f.mainnet.coreSockets.size).toBe(0));
    f.mainnet.state.stallCore = false;
    expect(await f.status('mainnet')).toMatchObject({ connected: true, network: 'mainnet' });
    expect(await f.status('testnet4')).toMatchObject({ connected: true });
  });
  it('contains Electrum disconnect/reconnect and mismatched identities within their own network', async () => {
    const f = await fixture();
    f.mainnet.state.badGenesis = true;
    expect(
      (await f.rpc('mainnet', 'electrum', 'blockchain.transaction.get', [queryHash])).status,
    ).toBe(503);
    expect(
      f.mainnet.electrumCalls.some((call) => call.method === 'blockchain.transaction.get'),
    ).toBe(false);
    expect(await f.status('testnet4')).toMatchObject({ connected: true });
    f.mainnet.state.badGenesis = false;
    for (const socket of f.mainnet.electrumSockets) socket.destroy();
    await vi.waitFor(() => expect(f.mainnet.electrumSockets.size).toBe(0));
    f.mainnet.state.disconnectNext = true;
    expect(
      (await f.rpc('mainnet', 'electrum', 'blockchain.transaction.get', [queryHash])).status,
    ).toBe(502);
    expect(
      await (await f.rpc('mainnet', 'electrum', 'blockchain.transaction.get', [queryHash])).json(),
    ).toEqual({ result: { network: 'mainnet', txid: queryHash } });
    expect(
      f.testnet4!.electrumCalls.filter((call) => call.method === 'server.version'),
    ).toHaveLength(1);
    f.mainnet.state.badChain = true;
    expect(await f.status('mainnet')).toMatchObject({ connected: false, network: 'mainnet' });
    expect(await f.status('testnet4')).toMatchObject({ connected: true, network: 'testnet4' });
  });
  it('closes both pairs and releases held Electrum work on application shutdown', async () => {
    const f = await fixture();
    await Promise.all([f.status('mainnet'), f.status('testnet4')]);
    f.mainnet.state.stallElectrum = true;
    f.testnet4!.state.stallElectrum = true;
    const pending = Promise.all(
      ['mainnet', 'testnet4'].map((network) =>
        f.rpc(network, 'electrum', 'blockchain.transaction.get', [queryHash]),
      ),
    );
    await vi.waitFor(() => {
      expect(f.mainnet.electrumCalls.at(-1)?.method).toBe('blockchain.transaction.get');
      expect(f.testnet4!.electrumCalls.at(-1)?.method).toBe('blockchain.transaction.get');
    });
    f.close();
    expect((await pending).map((response) => response.status)).toEqual([503, 503]);
    await vi.waitFor(() => {
      expect(f.mainnet.electrumSockets.size + f.testnet4!.electrumSockets.size).toBe(0);
      expect(f.mainnet.coreSockets.size + f.testnet4!.coreSockets.size).toBe(0);
    });
  });
});
