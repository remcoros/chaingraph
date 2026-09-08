import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, loadEnvironment, loadNetworkConfig } from './config';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const values = (network: string) => ({
  BITCOIN_RPC_URL: `https://${network}.invalid:8332`,
  BITCOIN_RPC_USER: `${network}-user`,
  BITCOIN_RPC_PASSWORD: `${network}-password`,
  FULCRUM_HOST: `${network}-electrum.invalid`,
  FULCRUM_PORT: network === 'mainnet' ? '50002' : '51002',
  FULCRUM_TLS: 'true',
});
const text = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}='${value}'`)
    .join('\n');
async function directory() {
  const value = await mkdtemp(path.join(tmpdir(), 'chaingraph-network-config-'));
  directories.push(value);
  return value;
}

describe('isolated runtime network configuration', () => {
  it('discovers both files without mixing credentials or mutating the process environment', async () => {
    const dir = await directory();
    const main = {
      ...values('mainnet'),
      BITCOIN_RPC_PASSWORD: 'literal$HOME${USER}#password',
      SERVER_PORT: '9999',
    };
    const test = {
      ...values('testnet4'),
      BITCOIN_RPC_PASSWORD: 'different-password',
      CORE_RPC_MAX_CONCURRENCY: '2',
    };
    await writeFile(path.join(dir, '.env.mainnet'), text(main));
    await writeFile(path.join(dir, '.env.testnet4'), text(test));
    const before = process.env.BITCOIN_RPC_PASSWORD;
    const config = loadEnvironment({
      ...values('ignored-ambient'),
      CHAINGRAPH_NETWORK_CONFIG_DIR: dir,
      SERVER_PORT: '4321',
    });
    expect(Object.keys(config.networks)).toEqual(['mainnet', 'testnet4']);
    expect(config.port).toBe(4321);
    expect(config.networks.mainnet).toMatchObject({
      network: 'mainnet',
      coreUser: 'mainnet-user',
      corePassword: main.BITCOIN_RPC_PASSWORD,
      electrumHost: 'mainnet-electrum.invalid',
      electrumTls: true,
      coreConcurrency: 16,
    });
    expect(config.networks.testnet4).toMatchObject({
      network: 'testnet4',
      coreUser: 'testnet4-user',
      corePassword: test.BITCOIN_RPC_PASSWORD,
      coreConcurrency: 2,
    });
    expect(process.env.BITCOIN_RPC_PASSWORD).toBe(before);
    expect(Object.isFrozen(config.networks.mainnet)).toBe(true);
    expect(Object.isFrozen(config.networks)).toBe(true);
  });
  it('supports either network alone and rejects absent files despite ambient upstream credentials', async () => {
    for (const network of ['mainnet', 'testnet4'] as const) {
      const dir = await directory();
      expect(() =>
        loadEnvironment({ ...values(network), CHAINGRAPH_NETWORK_CONFIG_DIR: dir }),
      ).toThrow('No network configuration found');
      await writeFile(path.join(dir, `.env.${network}`), text(values(network)));
      expect(Object.keys(loadEnvironment({ CHAINGRAPH_NETWORK_CONFIG_DIR: dir }).networks)).toEqual(
        [network],
      );
    }
  });
  it('rejects filename/network mismatches and partial configuration rather than borrowing another pair', async () => {
    const dir = await directory();
    await writeFile(path.join(dir, '.env.mainnet'), text(values('mainnet')));
    await writeFile(
      path.join(dir, '.env.testnet4'),
      text({ ...values('testnet4'), BITCOIN_NETWORK: 'mainnet' }),
    );
    expect(() => loadEnvironment({ CHAINGRAPH_NETWORK_CONFIG_DIR: dir })).toThrow(
      'Invalid testnet4 configuration file',
    );
    await writeFile(
      path.join(dir, '.env.testnet4'),
      'FULCRUM_HOST=testnet4.invalid\nFULCRUM_PORT=51002',
    );
    expect(() =>
      loadEnvironment({ ...values('mainnet'), CHAINGRAPH_NETWORK_CONFIG_DIR: dir }),
    ).toThrow('Invalid testnet4 configuration file');
  });
  it('retains cookie authentication and reports malformed or oversized files without their contents', async () => {
    const dir = await directory();
    const env = values('mainnet');
    delete (env as Partial<typeof env>).BITCOIN_RPC_USER;
    delete (env as Partial<typeof env>).BITCOIN_RPC_PASSWORD;
    await writeFile(
      path.join(dir, '.env.mainnet'),
      text({ ...env, BITCOIN_RPC_COOKIE_FILE: '/run/cookies/mainnet.cookie' }),
    );
    expect(
      loadEnvironment({ CHAINGRAPH_NETWORK_CONFIG_DIR: dir }).networks.mainnet?.coreCookieFile,
    ).toBe('/run/cookies/mainnet.cookie');
    await writeFile(
      path.join(dir, '.env.mainnet'),
      text({
        ...values('mainnet'),
        BITCOIN_RPC_URL: 'https://private-user:private-password@private.invalid',
      }),
    );
    expect(() => loadEnvironment({ CHAINGRAPH_NETWORK_CONFIG_DIR: dir })).toThrow(
      /^Invalid mainnet configuration file$/,
    );
    await writeFile(path.join(dir, '.env.mainnet'), 'secret'.repeat(12000));
    expect(() => loadEnvironment({ CHAINGRAPH_NETWORK_CONFIG_DIR: dir })).toThrow(
      /^Unable to load mainnet configuration file$/,
    );
    await rm(path.join(dir, '.env.mainnet'));
    await mkdir(path.join(dir, '.env.mainnet'));
    expect(() => loadEnvironment({ CHAINGRAPH_NETWORK_CONFIG_DIR: dir })).toThrow(
      /^Unable to load mainnet configuration file$/,
    );
  });
  it('rejects invalid shared/network bounds and validates configured pair identities', () => {
    const mainnet = loadNetworkConfig('mainnet', values('mainnet'));
    expect(() => loadConfig({}, {})).toThrow('at least one');
    expect(() => loadConfig({}, { testnet4: mainnet })).toThrow('valid network pair');
    expect(() =>
      loadConfig({ CORS_ALLOW_ORIGINS: 'https://host.invalid/path' }, { mainnet }),
    ).toThrow('CORS_ALLOW_ORIGINS');
    expect(() => loadNetworkConfig('mainnet', { ...values('mainnet'), FULCRUM_PORT: '0' })).toThrow(
      'FULCRUM_PORT',
    );
    expect(() =>
      loadNetworkConfig('mainnet', {
        ...values('mainnet'),
        FULCRUM_HOST: 'https://endpoint.invalid',
      }),
    ).toThrow('FULCRUM_HOST');
    expect(() =>
      loadNetworkConfig('mainnet', { ...values('mainnet'), BITCOIN_RPC_COOKIE_FILE: '/cookie' }),
    ).toThrow('authentication mode');
  });
});
