import { describe, expect, it, vi } from 'vitest';
import { ancestryNotice, loadAncestors } from '../src/lib/tracing';
import type { Transaction } from '../src/domain/types';
const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number, parents: number[] = []): Transaction => ({
  txid: id(n),
  vin: parents.length ? parents.map((p) => ({ txid: id(p), vout: 0 })) : [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});
describe('bounded previous transaction tracing', () => {
  it('honors depth and traverses cached parents without fetching them again', async () => {
    const root = tx(1, [2, 3]),
      parent = tx(2, [4]),
      other = tx(3, [4]);
    const records = [parent, other, tx(4, [5]), tx(5)];
    const fetch = vi.fn(async (key: string) => records.find((t) => t.txid === key)!);
    const one = await loadAncestors([root], { [parent.txid]: parent }, 1, { fetch });
    expect(one.transactions.map((t) => t.txid)).toEqual([id(3)]);
    expect(one.resolvedTransactionIds).toEqual([id(1), id(2), id(3)]);
    fetch.mockClear();
    const two = await loadAncestors([root], { [parent.txid]: parent }, 2, { fetch });
    expect(new Set(two.transactions.map((t) => t.txid))).toEqual(new Set([id(3), id(4)]));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(two.resolvedTransactionIds).toEqual([id(1), id(2), id(3), id(4)]);
  });
  it('reports cached roots and direct parents for explicit promotion without revealing grandchildren', async () => {
    const root = tx(1, [2]),
      parent = tx(2, [3]),
      grandparent = tx(3);
    const fetch = vi.fn();
    const result = await loadAncestors(
      [root],
      { [parent.txid]: parent, [grandparent.txid]: grandparent },
      1,
      { fetch },
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(result.transactions).toEqual([]);
    expect(result.resolvedTransactionIds).toEqual([root.txid, parent.txid]);
    expect(
      ancestryNotice(result, {
        transactions: { [root.txid]: root, [parent.txid]: parent },
        inputContext: { [parent.txid]: [0] },
      }),
    ).toBe(
      'Expanded 1 cached input transaction to show all inputs and outputs. No repeat download needed.',
    );
    expect(ancestryNotice(result, { transactions: { [parent.txid]: parent } })).toContain(
      'already visible',
    );
  });
  it('limits both levels together to 500 lookups and reports partial expansion', async () => {
    const roots = [
      tx(
        1,
        Array.from({ length: 150 }, (_, n) => n + 2),
      ),
    ];
    let active = 0,
      peak = 0;
    const fetch = vi.fn(async (key: string) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      const n = Number.parseInt(key, 16);
      return tx(n, n < 200 ? [n * 10 + 1000, n * 10 + 1001, n * 10 + 1002] : []);
    });
    const result = await loadAncestors(roots, {}, 2, { fetch });
    expect(fetch).toHaveBeenCalledTimes(500);
    expect(result.transactions).toHaveLength(500);
    expect(result.truncated).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
  });
  it('retains successful branches when a previous transaction is unavailable', async () => {
    const result = await loadAncestors([tx(1, [2, 3])], {}, 2, {
      fetch: async (key) => {
        if (key === id(2)) throw new Error('unavailable');
        return tx(3);
      },
    });
    expect(result.failed).toBe(1);
    expect(result.resolvedTransactionIds).toEqual([id(1), id(3)]);
    expect(result.transactions.map((t) => t.txid)).toEqual([id(3)]);
    expect(ancestryNotice(result, { transactions: {} })).toBe(
      '1 previous transaction added. 1 previous transaction could not be loaded. Retry the path to continue.',
    );
  });
  it('describes a coinbase root without a zero-added failure message', async () => {
    const result = await loadAncestors([tx(1)], {}, 1, { fetch: vi.fn() });
    expect(ancestryNotice(result, { transactions: {} })).toBe(
      'Coinbase transaction: no previous inputs to load.',
    );
  });
  it('does not begin work after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn();
    await expect(
      loadAncestors([tx(1, [2])], {}, 1, { signal: controller.signal, fetch }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
