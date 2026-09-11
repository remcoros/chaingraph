import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendNetworks, fetchIndexedSpenders, loadSpending } from '../src/lib/api';
import { newWorkspace } from '../src/domain/workspace';
import type { Network, Transaction } from '../src/domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const point = { txid: id(1), vout: 0 };
const root: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: n ? '52' : '51' } })),
};
const spender: Transaction = { txid: id(2), vin: [point], vout: [root.vout[0]] };
const workspace = () => ({
  ...newWorkspace('Public index fixture', 'testnet4'),
  transactions: { [root.txid]: root },
});
type Call = { network: Network; target: string; method: string; params: any[] };
const ok = (result: unknown) => new Response(JSON.stringify({ result }));
const error = () =>
  new Response(JSON.stringify({ error: 'Lookup unavailable', code: 'core_spender_unavailable' }), {
    status: 503,
  });
let calls: Call[];
let enabled: Network[];
let indexReply: unknown;
let history: { tx_hash: string; height: number }[];
let handler:
  | ((call: Call, signal?: AbortSignal | null) => Promise<Response> | Response | undefined)
  | undefined;
beforeEach(async () => {
  calls = [];
  enabled = ['testnet4'];
  indexReply = [{ ...point, spendingtxid: spender.txid }];
  history = [];
  handler = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/networks')
        return new Response(
          JSON.stringify({ networks: ['mainnet', 'testnet4'], spenderIndexNetworks: enabled }),
        );
      const call: Call = JSON.parse(String(init?.body));
      calls.push(call);
      const response = await handler?.(call, init?.signal);
      if (response) return response;
      if (call.method === 'gettxspendingprevout') return ok(indexReply);
      if (call.method === 'blockchain.scripthash.get_history') return ok(history);
      if (call.method === 'getblockheader')
        return ok({ hash: call.params[0], height: 100, confirmations: 2 });
      if (call.method === 'getrawtransaction' || call.method === 'blockchain.transaction.get')
        return ok(spender);
      throw new Error('Unexpected synthetic request');
    }),
  );
  await backendNetworks();
});
afterEach(() => vi.unstubAllGlobals());

