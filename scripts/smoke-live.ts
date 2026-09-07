import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';

// Supply configuration through the process environment, for example:
// node --use-system-ca --env-file=.env.live --import tsx scripts/smoke-live.ts
// This script never reads an environment file or prints upstream data/credentials.
let step = 'configuration';
let passed = 0;
let close: (() => void) | undefined;
let server: http.Server | undefined;

try {
  const config = loadConfig({
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
  async function rpc(target: 'core' | 'electrum', method: string, params: unknown[]) {
    const response = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, method, params }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await response.json();
    if (!response.ok || !Object.hasOwn(body, 'result')) throw new Error();
    return body.result as unknown;
  }
  step = 'upstream status';
  const status = await (
    await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(45000) })
  ).json();
  if (
    !status.connected ||
    status.network !== config.network ||
    !Number.isSafeInteger(status.height)
  )
    throw new Error();
  passed++;
  step = 'Core latest block hash';
  const blockHash = await rpc('core', 'getblockhash', [status.height]);
  if (typeof blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(blockHash)) throw new Error();
  passed++;
  step = 'Core latest block transactions';
  const block = (await rpc('core', 'getblock', [blockHash, 1])) as { tx?: unknown };
  if (!Array.isArray(block.tx) || typeof block.tx[0] !== 'string') throw new Error();
  passed++;
  step = 'Core raw transaction';
  const raw = await rpc('core', 'getrawtransaction', [block.tx[0], false, blockHash]);
  if (typeof raw !== 'string' || !/^[0-9a-f]+$/.test(raw)) throw new Error();
  passed++;
  step = 'Electrum matching transaction';
  const electrum = await rpc('electrum', 'blockchain.transaction.get', [block.tx[0], false]);
  if (electrum !== raw) throw new Error();
  passed++;
  console.log(
    JSON.stringify({
      liveSmoke: 'passed',
      network: config.network,
      height: status.height,
      passed,
      failed: 0,
    }),
  );
} catch {
  console.error(JSON.stringify({ liveSmoke: 'failed', step, passed, failed: 1 }));
  process.exitCode = 1;
} finally {
  close?.();
  if (server) {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}
