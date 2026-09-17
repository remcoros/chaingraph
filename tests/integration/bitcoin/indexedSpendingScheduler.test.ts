import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verboseTransaction } from '../../fixtures/verboseTransaction';
import type { Network } from '../../../src/Core/Bitcoin';
import type { Transaction } from '../../../src/Core/ChainData';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import {
  backendNetworks,
  fetchIndexedSpenders,
  fetchTransaction,
  loadSpending,
} from '../../../src/Core/ChainData/api';
import {
  TransactionFetchScope,
  transactionScheduler,
} from '../../../src/Core/ChainData/transactionScheduler';

const id = (n: number) => n.toString(16).padStart(64, '0');
const points = Array.from({ length: 4 }, (_, vout) => ({ txid: id(1), vout }));
const root: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: points.map(({ vout }) => ({ n: vout, value: 1, scriptPubKey: { hex: '51' } })),
};
const candidate = (txid: string): Transaction => ({
  txid,
  vin: [points[Math.max(0, Number.parseInt(txid, 16) - 10)] ?? points[0]],
  vout: [root.vout[0]],
});
const workspace = () => ({
  ...createWorkspace('Public scheduling fixture', 'testnet4'),
  chainData: {
    ...createWorkspace('Public scheduling fixture', 'testnet4').chainData,
    transactions: { [root.txid]: root },
  },
});
type Call = { network: Network; target: string; method: string; params: unknown[] };
type Pending = { call: Call; signal: AbortSignal; resolve: (result: unknown) => void };
const ok = (result: unknown) =>
  new Response(JSON.stringify({ result: verboseTransaction(result) }));
const unavailable = () =>
  new Response(
    JSON.stringify({ error: 'Synthetic lookup unavailable', code: 'core_spender_unavailable' }),
    { status: 503 },
  );
let calls: Call[];
let pending: Pending[];
let scopes: TransactionFetchScope[];
let hold: (call: Call) => boolean;
let indexUnavailable: boolean;
let confirmedBlock: string | undefined;
const scope = (network: Network = 'testnet4') => {
  const value = new TransactionFetchScope(network);
  scopes.push(value);
  return value;
};
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const rawCalls = () => calls.filter((call) => call.method === 'getrawtransaction');
const complete = (request: Pending, changes: Partial<Transaction> = {}) => {
  const blockhash = request.call.params[2] as string | undefined;
  request.resolve({
    ...candidate(request.call.params[0] as string),
    ...(blockhash
      ? {
          in_active_chain: true,
          status: { kind: 'confirmed' as const, blockhash, confirmations: 2 },
        }
      : {}),
    ...changes,
  });
};

beforeEach(async () => {
  calls = [];
  pending = [];
  scopes = [];
  hold = () => false;
  indexUnavailable = false;
  confirmedBlock = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/networks')
        return new Response(
          JSON.stringify({ networks: ['mainnet', 'testnet4'], spenderIndexNetworks: ['testnet4'] }),
        );
      const call = JSON.parse(String(init?.body)) as Call;
      calls.push(call);
      if (hold(call)) {
        const signal = init?.signal;
        if (!signal) throw new Error('Scoped transport requires a cancellation signal.');
        return new Promise<Response>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
          pending.push({
            call,
            signal,
            resolve: (result) => {
              signal.removeEventListener('abort', abort);
              resolve(ok(result));
            },
          });
        });
      }
      if (call.method === 'gettxspendingprevout')
        return indexUnavailable
          ? unavailable()
          : ok(
              (call.params[0] as typeof points).map((point) => ({
                ...point,
                spendingtxid: id(10 + point.vout),
                ...(confirmedBlock ? { blockhash: confirmedBlock } : {}),
              })),
            );
      if (call.method === 'getblockheader')
        return ok({ hash: call.params[0], height: 100, confirmations: 2 });
      if (call.method === 'blockchain.scripthash.get_history')
        return ok(points.map((point) => ({ tx_hash: id(10 + point.vout), height: 0 })));
      if (call.method === 'getrawtransaction') return ok(candidate(call.params[0] as string));
      throw new Error('Unexpected synthetic request.');
    }),
  );
  await backendNetworks();
});
afterEach(async () => {
  for (const owned of scopes) transactionScheduler.dispose(owned);
  await tick();
  vi.unstubAllGlobals();
});

