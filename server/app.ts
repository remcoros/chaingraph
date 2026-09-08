import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import type { ServerConfig } from './config';
import { NetworkRegistry } from './networks';
import { errorMessage, SafeError } from './errors';
import { parseRpc } from './rpc-schema';

export function createApp(
  config: ServerConfig,
  options: { staticDirectory?: string | false } = {},
) {
  const app = express();
  const networks = new NetworkRegistry(config);
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    next();
  });
  // Check Host as well as Origin to prevent DNS rebinding to a loopback service.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const allowedHosts = new Set([
      'localhost',
      '127.0.0.1',
      '[::1]',
      config.host,
      ...config.allowedOrigins.map((origin) => new URL(origin).hostname),
    ]);
    let hostname: string;
    try {
      hostname = new URL(`http://${req.headers.host ?? ''}`).hostname;
    } catch {
      res.status(403).json({ error: 'Host not allowed' });
      return;
    }
    if (!allowedHosts.has(hostname)) {
      res.status(403).json({ error: 'Host not allowed' });
      return;
    }
    const origin = req.headers.origin;
    const sameOrigin = `${req.protocol}://${req.headers.host}`;
    if (origin && origin !== sameOrigin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (!origin && req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  // One global window bounds work without retaining per-wallet or per-address data.
  let windowStart = Date.now(),
    requests = 0;
  app.use('/api', (_req, res, next) => {
    if (Date.now() - windowStart >= config.rateLimitWindowMs) {
      windowStart = Date.now();
      requests = 0;
    }
    if (config.rateLimitMax && ++requests > config.rateLimitMax) {
      res.status(429).json({ error: 'Rate limit reached; retry later' });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '16kb', strict: true }));
  const requestSignal = (res: express.Response, statusNetwork?: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (!res.headersSent)
        res
          .status(statusNetwork ? 200 : 504)
          .json(
            statusNetwork
              ? { network: statusNetwork, connected: false, error: 'Request timed out' }
              : { error: 'Request timed out' },
          );
    }, config.handlerTimeoutMs);
    res.once('close', () => {
      clearTimeout(timer);
      controller.abort();
    });
    return controller.signal;
  };
  // Discovery is independent of health: an unavailable pair cannot hide another.
  app.get('/api/networks', (_req, res) => res.json({ networks: networks.configured() }));
  app.get('/api/status', async (req, res) => {
    let pair: ReturnType<NetworkRegistry['get']>;
    try {
      pair = networks.get(req.query.network);
    } catch (error) {
      res.status(error instanceof SafeError ? error.status : 400).json({
        error: errorMessage(error),
        ...(error instanceof SafeError && error.code ? { code: error.code } : {}),
      });
      return;
    }
    const signal = requestSignal(res, pair.config.network);
    try {
      const info = await pair.core.chainInfo(signal);
      // Negotiated version is connection metadata; a fresh ping checks that the
      // server still answers after handshake, rather than reporting a stale socket.
      await pair.electrum.call('server.ping', [], await pair.genesis(signal), signal);
      if (!res.headersSent)
        res.json({ network: pair.config.network, connected: true, height: info.blocks });
    } catch (error) {
      if (!res.headersSent)
        res.json({ network: pair.config.network, connected: false, error: errorMessage(error) });
    }
  });
  app.post('/api/rpc', async (req, res) => {
    const signal = requestSignal(res);
    try {
      if (!req.is('application/json'))
        throw new SafeError('Content-Type must be application/json', 415);
      const { network, target, method, params } = parseRpc(req.body);
      const pair = networks.get(network);
      const info = await pair.core.chainInfo(signal);
      const result =
        target === 'core'
          ? method === 'getblockchaininfo'
            ? info
            : await pair.core.call(method, params, signal)
          : await pair.electrum.call(method, params, await pair.genesis(signal), signal);
      if (!res.headersSent) {
        const body = JSON.stringify({ result });
        if (
          Buffer.byteLength(body) > Math.min(config.maxResponseBytes, pair.config.maxResponseBytes)
        )
          throw new SafeError('Response exceeds configured size limit', 413);
        res.type('json').send(body);
      }
    } catch (error) {
      if (!res.headersSent)
        res.status(error instanceof SafeError ? error.status : 502).json({
          error: errorMessage(error),
          ...(error instanceof SafeError && error.code ? { code: error.code } : {}),
        });
    }
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });
  const directory =
    options.staticDirectory === false
      ? undefined
      : (options.staticDirectory ?? path.resolve('dist'));
  if (directory) {
    app.use(express.static(directory));
    app.get('/{*path}', (_req, res, next) => {
      res.sendFile(path.join(directory, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    const status =
      error?.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    res.status(status).json({
      error:
        status === 413
          ? 'Request too large'
          : status === 400
            ? 'Invalid JSON request'
            : 'Request failed',
    });
  };
  app.use(errors);
  return {
    app,
    close: () => networks.close(),
  };
}
