import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSpending } from '../src/lib/api';
import { newWorkspace } from '../src/domain/workspace';
import type { Transaction } from '../src/domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const rootId = 'f'.repeat(64);
const output = (n: number, hex = '51') => ({ n, value: 1, scriptPubKey: { hex } });
const root: Transaction = {
  txid: rootId,
  vin: [{ coinbase: '00' }],
  vout: [output(0), output(1, '52')],
};
const workspace = () => ({
  ...newWorkspace('Spending regression', 'testnet4'),
  transactions: { [rootId]: root },
});
const candidate = (txid: string, vin: Transaction['vin'] = [{ coinbase: '00' }]): Transaction => ({
  txid,
  vin,
  vout: [output(0)],
  confirmations: 1,
});
const scriptHash = (hex: string) =>
  createHash('sha256').update(Buffer.from(hex, 'hex')).digest().reverse().toString('hex');

function mockedRpc(history: string[], transactions: Map<string, Transaction>) {
  const requests: { target: string; method: string; params: unknown[] }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      requests.push(request);
      const result =
        request.method === 'blockchain.scripthash.get_history'
          ? history.map((tx_hash) => ({ tx_hash, height: 1 }))
          : transactions.get(request.params[0]);
      if (result === undefined) throw new Error('Unexpected mocked transaction request');
      return new Response(JSON.stringify({ result }), {
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

describe('spending expansion', () => {
  it('continues beyond 500 candidates in deterministic order and reaches the spender', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => id(i + 1));
    const transactions = new Map(ids.map((txid) => [txid, candidate(txid)]));
    transactions.set(id(501), candidate(id(501), [{ txid: rootId, vout: 0 }]));
    const requests = mockedRpc([...ids].reverse(), transactions);
    const w = workspace();
    const first = await loadSpending(root, w, 0);
    expect(first).toEqual({ transactions: [], truncated: true, nextOffset: 500 });
    const firstIds = requests
      .filter((r) => r.method === 'getrawtransaction')
      .map((r) => r.params[0]);
    expect(firstIds).toHaveLength(500);
    expect(new Set(firstIds)).toEqual(new Set(ids.slice(0, 500)));
    const second = await loadSpending(root, w, 0, undefined, first.nextOffset);
    expect(second).toEqual({ transactions: [transactions.get(id(501))], truncated: false });
    expect(requests.filter((r) => r.method === 'getrawtransaction')).toHaveLength(501);
  });

  it('hashes raw scripts without addresses and matches the exact selected outpoint', async () => {
    const transactions = new Map([
      [id(1), candidate(id(1), [{ txid: rootId, vout: 0 }])],
      [id(2), candidate(id(2), [{ txid: rootId, vout: 1 }])],
      [id(3), candidate(id(3), [{ txid: id(4), vout: 0 }])],
    ]);
    const requests = mockedRpc([rootId, id(1), id(2), id(3), id(1)], transactions);
    const result = await loadSpending(root, workspace(), 0);
    expect(result.transactions.map((t) => t.txid)).toEqual([id(1)]);
    expect(result.truncated).toBe(false);
    expect(requests[0]).toEqual({
      target: 'electrum',
      method: 'blockchain.scripthash.get_history',
      params: [scriptHash('51')],
    });
    expect(requests.filter((r) => r.method === 'getrawtransaction')).toHaveLength(3);
  });

  it('searches all script outputs and reuses already loaded matching transactions', async () => {
    const spender = candidate(id(1), [{ txid: rootId, vout: 1 }]);
    const requests = mockedRpc([rootId, id(1)], new Map());
    const w = workspace();
    w.transactions[id(1)] = spender;
    const result = await loadSpending(root, w, undefined);
    expect(result.transactions).toEqual([spender]);
    expect(requests.map((r) => r.params[0])).toEqual([scriptHash('51'), scriptHash('52')]);
  });

  it('retains partial status when some outputs have no searchable script or address', async () => {
    mockedRpc([], new Map());
    const partial: Transaction = {
      ...root,
      vout: [output(0), { n: 1, value: 1, scriptPubKey: {} }],
    };
    await expect(loadSpending(partial, workspace(), undefined)).resolves.toEqual({
      transactions: [],
      truncated: true,
    });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid continuation offset %s before making requests',
    async (offset) => {
      const requests = mockedRpc([], new Map());
      await expect(loadSpending(root, workspace(), 0, undefined, offset)).rejects.toThrow(
        'nonnegative safe integer',
      );
      expect(requests).toHaveLength(0);
    },
  );
});
