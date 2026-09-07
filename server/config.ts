import { config as dotenv } from 'dotenv';

export interface ServerConfig {
  network: 'mainnet' | 'testnet4';
  coreUrl: string;
  coreUser?: string;
  corePassword?: string;
  coreCookieFile?: string;
  electrumHost: string;
  electrumPort: number;
  electrumTls: boolean;
  host: string;
  port: number;
  allowedOrigins: string[];
  handlerTimeoutMs: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  queueTimeoutMs: number;
  coreConcurrency: number;
  corePending: number;
  electrumConcurrency: number;
  electrumPending: number;
  maxResponseBytes: number;
  maxHistory: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

/** Reads the supplied environment only. dotenv loads .env, never .env.live. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const integer = (name: string, fallback: number, min = 1, max = 2_147_483_647) => {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw)) throw new Error(`Invalid configuration: ${name}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid configuration: ${name}`);
    return value;
  };
  const network = env.BITCOIN_NETWORK ?? 'testnet4';
  if (network !== 'mainnet' && network !== 'testnet4')
    throw new Error('Invalid configuration: BITCOIN_NETWORK');
  let coreUrl: URL;
  try {
    coreUrl = new URL(env.BITCOIN_RPC_URL ?? 'http://127.0.0.1:48332');
  } catch {
    throw new Error('Invalid configuration: BITCOIN_RPC_URL');
  }
  if (
    !['http:', 'https:'].includes(coreUrl.protocol) ||
    coreUrl.username ||
    coreUrl.password ||
    coreUrl.search ||
    coreUrl.hash
  )
    throw new Error('Invalid configuration: BITCOIN_RPC_URL');
  const coreUser = env.BITCOIN_RPC_USER,
    corePassword = env.BITCOIN_RPC_PASSWORD,
    coreCookieFile = env.BITCOIN_RPC_COOKIE_FILE;
  const anyPasswordAuth = coreUser !== undefined || corePassword !== undefined;
  if (coreCookieFile ? anyPasswordAuth : anyPasswordAuth && (!coreUser || !corePassword))
    throw new Error('Configure exactly one Bitcoin RPC authentication mode');
  if (!['true', 'false'].includes(env.FULCRUM_TLS ?? 'false'))
    throw new Error('Invalid configuration: FULCRUM_TLS');
  const allowedOrigins = (env.CORS_ALLOW_ORIGINS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      throw new Error('Invalid configuration: CORS_ALLOW_ORIGINS');
    }
  }
  return {
    network,
    coreUrl: coreUrl.href,
    coreUser,
    corePassword,
    coreCookieFile,
    electrumHost: env.FULCRUM_HOST ?? '127.0.0.1',
    electrumPort: integer('FULCRUM_PORT', 51001, 1, 65535),
    electrumTls: env.FULCRUM_TLS === 'true',
    host: env.SERVER_HOST ?? '127.0.0.1',
    port: integer('SERVER_PORT', 3000, 1, 65535),
    allowedOrigins,
    handlerTimeoutMs: integer('SERVER_HANDLER_TIMEOUT_MS', 120000),
    connectTimeoutMs: integer('UPSTREAM_CONNECT_TIMEOUT_MS', 10000),
    requestTimeoutMs: integer('UPSTREAM_REQUEST_TIMEOUT_MS', 30000),
    queueTimeoutMs: integer('UPSTREAM_QUEUE_TIMEOUT_MS', 30000),
    coreConcurrency: integer('CORE_RPC_MAX_CONCURRENCY', 16, 1, 256),
    corePending: integer('CORE_RPC_MAX_PENDING', 256, 0, 10000),
    electrumConcurrency: integer('FULCRUM_MAX_CONCURRENCY', 8, 1, 256),
    electrumPending: integer('FULCRUM_MAX_PENDING', 256, 0, 10000),
    maxResponseBytes: integer('MAX_RESPONSE_BYTES', 5242880, 1024, 67108864),
    maxHistory: integer('MAX_ADDRESS_HISTORY_TXS', 1000, 1, 1000000),
    rateLimitMax: integer('RATE_LIMIT_MAX', 0, 0),
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60000),
  };
}

export function loadEnvironment(): ServerConfig {
  dotenv({ quiet: true });
  return loadConfig();
}
