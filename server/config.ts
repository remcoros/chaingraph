import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

export const NETWORKS = ['mainnet', 'testnet4'] as const;
export type Network = (typeof NETWORKS)[number];
export interface NetworkConfig {
  readonly network: Network;
  readonly coreUrl: string;
  readonly coreUser?: string;
  readonly corePassword?: string;
  readonly coreCookieFile?: string;
  readonly electrumHost: string;
  readonly electrumPort: number;
  readonly electrumTls: boolean;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly queueTimeoutMs: number;
  readonly coreConcurrency: number;
  readonly corePending: number;
  readonly electrumConcurrency: number;
  readonly electrumPending: number;
  readonly maxResponseBytes: number;
  readonly maxHistory: number;
}
export interface ServerConfig {
  readonly networks: Readonly<Partial<Record<Network, NetworkConfig>>>;
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly handlerTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
}
function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min = 1,
  max = 2_147_483_647,
) {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid configuration: ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`Invalid configuration: ${name}`);
  return value;
}
function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value?.length) throw new Error(`Missing configuration: ${name}`);
  return value;
}
/** Parses one isolated file's values. Never consults or mutates process.env. */
export function loadNetworkConfig(network: Network, env: NodeJS.ProcessEnv): NetworkConfig {
  if (
    !NETWORKS.includes(network) ||
    (env.BITCOIN_NETWORK !== undefined && env.BITCOIN_NETWORK !== network)
  )
    throw new Error('Invalid configuration: BITCOIN_NETWORK does not match its configuration file');
  let coreUrl: URL;
  try {
    coreUrl = new URL(required(env, 'BITCOIN_RPC_URL'));
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
  const coreUser = env.BITCOIN_RPC_USER;
  const corePassword = env.BITCOIN_RPC_PASSWORD;
  const coreCookieFile = env.BITCOIN_RPC_COOKIE_FILE;
  const passwordAuth = coreUser !== undefined || corePassword !== undefined;
  if (coreCookieFile ? passwordAuth : !coreUser || !corePassword)
    throw new Error('Configure exactly one Bitcoin RPC authentication mode');
  if (!['true', 'false'].includes(env.FULCRUM_TLS ?? 'false'))
    throw new Error('Invalid configuration: FULCRUM_TLS');
  const electrumHost = required(env, 'FULCRUM_HOST');
  if (electrumHost.length > 253 || /[\s\/@?#]/.test(electrumHost))
    throw new Error('Invalid configuration: FULCRUM_HOST');
  required(env, 'FULCRUM_PORT');
  return Object.freeze({
    network,
    coreUrl: coreUrl.href,
    coreUser,
    corePassword,
    coreCookieFile,
    electrumHost,
    electrumPort: integer(env, 'FULCRUM_PORT', 0, 1, 65535),
    electrumTls: env.FULCRUM_TLS === 'true',
    connectTimeoutMs: integer(env, 'UPSTREAM_CONNECT_TIMEOUT_MS', 10000),
    requestTimeoutMs: integer(env, 'UPSTREAM_REQUEST_TIMEOUT_MS', 30000),
    queueTimeoutMs: integer(env, 'UPSTREAM_QUEUE_TIMEOUT_MS', 30000),
    coreConcurrency: integer(env, 'CORE_RPC_MAX_CONCURRENCY', 16, 1, 256),
    corePending: integer(env, 'CORE_RPC_MAX_PENDING', 256, 0, 10000),
    electrumConcurrency: integer(env, 'FULCRUM_MAX_CONCURRENCY', 8, 1, 256),
    electrumPending: integer(env, 'FULCRUM_MAX_PENDING', 256, 0, 10000),
    maxResponseBytes: integer(env, 'MAX_RESPONSE_BYTES', 5242880, 1024, 67108864),
    maxHistory: integer(env, 'MAX_ADDRESS_HISTORY_TXS', 1000, 1, 1000000),
  });
}
/** Shared HTTP settings only. Upstream values in env cannot affect the supplied pairs. */
export function loadConfig(
  env: NodeJS.ProcessEnv,
  networks: Partial<Record<Network, NetworkConfig>>,
): ServerConfig {
  const keys = Object.keys(networks);
  if (
    !keys.length ||
    keys.some(
      (key) => !NETWORKS.includes(key as Network) || networks[key as Network]?.network !== key,
    )
  )
    throw new Error('Configure at least one valid network pair');
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
  const host = env.SERVER_HOST ?? '127.0.0.1';
  if (!host || host.length > 253 || /[\s\/@?#]/.test(host))
    throw new Error('Invalid configuration: SERVER_HOST');
  return Object.freeze({
    networks: Object.freeze(
      Object.fromEntries(
        NETWORKS.filter((network) => networks[network]).map((network) => [
          network,
          Object.freeze({ ...networks[network]! }),
        ]),
      ),
    ),
    host,
    port: integer(env, 'SERVER_PORT', 3000, 1, 65535),
    allowedOrigins: Object.freeze(allowedOrigins),
    handlerTimeoutMs: integer(env, 'SERVER_HANDLER_TIMEOUT_MS', 120000),
    maxResponseBytes: integer(env, 'MAX_RESPONSE_BYTES', 5242880, 1024, 67108864),
    rateLimitMax: integer(env, 'RATE_LIMIT_MAX', 0, 0),
    rateLimitWindowMs: integer(env, 'RATE_LIMIT_WINDOW_MS', 60000),
  });
}
/** Runtime-only credential loading. No env-file content enters process.env or diagnostics. */
export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const directory = path.resolve(env.CHAINGRAPH_NETWORK_CONFIG_DIR ?? process.cwd());
  const networks: Partial<Record<Network, NetworkConfig>> = {};
  for (const network of NETWORKS) {
    const file = path.join(directory, `.env.${network}`);
    let content: string;
    try {
      const info = statSync(file);
      if (!info.isFile() || info.size > 65_536) throw new Error();
      content = readFileSync(file, 'utf8');
      if (Buffer.byteLength(content) > 65_536) throw new Error();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(`Unable to load ${network} configuration file`);
    }
    try {
      networks[network] = loadNetworkConfig(network, parse(content));
    } catch {
      throw new Error(`Invalid ${network} configuration file`);
    }
  }
  if (!Object.keys(networks).length)
    throw new Error('No network configuration found. Add .env.mainnet or .env.testnet4.');
  return loadConfig(env, networks);
}
