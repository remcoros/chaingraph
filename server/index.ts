import { loadEnvironment } from './config';
import { createApp } from './app';

try {
  const config = loadEnvironment();
  const { app, close } = createApp(config);
  const server = app.listen(config.port, config.host, () => {
    console.log(`ChainGraph listening on port ${config.port} (${config.network})`);
  });
  server.on('error', () => {
    console.error('Unable to start ChainGraph HTTP server');
    close();
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    close();
    server.close(() => {
      process.exitCode = 0;
    });
    const timeout = setTimeout(() => {
      server.closeAllConnections();
    }, 5000);
    timeout.unref();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  // Config values and underlying exception strings may contain credentials.
  console.error('Unable to start ChainGraph: check server configuration');
  process.exitCode = 1;
}
