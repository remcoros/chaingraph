import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/domain/types';
import { TransactionFetchScope, TransactionScheduler } from '../src/lib/transactionScheduler';
import { fetchTransaction } from '../src/lib/api';

const tx: Transaction = {
  txid: 'a'.repeat(64),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
};
const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function harness() {
  const scheduler = new TransactionScheduler();
  const scope = new TransactionFetchScope('mainnet');
  const calls: {
    id: string;
    signal: AbortSignal;
    resolve: (value: Transaction) => void;
    reject: (reason: unknown) => void;
  }[] = [];
  const load = (id: string) => (signal: AbortSignal) =>
    new Promise<Transaction>((resolve, reject) => calls.push({ id, signal, resolve, reject }));
  const request = (
    id: string,
    priority: 'navigation' | 'visible' | 'background' = 'background',
    signal?: AbortSignal,
  ) => scheduler.request('mainnet', id, load(id), signal, { scope, priority });
  return { scheduler, scope, calls, load, request };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bounded transaction scheduler', () => {
  it('coalesces independent signals, detaches one consumer, and gives survivors independent nested results', async () => {
    const h = harness();
    const a = new AbortController();
    const b = new AbortController();
    const p1 = h.request('same', 'background', a.signal).catch((error: Error) => error.name);
    const p2 = h.request('same', 'visible', b.signal);
    const p3 = h.request('same', 'navigation');
    await tick();
    expect(h.calls).toHaveLength(1); // Three consumers, one physical load.
    a.abort();
    expect(await p1).toBe('AbortError');
    expect(h.calls[0].signal.aborted).toBe(false);
    h.calls[0].resolve(tx);
    const [second, third] = await Promise.all([p2, p3]);
    second.vout[0].scriptPubKey.hex = '00';
    expect(third.vout[0].scriptPubKey.hex).toBe('51');
    expect(tx.vout[0].scriptPubKey.hex).toBe('51');
    h.scheduler.dispose(h.scope);
  });

  it('removes abandoned queued work and aborts physical work only after its last consumer leaves', async () => {
    const h = harness();
    const owner = new AbortController();
    const pending = ['a', 'b', 'c', 'queued'].map((id) =>
      h.request(id, 'background', owner.signal).catch((e: Error) => e.name),
    );
    await tick();
    expect(h.calls).toHaveLength(3);
    owner.abort();
    expect(await Promise.all(pending)).toEqual(Array(4).fill('AbortError'));
    expect(h.calls.every((call) => call.signal.aborted)).toBe(true);
    // Aborted but unsettled physical work still occupies slots; navigation can use the reserve.
    const navigation = h.request('selected', 'navigation');
    await tick();
    expect(h.calls.map((call) => call.id)).toEqual(['a', 'b', 'c', 'selected']);
    h.calls.forEach((call) => call.resolve(tx));
    await navigation;
    h.scheduler.dispose(h.scope);
  });

  it('admits selected navigation before queued bulk work and promotes a shared queued job', async () => {
    const h = harness();
    const owner = new AbortController();
    const pending = ['a', 'b', 'c', 'bulk', 'selected'].map((id) =>
      h.request(id, 'background', owner.signal).catch(() => undefined),
    );
    await tick();
    const selected = h.request('selected', 'navigation');
    await tick();
    expect(h.calls.map((call) => call.id)).toEqual(['a', 'b', 'c', 'selected']);
    h.calls[3].resolve(tx);
    await selected;
    owner.abort();
    h.calls.slice(0, 3).forEach((call) => call.resolve(tx));
    await Promise.all(pending);
    h.scheduler.dispose(h.scope);
  });

  it('bounds global/per-network concurrency and rotates equal-priority networks', async () => {
    const h = harness();
    const other = new TransactionFetchScope('testnet4');
    const owner = new AbortController();
    const pending = Array.from({ length: 12 }, (_, i) =>
      h.request(`m${i}`, 'navigation', owner.signal).catch(() => undefined),
    );
    pending.push(
      ...Array.from({ length: 12 }, (_, i) =>
        h.scheduler
          .request('testnet4', `t${i}`, h.load(`t${i}`), owner.signal, {
            scope: other,
            priority: 'navigation',
          })
          .catch(() => undefined),
      ),
    );
    await tick();
    expect(h.calls.map((call) => call.id)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      't0',
      't1',
      't2',
      't3',
    ]);
    h.calls[0].resolve(tx);
    h.calls[1].resolve(tx);
    await tick();
    expect(h.calls.slice(12).map((call) => call.id)).toEqual(['m8', 't4']);
    owner.abort();
    h.calls.forEach((call) => call.resolve(tx));
    await Promise.all(pending);
    h.scheduler.dispose(h.scope);
    h.scheduler.dispose(other);
  });

  it('keeps each network at three background jobs while navigation uses the higher ceilings', async () => {
    const h = harness();
    const other = new TransactionFetchScope('testnet4');
    const owner = new AbortController();
    const pending = Array.from({ length: 8 }, (_, i) =>
      h.request(`m${i}`, 'background', owner.signal).catch(() => undefined),
    );
    const requestOther = (id: string, priority: 'background' | 'navigation') =>
      h.scheduler
        .request('testnet4', id, h.load(id), owner.signal, {
          scope: other,
          priority,
        })
        .catch(() => undefined);
    pending.push(...Array.from({ length: 8 }, (_, i) => requestOther(`t${i}`, 'background')));
    await tick();
    expect(h.calls.map((call) => call.id)).toEqual(['m0', 'm1', 'm2', 't0', 't1', 't2']);
    pending.push(
      ...Array.from({ length: 6 }, (_, i) =>
        h.request(`selected${i}`, 'navigation', owner.signal).catch(() => undefined),
      ),
    );
    await tick();
    expect(h.calls).toHaveLength(11); // Eight mainnet jobs: three background plus five navigation.
    expect(h.calls.slice(6).map((call) => call.id)).toEqual([
      'selected0',
      'selected1',
      'selected2',
      'selected3',
      'selected4',
    ]);
    pending.push(
      requestOther('other-selected', 'navigation'),
      requestOther('other-queued', 'navigation'),
    );
    await tick();
    expect(h.calls).toHaveLength(12);
    expect(h.calls.at(-1)!.id).toBe('other-selected');
    owner.abort();
    h.calls.forEach((call) => call.resolve(tx));
    await Promise.all(pending);
    h.scheduler.dispose(h.scope);
    h.scheduler.dispose(other);
  });

  it('bounds queue admission, reserves navigation space, and releases slots on async and sync failures', async () => {
    const h = harness();
    const owner = new AbortController();
    const promises = Array.from({ length: 115 }, (_, i) =>
      h.request(`${i}`, 'background', owner.signal).catch(() => undefined),
    );
    await tick();
    await expect(h.request('overflow')).rejects.toThrow('queue is full');
    const navigation = h.request('selected', 'navigation');
    await tick();
    h.calls[3].reject(new Error('synthetic failure'));
    await expect(navigation).rejects.toThrow('synthetic failure');
    const sync = h.scheduler.request(
      'mainnet',
      'sync',
      () => {
        throw new Error('sync');
      },
      undefined,
      { scope: h.scope, priority: 'navigation' },
    );
    await expect(sync).rejects.toThrow('sync');
    const retry = h.request('selected', 'navigation');
    await tick();
    h.calls.at(-1)!.resolve(tx);
    await retry;
    owner.abort();
    h.calls.forEach((call) => call.resolve(tx));
    await Promise.all(promises);
    h.scheduler.dispose(h.scope);
  });

  it('isolates workspace sessions and networks, clears activity on close, and rejects old tokens after reopen', async () => {
    vi.useFakeTimers();
    const h = harness();
    const second = new TransactionFetchScope('mainnet');
    const p1 = h.request('same').catch((e: Error) => e.name);
    const p2 = h.scheduler.request('mainnet', 'same', h.load('second'), undefined, {
      scope: second,
    });
    await tick();
    expect(h.calls).toHaveLength(2);
    vi.advanceTimersByTime(80);
    expect(h.scope.getSummary()).toBe('1:0');
    h.scheduler.dispose(h.scope);
    expect(h.scope.getSnapshot()).toEqual([]);
    expect(await p1).toBe('AbortError');
    await expect(h.request('late')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      h.scheduler.request('testnet4', 'same', h.load('wrong'), undefined, { scope: second }),
    ).rejects.toThrow('different network');
    h.calls.forEach((call) => call.resolve(tx));
    await p2;
    expect(h.scope.getSnapshot()).toEqual([]);
    h.scheduler.dispose(second);
  });

  it('coalesces notifications, bounds recent history, and does not cache resolved results', async () => {
    vi.useFakeTimers();
    const h = harness();
    const listener = vi.fn();
    h.scope.subscribe(listener);
    for (let i = 0; i < 35; i++) {
      const request = h.request('same');
      await tick();
      h.calls.at(-1)!.resolve(tx);
      await request;
    }
    expect(h.calls).toHaveLength(35);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.scope.getSnapshot()[0].done).toBe(30);
    h.scope.clearRecent();
    expect(h.scope.getSnapshot()).toEqual([]);
    h.scheduler.dispose(h.scope);
  });
});

