import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScanBudgetExceeded, type ScanBudget } from './connectionScan';
import type { Transaction } from '../../../../../Domain/Chain/transaction';
import { connectionScanTransport, createConnectionScanFetch } from './connectionScanFetch';
import { TransactionFetchScope } from '../../../../../Infra/Bitcoin/transactionScheduler';

const id = (n: number) => n.toString(16).padStart(64, '0');
const point = (vout: number) => ({ txid: id(1), vout });
const out = (vout: number) => `out:${id(1)}:${vout}`;
const creator: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: Array.from({ length: 6 }, (_, n) => ({
    n,
    value: 1,
    scriptPubKey: { hex: n === 5 ? '52' : '51' },
  })),
};
const spender = (n: number, outputs: number[]): Transaction => ({
  txid: id(n),
  vin: outputs.map(point),
  vout: [creator.vout[0]],
});
const empty = { transactions: [], unresolved: [], inspected: 0, unavailableTxids: [] };
function setup(limit = 20) {
  const controller = new AbortController();
  const transport = {
    fetchTransaction: vi.fn<typeof connectionScanTransport.fetchTransaction>(),
    fetchIndexedSpenders: vi
      .fn<typeof connectionScanTransport.fetchIndexedSpenders>()
      .mockResolvedValue(undefined),
    fetchHistory: vi.fn<typeof connectionScanTransport.fetchHistory>().mockResolvedValue([]),
  };
  const examined = new Set<string>();
  const budget: ScanBudget = {
    get examined() {
      return examined.size;
    },
    get examinedTxids() {
      return [...examined];
    },
    checkpoint() {},
    examine(txid) {
      if (examined.has(txid)) return;
      if (examined.size >= limit) throw new ScanBudgetExceeded('transactions');
      examined.add(txid);
    },
  };
  const adapter = createConnectionScanFetch(
    {
      network: 'testnet4',
      transactions: { [creator.txid]: creator },
      scope: new TransactionFetchScope('testnet4'),
      signal: controller.signal,
      loadedSpenders: () => [],
    },
    transport,
  );
  return {
    ...adapter,
    controller,
    transport,
    budget,
    resolve: (vout: number) => adapter.resolveNeighbors(out(vout), 'downstream', budget),
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('connection scan lookup batching', () => {
  it('coalesces separate tasks and distributes shared spenders by exact outpoint', async () => {
    const s = setup();
    s.transport.fetchIndexedSpenders.mockResolvedValue({
      ...empty,
      transactions: [spender(2, [0, 1]), spender(3, [2])],
    });
    const first = s.resolve(0);
    const second = new Promise<Awaited<typeof first>>((resolve) => {
      setTimeout(() => resolve(s.resolve(1)), 1);
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(s.transport.fetchIndexedSpenders).not.toHaveBeenCalled();
    const third = s.resolve(2);
    const fourth = s.resolve(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.transport.fetchIndexedSpenders).toHaveBeenCalledOnce();
    expect(s.transport.fetchIndexedSpenders.mock.calls[0][1]).toEqual([0, 1, 2, 3].map(point));
    expect(await Promise.all([first, second, third, fourth])).toEqual([
      { nodeIds: [`tx:${id(2)}`] },
      { nodeIds: [`tx:${id(2)}`] },
      { nodeIds: [`tx:${id(3)}`] },
      { nodeIds: [], stopReason: 'unknown', observation: { finding: 'spend-unknown' } },
    ]);
    expect(s.budget.examinedTxids).toEqual([id(1), id(2), id(3)]);
    expect(s.transport.fetchHistory).not.toHaveBeenCalled();
  });

  it('falls back only for each unresolved point, with batches capped at four', async () => {
    const s = setup();
    s.transport.fetchIndexedSpenders.mockImplementation(async (_network, points) => ({
      ...empty,
      unresolved: points.filter(({ vout }) => vout === 1),
    }));
    const pending = Promise.all([0, 1, 2, 3, 4].map(s.resolve));
    await vi.runAllTimersAsync();
    await pending;
    expect(s.transport.fetchIndexedSpenders.mock.calls.map((call) => call[1].length)).toEqual([
      4, 1,
    ]);
    expect(s.transport.fetchHistory).toHaveBeenCalledOnce();
  });

  it('retains admitted spender evidence when another point exhausts the shared allowance', async () => {
    const s = setup(2);
    s.transport.fetchIndexedSpenders.mockImplementation(
      async (_network, points, _existing, _signal, _hints, examine) => {
        const admitted = examine?.(id(2));
        const skipped = examine?.(id(3));
        expect(admitted).not.toBe(false);
        expect(skipped).toBe(false);
        return { ...empty, transactions: [spender(2, [0])], unresolved: [points[1]] };
      },
    );
    const pending = Promise.allSettled([s.resolve(0), s.resolve(1)]);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual([
      { status: 'fulfilled', value: { nodeIds: [`tx:${id(2)}`] } },
      { status: 'rejected', reason: expect.objectContaining({ reason: 'transactions' }) },
    ]);
    expect(s.budget.examined).toBe(2);
    expect(s.evidence[id(2)]).toBeDefined();
    expect(s.evidence[id(3)]).toBeUndefined();
  });

  it.each(['queued', 'in flight'])(
    'rejects cancelled %s batches without retaining late evidence',
    async (phase) => {
      const s = setup();
      let finish!: (
        value: Awaited<ReturnType<typeof connectionScanTransport.fetchIndexedSpenders>>,
      ) => void;
      s.transport.fetchIndexedSpenders.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = Promise.allSettled([s.resolve(0), s.resolve(1)]);
      if (phase === 'in flight') await vi.advanceTimersByTimeAsync(2);
      s.controller.abort();
      if (phase === 'in flight') finish({ ...empty, transactions: [spender(2, [0, 1])] });
      await vi.runAllTimersAsync();
      expect(await pending).toEqual(
        Array.from({ length: 2 }, () => ({
          status: 'rejected',
          reason: expect.objectContaining({ name: 'AbortError' }),
        })),
      );
      expect(s.transport.fetchIndexedSpenders).toHaveBeenCalledTimes(phase === 'queued' ? 0 : 1);
      expect(s.evidence[id(2)]).toBeUndefined();
    },
  );
});

describe('scan-scoped script history reuse', () => {
  it('shares pending and completed same-script histories without conflating different scripts', async () => {
    const s = setup();
    let finish!: (rows: Awaited<ReturnType<typeof connectionScanTransport.fetchHistory>>) => void;
    s.transport.fetchHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = Promise.all([s.resolve(0), s.resolve(1)]);
    await vi.runAllTimersAsync();
    expect(s.transport.fetchHistory).toHaveBeenCalledOnce();
    finish([]);
    await first;
    const later = Promise.all([s.resolve(2), s.resolve(5)]);
    await vi.runAllTimersAsync();
    await later;
    expect(s.transport.fetchHistory).toHaveBeenCalledTimes(2);
    expect(s.transport.fetchHistory.mock.calls[0][1]).not.toEqual(
      s.transport.fetchHistory.mock.calls[1][1],
    );
  });

  it('allows a later same-script lookup to retry a failed history request', async () => {
    const s = setup();
    s.transport.fetchHistory.mockRejectedValueOnce(new Error('Synthetic history unavailable'));
    const first = s.resolve(0);
    await vi.runAllTimersAsync();
    expect(await first).toMatchObject({ observation: { finding: 'lookup-failed' } });
    const later = s.resolve(1);
    await vi.runAllTimersAsync();
    expect(await later).toMatchObject({ observation: { finding: 'spend-unknown' } });
    expect(s.transport.fetchHistory).toHaveBeenCalledTimes(2);
  });
});