describe('optional exact output spending lookup', () => {
  it('does not issue any index RPC when disabled, including the other network', async () => {
    expect(await fetchIndexedSpenders('mainnet', [point], {})).toBeUndefined();
    enabled = [];
    await backendNetworks();
    await loadSpending(root, workspace(), 0);
    expect(calls.map((c) => c.method)).toEqual(['blockchain.scripthash.get_history']);
  });
  it('requires strict configured per-network capability documents', async () => {
    enabled = ['testnet4', 'testnet4'];
    await expect(backendNetworks()).rejects.toThrow('invalid network capabilities');
  });
  it('deduplicates outpoints and spending IDs and explicitly requires confirmed coverage', async () => {
    indexReply = [0, 1].map((vout) => ({ ...point, vout, spendingtxid: spender.txid }));
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? ok({ ...spender, vin: [point, { ...point, vout: 1 }] })
        : undefined;
    const result = await fetchIndexedSpenders(
      'testnet4',
      [point, point, { ...point, vout: 1 }],
      {},
    );
    expect(result?.unresolved).toEqual([]);
    expect(result?.transactions).toHaveLength(1);
    expect(calls[0]).toEqual({
      network: 'testnet4',
      target: 'core',
      method: 'gettxspendingprevout',
      params: [[point, { ...point, vout: 1 }], { mempool_only: false, return_spending_tx: false }],
    });
    expect(calls.filter((c) => c.method === 'getrawtransaction')).toHaveLength(1);
    expect(calls.every((c) => c.network === 'testnet4')).toBe(true);
  });
  it('uses a confirmed block hint without txindex, preserving verbosity fallback', async () => {
    indexReply = [{ ...point, spendingtxid: spender.txid, blockhash: id(9) }];
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? c.params[1] === 2
          ? new Response(
              JSON.stringify({
                error: 'Previous-output data unavailable',
                code: 'core_prevout_unavailable',
              }),
              { status: 502 },
            )
          : ok({ ...spender, blockhash: id(9), confirmations: 2, in_active_chain: true })
        : undefined;
    const result = await loadSpending(root, workspace(), 0);
    expect(result).toMatchObject({ lookup: 'index', truncated: false });
    expect(result.transactions[0]).toMatchObject({ blockhash: id(9), blockHeight: 100 });
    expect(calls.filter((c) => c.method === 'getrawtransaction').map((c) => c.params)).toEqual([
      [id(2), 2, id(9)],
      [id(2), 1, id(9)],
    ]);
  });
  it('keeps admitted batch results when the inspection gate declines another spender', async () => {
    const other = { ...point, vout: 1 };
    indexReply = [
      { ...point, spendingtxid: spender.txid },
      { ...other, spendingtxid: id(3) },
    ];
    const result = await fetchIndexedSpenders(
      'testnet4',
      [point, other],
      {},
      undefined,
      {},
      (txid) => txid === spender.txid,
    );
    expect(result?.transactions.map((tx) => tx.txid)).toEqual([spender.txid]);
    expect(result?.unresolved).toEqual([other]);
    expect(result?.unavailableTxids).toEqual([id(3)]);
    expect(result?.inspected).toBe(1);
    expect(
      calls.filter((call) => call.method === 'getrawtransaction').map((call) => call.params[0]),
    ).toEqual([spender.txid]);
  });
  it('reuses a local exact mempool transaction without downloads and retains conflicting alternatives', async () => {
    const old = { ...spender, txid: id(3), confirmations: -1 };
    const result = await fetchIndexedSpenders('testnet4', [point], {
      [spender.txid]: spender,
      [old.txid]: old,
    });
    expect(result?.transactions.map((t) => t.txid)).toEqual([id(2), id(3)]);
    expect(calls).toHaveLength(1);
    expect(spender.mempool).toBeUndefined();
  });
  it('treats a complete empty row as a fresh lookup observation without history or deleting saved spends', async () => {
    indexReply = [point];
    const result = await fetchIndexedSpenders('testnet4', [point], { [spender.txid]: spender });
    expect(result).toMatchObject({ unresolved: [], transactions: [spender] });
    expect(calls).toHaveLength(1);
    expect(await loadSpending(root, workspace(), 0)).toEqual({
      transactions: [],
      truncated: false,
      lookup: 'index',
    });
  });
  it.each([
    null,
    [],
    [point, point],
    [{ ...point, vout: 1 }],
    [{ ...point, spendingtxid: 'bad' }],
    [{ ...point, blockhash: id(9) }],
  ])('falls back for malformed or partial replies: %j', async (reply) => {
    indexReply = reply;
    history = [{ tx_hash: spender.txid, height: 0 }];
    const result = await loadSpending(root, workspace(), 0);
    expect(result).toMatchObject({ lookup: 'electrum-fallback', truncated: false });
    expect(result.transactions.map((t) => t.txid)).toEqual([spender.txid]);
    expect(calls.some((c) => c.method === 'blockchain.scripthash.get_history')).toBe(true);
  });
  it('uses bounded history fallback for incompatible, missing or syncing index errors', async () => {
    handler = (c) => (c.method === 'gettxspendingprevout' ? error() : undefined);
    history = [{ tx_hash: spender.txid, height: 0 }];
    expect((await loadSpending(root, workspace(), 0)).transactions[0].txid).toBe(spender.txid);
  });
  it('rejects a transaction that does not spend the exact output and reports unresolved data', async () => {
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? ok({ ...spender, vin: [{ ...point, vout: 1 }] })
        : undefined;
    const result = await loadSpending(root, workspace(), 0);
    expect(result).toMatchObject({
      transactions: [],
      truncated: true,
      failed: 1,
      lookup: 'electrum-fallback',
    });
  });
  it('rejects mismatched transaction IDs and addresses on a different network', async () => {
    for (const tx of [
      { ...spender, txid: id(99) },
      {
        ...spender,
        vout: [
          {
            n: 0,
            value: 1,
            scriptPubKey: {
              address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
              hex: '0014c0cebcd6c3d3ca8c75dc5ec62ebe55330ef910e2',
            },
          },
        ],
      },
    ]) {
      handler = (c) => (c.method === 'getrawtransaction' ? ok(tx) : undefined);
      expect((await loadSpending(root, workspace(), 0)).transactions).toEqual([]);
    }
  });
  it('preserves disconnected-block evidence but does not regard it as current coverage', async () => {
    indexReply = [{ ...point, spendingtxid: spender.txid, blockhash: id(9) }];
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? ok({ ...spender, blockhash: id(9), confirmations: 0, in_active_chain: false })
        : undefined;
    const result = await loadSpending(root, workspace(), 0);
    expect(result).toMatchObject({ truncated: true, lookup: 'electrum-fallback' });
    expect(result.transactions[0]).toMatchObject({ confirmations: -1 });
  });
  it('rechecks active block status when reusing loaded bytes, even after a cached height', async () => {
    indexReply = [{ ...point, spendingtxid: spender.txid, blockhash: id(9) }];
    const existing = { [spender.txid]: spender };
    expect((await fetchIndexedSpenders('testnet4', [point], existing))?.unresolved).toEqual([]);
    handler = (c) =>
      c.method === 'getblockheader'
        ? ok({ hash: id(9), height: 100, confirmations: -1 })
        : undefined;
    const result = await fetchIndexedSpenders('testnet4', [point], existing);
    expect(result?.unresolved).toEqual([point]);
    expect(result?.transactions[0].confirmations).toBe(-1);
    expect(calls.filter((c) => c.method === 'getblockheader')).toHaveLength(2);
  });
  it('keeps unavailable transaction data and failed fallback explicitly partial', async () => {
    handler = (c) =>
      [
        'getrawtransaction',
        'blockchain.transaction.get',
        'blockchain.scripthash.get_history',
      ].includes(c.method)
        ? error()
        : undefined;
    expect(await loadSpending(root, workspace(), 0)).toMatchObject({
      transactions: [],
      truncated: true,
      lookup: 'electrum-fallback',
    });
  });
  it('can resolve exact outputs without scripts, but unavailable lookup stays partial', async () => {
    const noScript = { ...root, vout: [{ n: 0, value: 1, scriptPubKey: {} }] };
    expect((await loadSpending(noScript, workspace(), 0)).lookup).toBe('index');
    handler = (c) => (c.method === 'gettxspendingprevout' ? error() : undefined);
    expect(await loadSpending(noScript, workspace(), 0)).toMatchObject({ truncated: true });
  });
  it('never falls back or merges results after cancellation', async () => {
    const controller = new AbortController();
    handler = (c) => {
      if (c.method === 'gettxspendingprevout') {
        controller.abort();
        return error();
      }
    };
    await expect(loadSpending(root, workspace(), 0, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toHaveLength(1);
  });
  it('does not accept uncertain Electrum block metadata as complete indexed coverage', async () => {
    indexReply = [{ ...point, spendingtxid: spender.txid, blockhash: id(9) }];
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? error()
        : c.method === 'blockchain.transaction.get'
          ? ok({ ...spender, blockhash: id(9), confirmations: 0 })
          : undefined;
    expect(await loadSpending(root, workspace(), 0)).toMatchObject({
      lookup: 'electrum-fallback',
      truncated: true,
      failed: 1,
    });
    expect(calls.some((c) => c.method === 'blockchain.scripthash.get_history')).toBe(true);
  });
  it('continues the same history list after capability recovery without skipping spenders', async () => {
    const w = workspace();
    history = Array.from({ length: 501 }, (_, n) => ({ tx_hash: id(n + 10), height: 0 }));
    handler = (c) =>
      c.method === 'gettxspendingprevout'
        ? error()
        : c.method === 'getrawtransaction'
          ? ok({
              ...spender,
              txid: c.params[0],
              vin: [{ ...point, vout: c.params[0] === id(510) ? 1 : 0 }],
            })
          : undefined;
    const first = await loadSpending(root, w, undefined);
    expect(first.nextOffset).toBe(500);
    for (const tx of first.transactions) w.transactions[tx.txid] = tx;
    const start = calls.length;
    // A now-available partial direct answer must not narrow the history offset.
    indexReply = [{ ...point }, { ...point, vout: 1, spendingtxid: id(510) }];
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? ok({ ...spender, txid: c.params[0], vin: [{ ...point, vout: 1 }] })
        : undefined;
    const second = await loadSpending(root, w, undefined, undefined, first.nextOffset);
    expect(second.truncated).toBe(false);
    expect(second.transactions.map((tx) => tx.txid)).toEqual([id(510)]);
    expect(calls.slice(start).some((c) => c.method === 'gettxspendingprevout')).toBe(false);
  });
  it.each(['candidate', 'history'])(
    'does not advance past a failed fallback %s read',
    async (failure) => {
      history = Array.from({ length: 501 }, (_, n) => ({ tx_hash: id(n + 10), height: 0 }));
      let histories = 0;
      handler = (c) => {
        if (c.method === 'gettxspendingprevout') return error();
        if (
          failure === 'history' &&
          c.method === 'blockchain.scripthash.get_history' &&
          ++histories === 1
        )
          return error();
        if (['getrawtransaction', 'blockchain.transaction.get'].includes(c.method))
          return failure === 'candidate' && c.params[0] === id(10)
            ? error()
            : ok({ ...spender, txid: c.params[0] });
      };
      const result = await loadSpending(root, workspace(), undefined);
      expect(result).toMatchObject({ truncated: true, failed: 1 });
      expect(result.nextOffset).toBeUndefined();
    },
  );
  it('carries known missing spender data through the final history page', async () => {
    history = Array.from({ length: 501 }, (_, n) => ({ tx_hash: id(n + 10), height: 0 }));
    handler = (c) =>
      ['getrawtransaction', 'blockchain.transaction.get'].includes(c.method)
        ? c.params[0] === spender.txid
          ? error()
          : ok({ ...spender, txid: c.params[0], vin: [{ txid: id(99), vout: 0 }] })
        : undefined;
    const first = await loadSpending(root, workspace(), 0);
    expect(first).toMatchObject({ nextOffset: 499, failed: 1, unavailableTxids: [spender.txid] });
    const second = await loadSpending(
      root,
      workspace(),
      0,
      undefined,
      first.nextOffset,
      {},
      first.unavailableTxids,
    );
    expect(second).toMatchObject({ truncated: true, failed: 1, unavailableTxids: [spender.txid] });
    expect(second.nextOffset).toBeUndefined();
  });
  it('finishes a 500-spender action across history pages without repeating the first direct batch', async () => {
    const points = Array.from({ length: 500 }, (_, vout) => ({ ...point, vout }));
    const large = { ...root, vout: points.map((p) => ({ ...root.vout[0], n: p.vout })) };
    const w = { ...workspace(), transactions: { [large.txid]: large } };
    indexReply = points.map((p, n) => ({ ...p, spendingtxid: id(n + 1000) }));
    history = Array.from({ length: 750 }, (_, n) => ({ tx_hash: id(n + 1000), height: 0 }));
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? ok({
            ...spender,
            txid: c.params[0],
            vin: [points[parseInt(c.params[0], 16) - 1000] ?? { txid: id(99), vout: 0 }],
          })
        : undefined;
    const first = await loadSpending(large, w, undefined);
    expect(first.nextOffset).toBe(250);
    for (const tx of first.transactions) w.transactions[tx.txid] = tx;
    const second = await loadSpending(
      large,
      w,
      undefined,
      undefined,
      first.nextOffset,
      {},
      first.unavailableTxids,
    );
    for (const tx of second.transactions) w.transactions[tx.txid] = tx;
    expect(second.truncated).toBe(false);
    expect(Object.keys(w.transactions)).toHaveLength(501);
    expect(calls.filter((c) => c.method === 'gettxspendingprevout')).toHaveLength(1);
  });
  it('caps direct transaction work, reserving a bounded fallback budget', async () => {
    const points = Array.from({ length: 500 }, (_, vout) => ({ ...point, vout }));
    indexReply = points.map((p, n) => ({ ...p, spendingtxid: id(n + 1000) }));
    handler = (c) =>
      c.method === 'getrawtransaction'
        ? ok({ ...spender, txid: c.params[0], vin: [points[parseInt(c.params[0], 16) - 1000]] })
        : undefined;
    const result = await fetchIndexedSpenders('testnet4', points, {});
    expect(result?.inspected).toBe(250);
    expect(result?.unresolved).toHaveLength(250);
    expect(calls.filter((c) => c.method === 'getrawtransaction')).toHaveLength(250);
  });
});
