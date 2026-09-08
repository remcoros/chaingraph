import { describe, expect, it, vi } from 'vitest';
import { loadAncestors } from '../src/lib/tracing';
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
    fetch.mockClear();
    const two = await loadAncestors([root], { [parent.txid]: parent }, 2, { fetch });
    expect(new Set(two.transactions.map((t) => t.txid))).toEqual(new Set([id(3), id(4)]));
    expect(fetch).toHaveBeenCalledTimes(2);
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
    expect(result.transactions.map((t) => t.txid)).toEqual([id(3)]);
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