describe('indexed spending through the shared transaction scheduler', () => {
  it('keeps distinct containing-block hints in distinct physical jobs', async () => {
    hold = (call) => call.method === 'getrawtransaction';
    const owned = scope();
    const observation = {};
    const first = fetchTransaction(
      'testnet4',
      id(10),
      undefined,
      undefined,
      { scope: owned, observation },
      id(90),
    );
    const second = fetchTransaction(
      'testnet4',
      id(10),
      undefined,
      undefined,
      { scope: owned, observation },
      id(91),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(rawCalls().map((call) => call.params)).toEqual([
      [id(10), 2, id(90)],
      [id(10), 2, id(91)],
    ]);
    pending.forEach((request) => complete(request));
    const results = await Promise.all([first, second]);
    expect(results.map((tx) => [tx.status?.blockhash, tx.status?.blockHeight])).toEqual([
      [id(90), 100],
      [id(91), 100],
    ]);
    expect(calls.filter((call) => call.method === 'getblockheader')).toHaveLength(2);
  });

  it('coalesces matching observations and block hints while detaching only the cancelled consumer', async () => {
    hold = (call) => call.method === 'getrawtransaction';
    const owned = scope();
    const observation = {};
    const cancelled = new AbortController();
    const survivor = new AbortController();
    const first = fetchTransaction(
      'testnet4',
      id(10),
      cancelled.signal,
      undefined,
      { scope: owned, observation },
      id(92),
    );
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = fetchTransaction(
      'testnet4',
      id(10),
      survivor.signal,
      undefined,
      { scope: owned, observation },
      id(92),
    );
    const third = fetchTransaction(
      'testnet4',
      id(10),
      undefined,
      undefined,
      { scope: owned, observation },
      id(92),
    );
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    cancelled.abort();
    await rejected;
    expect(pending[0].signal.aborted).toBe(false);
    complete(pending[0]);
    const [a, b] = await Promise.all([second, third]);
    a.vout[0].scriptPubKey.hex = '52';
    expect(b.vout[0].scriptPubKey.hex).toBe('51');
    expect(rawCalls()).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'getblockheader')).toHaveLength(1);
  });

  it.each(['index', 'fallback'] as const)(
    'runs %s candidates as background work and reserves navigation capacity',
    async (route) => {
      indexUnavailable = route === 'fallback';
      hold = (call) => call.method === 'getrawtransaction';
      const owned = scope();
      const loading = loadSpending(
        root,
        { network: workspace().network, transactions: workspace().chainData.transactions },
        undefined,
        undefined,
        0,
        {
          scope: owned,
          priority: 'navigation',
        },
      );
      const cancelled = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(rawCalls()).toHaveLength(3));
      await tick();
      expect(rawCalls().map((call) => call.params[0])).toEqual([id(10), id(11), id(12)]);
      const navigation = fetchTransaction('testnet4', id(50), undefined, undefined, {
        scope: owned,
        priority: 'navigation',
      });
      await vi.waitFor(() => expect(rawCalls()).toHaveLength(4));
      expect(rawCalls().at(-1)?.params[0]).toBe(id(50));
      complete(pending.find((request) => request.call.params[0] === id(50))!);
      await navigation;
      transactionScheduler.dispose(owned);
      await cancelled;
      await tick();
      expect(pending.slice(0, 3).every((request) => request.signal.aborted)).toBe(true);
      expect(rawCalls().some((call) => call.params[0] === id(13))).toBe(false);
      expect(calls.some((call) => call.method === 'blockchain.scripthash.get_history')).toBe(
        route === 'fallback',
      );
      expect(calls.every((call) => call.network === 'testnet4')).toBe(true);
    },
  );

  it.each(['index RPC', 'loaded confirmed header'] as const)(
    'disposal during %s aborts leaf transport without a caller signal and prevents fallback',
    async (phase) => {
      const owned = scope();
      const w = workspace();
      if (phase === 'loaded confirmed header') {
        confirmedBlock = id(93);
        w.chainData.transactions[id(10)] = candidate(id(10));
      }
      hold = (call) =>
        call.method === (phase === 'index RPC' ? 'gettxspendingprevout' : 'getblockheader');
      const loading = loadSpending(
        root,
        { network: w.network, transactions: w.chainData.transactions },
        0,
        undefined,
        0,
        { scope: owned },
      );
      const cancelled = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      transactionScheduler.dispose(owned);
      expect(owned.signal.aborted).toBe(true);
      expect(pending[0].signal.aborted).toBe(true);
      await cancelled;
      const count = calls.length;
      await expect(
        loadSpending(
          root,
          { network: w.network, transactions: w.chainData.transactions },
          0,
          undefined,
          0,
          { scope: owned },
        ),
      ).rejects.toMatchObject({
        name: 'AbortError',
      });
      await tick();
      expect(calls).toHaveLength(count);
      expect(
        calls.some((call) =>
          [
            'getrawtransaction',
            'blockchain.scripthash.get_history',
            'blockchain.transaction.get',
          ].includes(call.method),
        ),
      ).toBe(false);
    },
  );

  it('rejects mismatched and closed scopes before any index, history or transaction RPC', async () => {
    const mismatched = scope('mainnet');
    const closed = scope();
    transactionScheduler.dispose(closed);
    for (const owned of [mismatched, closed]) {
      const expected = owned === mismatched ? /different network/ : /cancelled/;
      await expect(
        fetchIndexedSpenders('testnet4', [points[0]], {}, undefined, { scope: owned }),
      ).rejects.toThrow(expected);
      await expect(
        loadSpending(
          root,
          { network: workspace().network, transactions: workspace().chainData.transactions },
          0,
          undefined,
          0,
          { scope: owned },
        ),
      ).rejects.toThrow(expected);
      await expect(
        fetchTransaction('testnet4', id(10), undefined, undefined, { scope: owned }),
      ).rejects.toThrow(expected);
    }
    expect(calls).toEqual([]);
  });

  it('starts a fresh indexed observation instead of joining earlier pending navigation for the same transaction', async () => {
    hold = (call) => call.method === 'getrawtransaction';
    const owned = scope();
    const navigation = fetchTransaction('testnet4', id(10), undefined, undefined, {
      scope: owned,
      priority: 'navigation',
    });
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const indexed = fetchIndexedSpenders('testnet4', [points[0]], {}, undefined, { scope: owned });
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    complete(pending[0], { status: { kind: 'inactive' as const, confirmations: -1 } });
    complete(pending[1]);
    expect((await navigation).status?.confirmations).toBe(-1);
    expect(await indexed).toMatchObject({
      unresolved: [],
      transactions: [{ txid: id(10), status: { kind: 'mempool' as const, confirmations: 0 } }],
    });
    expect(rawCalls()).toHaveLength(2);
  });
});
