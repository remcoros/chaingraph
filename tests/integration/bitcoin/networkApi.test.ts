import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backendNetworks,
  backendStatus,
  fetchTransaction,
  loadSpending,
  rpc,
} from '../../../src/Infra/Bitcoin/api';
import { newWorkspace } from '../../../src/Domain/Workspace/workspace';
import type { Network } from '../../../src/Domain/Chain/network';
import type { Transaction } from '../../../src/Domain/Chain/transaction';

const id = (number: number) => number.toString(16).padStart(64, '0');
const transaction = (txid: string, value = 1): Transaction => ({
  txid,
  vin: [{ coinbase: '0101' }],
  vout: [{ n: 0, value, scriptPubKey: { hex: '51' } }],
});
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
afterEach(() => vi.unstubAllGlobals());

describe('explicit Bitcoin network transport', () => {
  it('discovers configured networks independently from upstream health', async () => {
    const fetch = vi.fn(async (_url: string) => response({ networks: ['testnet4', 'mainnet'] }));
    vi.stubGlobal('fetch', fetch);
    expect(await backendNetworks()).toEqual(['testnet4', 'mainnet']);
    expect(fetch.mock.calls[0][0]).toBe('/api/networks');
  });

  it.each([
    null,
    {},
    { networks: 'mainnet' },
    { networks: ['mainnet', 'mainnet'] },
    { networks: ['testnet'] },
    { networks: ['mainnet', 'testnet4', 'regtest'] },
  ])('rejects invalid capability documents: %j', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(payload)),
    );
    await expect(backendNetworks()).rejects.toThrow('invalid network capabilities');
  });

  it('accepts an explicit empty capability list without inventing a default network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ networks: [] })),
    );
    expect(await backendNetworks()).toEqual([]);
  });

  it('checks each requested network and rejects a mismatched or malformed status', async () => {
    const fetch = vi.fn(async (url: string) =>
      response({
        network: new URL(url, 'http://localhost').searchParams.get('network'),
        connected: url.endsWith('testnet4'),
        height: 123,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await backendStatus('mainnet')).toMatchObject({ network: 'mainnet', connected: false });
    expect(await backendStatus('testnet4')).toMatchObject({ network: 'testnet4', connected: true });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/status?network=mainnet',
      '/api/status?network=testnet4',
    ]);
    fetch.mockResolvedValueOnce(response({ network: 'testnet4', connected: true, height: 123 }));
    await expect(backendStatus('mainnet')).rejects.toThrow('different Bitcoin network');
    fetch.mockResolvedValueOnce(response({ network: 'mainnet', connected: 'yes', height: -1 }));
    await expect(backendStatus('mainnet')).rejects.toThrow('invalid network status');
  });

  it('rejects a missing or unsupported request network before sending anything', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const network of [undefined, 'regtest']) {
      await expect(rpc(network as Network, 'core', 'getblockcount', [])).rejects.toThrow(
        'Choose mainnet or testnet4',
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains the initiating network when Core fails after another network request finishes', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const calls: { network: Network; target: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(init.body as string);
        calls.push({ network: request.network, target: request.target });
        if (request.network === 'mainnet' && request.target === 'core') {
          await blocked;
          return response({ error: 'Synthetic Core lookup unavailable' }, false);
        }
        return response({ result: transaction(id(1), request.network === 'mainnet' ? 1 : 2) });
      }),
    );
    const mainnet = fetchTransaction('mainnet', id(1));
    const testnet = await fetchTransaction('testnet4', id(1));
    expect(testnet.vout[0].value).toBe(2);
    release();
    expect((await mainnet).vout[0].value).toBe(1);
    expect(calls).toEqual([
      { network: 'mainnet', target: 'core' },
      { network: 'testnet4', target: 'core' },
      { network: 'mainnet', target: 'electrum' },
    ]);
  });

  it('requests verbosity 2 and retries verbosity 1 only for unavailable Core prevout data', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(init.body as string);
        calls.push(request);
        if (request.target === 'core' && request.params[1] === 2)
          return response(
            {
              error: 'Bitcoin RPC previous-output data is unavailable',
              code: 'core_prevout_unavailable',
            },
            false,
          );
        return response({ result: transaction(id(1)) });
      }),
    );
    expect(await fetchTransaction('mainnet', id(1))).toEqual(transaction(id(1)));
    expect(calls).toEqual([
      { target: 'core', params: [id(1), 2], network: 'mainnet', method: 'getrawtransaction' },
      { target: 'core', params: [id(1), 1], network: 'mainnet', method: 'getrawtransaction' },
    ]);
  });

  it('does not retry verbosity 1 for unrelated Core failures and deduplicates one signal scope', async () => {
    const calls: unknown[] = [];
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(init.body as string);
        calls.push(request);
        await Promise.resolve();
        return request.target === 'core'
          ? response({ error: 'Bitcoin RPC rejected the request' }, false)
          : response({ result: transaction(id(1)) });
      }),
    );
    const [first, second] = await Promise.all([
      fetchTransaction('mainnet', id(1), controller.signal),
      fetchTransaction('mainnet', id(1), controller.signal),
    ]);
    expect(first).toEqual(second);
    expect(calls).toEqual([
      { target: 'core', params: [id(1), 2], network: 'mainnet', method: 'getrawtransaction' },
      {
        target: 'electrum',
        params: [id(1), true],
        network: 'mainnet',
        method: 'blockchain.transaction.get',
      },
    ]);
  });

  it('keeps concurrent spending scans bounded and isolated even when both chains use the same script hash and IDs', async () => {
    const active = { mainnet: 0, testnet4: 0 };
    const peak = { mainnet: 0, testnet4: 0 };
    const calls: { network: Network; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const request = JSON.parse(init.body as string) as {
          network: Network;
          method: string;
          params: string[];
        };
        calls.push(request);
        if (request.method === 'blockchain.scripthash.get_history')
          return response({
            result: Array.from({ length: 12 }, (_, index) => ({
              tx_hash: id(index + 2),
              height: 100,
            })),
          });
        peak[request.network] = Math.max(peak[request.network], ++active[request.network]);
        await Promise.resolve();
        active[request.network]--;
        return response({
          result: {
            ...transaction(request.params[0], request.network === 'mainnet' ? 1 : 2),
            vin: [{ txid: id(1), vout: 0 }],
          },
        });
      }),
    );
    const funding = transaction(id(1));
    const scan = (network: Network) => {
      const workspace = newWorkspace(`Public ${network} fixture`, network);
      workspace.transactions[funding.txid] = funding;
      return loadSpending(funding, workspace, 0);
    };
    const [mainnet, testnet] = await Promise.all([scan('mainnet'), scan('testnet4')]);
    expect(mainnet.transactions).toHaveLength(12);
    expect(testnet.transactions).toHaveLength(12);
    expect(mainnet.transactions.every((tx) => tx.vout[0].value === 1)).toBe(true);
    expect(testnet.transactions.every((tx) => tx.vout[0].value === 2)).toBe(true);
    for (const network of ['mainnet', 'testnet4'] as const) {
      expect(peak[network]).toBeGreaterThan(1);
      expect(peak[network]).toBeLessThanOrEqual(4);
      expect(
        calls.filter(
          (call) => call.network === network && call.method === 'blockchain.scripthash.get_history',
        ),
      ).toHaveLength(1);
      expect(
        calls.filter((call) => call.network === network && call.method === 'getrawtransaction'),
      ).toHaveLength(12);
    }
  });
});
