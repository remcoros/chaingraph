import { spawn } from 'node:child_process';
import { loadEnvironment } from '../server/config';

// Node loads .env.live directly when requested. Only the backend child inherits
// upstream credentials; Vite receives a small explicit environment.
try {
  const config = loadEnvironment();
  const webPort = 3001;
  const host =
    config.host === '0.0.0.0'
      ? '127.0.0.1'
      : config.host === '::'
        ? '[::1]'
        : config.host.includes(':')
          ? `[${config.host}]`
          : config.host;
  const allowed = [
    ...new Set([
      ...config.allowedOrigins,
      `http://127.0.0.1:${webPort}`,
      `http://localhost:${webPort}`,
    ]),
  ].join(',');
  const server = spawn(
    process.execPath,
    ['--use-system-ca', '--import', 'tsx', '--watch', 'server/index.ts'],
    { stdio: 'inherit', env: { ...process.env, CORS_ALLOW_ORIGINS: allowed } },
  );
  const web = spawn(
    process.execPath,
    [
      '--use-system-ca',
      'node_modules/vite/bin/vite.js',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--strictPort',
    ],
    {
      stdio: 'inherit',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_OPTIONS: '--use-system-ca',
        CHAINGRAPH_PROXY_TARGET: `http://${host}:${config.port}`,
      },
    },
  );
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    server.kill('SIGTERM');
    web.kill('SIGTERM');
    process.exitCode = code;
  };
  server.on('error', () => {
    console.error('Backend process could not start.');
    stop(1);
  });
  web.on('error', () => {
    console.error('Frontend process could not start.');
    stop(1);
  });
  server.on('exit', (code) => stop(code ?? 0));
  web.on('exit', (code) => stop(code ?? 0));
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
} catch {
  console.error('Unable to start development servers: check configuration.');
  process.exitCode = 1;
}
