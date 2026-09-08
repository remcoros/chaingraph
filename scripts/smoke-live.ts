import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app';
import { loadEnvironment, type Network } from '../server/config';

// Runtime configuration loads the named network files. Never print their contents,
// upstream addresses, transaction data or raw exception messages.
let step = 'configuration';
let close: (() => void) | undefined;
let server: http.Server | undefined;
try {
  const config = loadEnvironment({
    ...process.env,
    SERVER_HOST: '127.0.0.1',
    SERVER_PORT: process.env.SMOKE_PORT ?? '3300',
  });
  const instance = createApp(config, { staticDirectory: false });
  close = instance.close;
  server = http.createServer(instance.app);
  step = 'local listener';
  server.listen(config.port, config.host);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${config.port}`;
  const configured = Object.keys(config.networks) as Network[];
  step = 'network discovery';
  const discovery = await (await fetch(`${base}/api/networks`)).json();
  if (JSON.stringify(discovery.networks) !== JSON.stringify(configured)) throw new Error();
  const results = await Promise.all(
    configured.map(async (network) => {
      let stage = 'upstream status';
      let passed = 0;
      const rpc = async (target: 'core' | 'electrum', method: string, params: unknown[]) => {
        const response = await fetch(`${base}/api/rpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ network, target, method, params }),
          signal: AbortSignal.timeout(45000),
        });
        const body = await response.json();
        if (!response.ok || !Object.hasOwn(body, 'result')) throw new Error();
        return body.result;
      };
      try {
        const response = await fetch(`${base}/api/status?network=${network}`, {
          signal: AbortSignal.timeout(45000),
        });
        const status = await response.json();
        if (
          !response.ok ||
          !status.connected ||
          status.network !== network ||
          !Number.isSafeInteger(status.height)
        )
          throw new Error();
        passed++;
        stage = 'confirmed block hash';
        // Give an independently syncing Electrum server six blocks of headroom.
        const blockHash = await rpc('core', 'getblockhash', [Math.max(0, status.height - 6)]);
        if (typeof blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(blockHash)) throw new Error();
        passed++;
        stage = 'confirmed block transactions';
        const block = await rpc('core', 'getblock', [blockHash, 1]);
        if (!Array.isArray(block.tx) || typeof block.tx[0] !== 'string') throw new Error();
        passed++;
        stage = 'Core raw transaction';
        const raw = await rpc('core', 'getrawtransaction', [block.tx[0], false, blockHash]);
        if (typeof raw !== 'string' || !/^[0-9a-f]+$/.test(raw)) throw new Error();
        passed++;
        stage = 'Electrum matching transaction';
        if ((await rpc('electrum', 'blockchain.transaction.get', [block.tx[0], false])) !== raw)
          throw new Error();
        passed++;
        return { liveSmoke: 'passed', network, height: status.height, passed, failed: 0 };
      } catch {
        return { liveSmoke: 'failed', network, stage, passed, failed: 1 };
      }
    }),
  );
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some((result) => result.failed)) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ liveSmoke: 'failed', step, failed: 1 }));
  process.exitCode = 1;
} finally {
  close?.();
  if (server) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}