it('API keeps history height and refresh observations distinct, sharing only matching in-flight observations', async () => {
  const completions: ((value: unknown) => void)[] = [];
  const fetch = vi.fn(() => new Promise((resolve) => completions.push(resolve)));
  vi.stubGlobal('fetch', fetch);
  const scope = new TransactionFetchScope('mainnet');
  const observation = {};
  const read = fetchTransaction('mainnet', tx.txid, undefined, undefined, { scope });
  const refresh = fetchTransaction('mainnet', tx.txid, undefined, 10, { scope, observation });
  const sharedRefresh = fetchTransaction('mainnet', tx.txid, undefined, 10, { scope, observation });
  const height = fetchTransaction('mainnet', tx.txid, undefined, 11, { scope, observation });
  const laterRefresh = fetchTransaction('mainnet', tx.txid, undefined, 10, {
    scope,
    observation: {},
    priority: 'navigation',
  });
  await tick();
  expect(fetch).toHaveBeenCalledTimes(4);
  completions.forEach((resolve) => resolve({ ok: true, json: async () => ({ result: tx }) }));
  const results = await Promise.all([read, refresh, sharedRefresh, height, laterRefresh]);
  expect(results.map((result) => result.blockHeight)).toEqual([undefined, 10, 10, 11, 10]);
  const fresh = fetchTransaction('mainnet', tx.txid, undefined, 10, { scope, observation: {} });
  await tick();
  expect(fetch).toHaveBeenCalledTimes(5);
  completions.at(-1)!({ ok: true, json: async () => ({ result: { ...tx, confirmations: -1 } }) });
  expect((await fresh).confirmations).toBe(-1);
  scope.close();
});
