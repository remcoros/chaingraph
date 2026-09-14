import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/Domain/types';
import { spendingNotice } from '../src/App/Workspace/ChainData/spendingNotice';

const tx: Transaction = {
  txid: 'a'.repeat(64),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
};
const empty = { transactions: [], truncated: false };
const signal = () => new AbortController().signal;
const respond = (result: unknown) => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result }) });
  vi.stubGlobal('fetch', fetch);
  return fetch;
};
afterEach(() => vi.unstubAllGlobals());

describe('spending lookup feedback', () => {
  it.each(['index', 'electrum-fallback'] as const)(
    'keeps successful %s lookups silent without an extra RPC',
    async (lookup) => {
      const fetch = respond(null);
      expect(
        await spendingNotice(
          { transactions: [tx], truncated: false, lookup },
          tx,
          'mainnet',
          0,
          signal(),
        ),
      ).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('confirms unspent status against the exact output including mempool spends', async () => {
    const fetch = respond({
      bestblock: 'b'.repeat(64),
      confirmations: 3,
      value: 1,
      scriptPubKey: { hex: '51' },
      coinbase: true,
    });
    expect(await spendingNotice(empty, tx, 'testnet4', 0, signal())).toContain(
      'Unspent at this check',
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      network: 'testnet4',
      method: 'gettxout',
      params: [tx.txid, 0, true],
    });
  });

  it('reports an absent UTXO without claiming a spending transaction exists', async () => {
    respond(null);
    expect(await spendingNotice(empty, tx, 'mainnet', 0, signal())).toContain(
      "Not in your node's current UTXO set. Spending transaction not found.",
    );
  });

  it('does not confirm unspent status from a mismatched node response', async () => {
    respond({
      bestblock: 'b'.repeat(64),
      confirmations: 3,
      value: 2,
      scriptPubKey: { hex: '51' },
      coinbase: true,
    });
    expect(await spendingNotice(empty, tx, 'mainnet', 0, signal())).toContain(
      'Current UTXO status could not be checked',
    );
  });

  it('retains actionable partial-search feedback even when some spenders were added', async () => {
    const fetch = respond(null);
    expect(
      await spendingNotice(
        { transactions: [tx], truncated: true, nextOffset: 500 },
        tx,
        'mainnet',
        0,
        signal(),
      ),
    ).toContain('check the next batch');
    expect(
      await spendingNotice({ transactions: [tx], truncated: true }, tx, 'mainnet', 0, signal()),
    ).toContain('could not be checked. Try again.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fan out UTXO checks for transaction-wide searches', async () => {
    const fetch = respond(null);
    expect(await spendingNotice(empty, tx, 'mainnet', undefined, signal())).toContain(
      'No spending transactions found for these outputs',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('identifies OP_RETURN without confusing an absent UTXO with a spend', async () => {
    const fetch = respond(null);
    const unspendable = { ...tx, vout: [{ ...tx.vout[0], scriptPubKey: { hex: '6a' } }] };
    expect(await spendingNotice(empty, unspendable, 'mainnet', 0, signal())).toContain(
      'OP_RETURN output; unspendable',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('discards a result that arrives after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        return { ok: true, json: async () => ({ result: null }) };
      }),
    );
    await expect(spendingNotice(empty, tx, 'mainnet', 0, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
