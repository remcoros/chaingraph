import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/domain/types';
import { ScanBudgetExceeded, type ScanBudget } from '../src/domain/connectionScan';
import { createConnectionScanFetch, connectionScanTransport } from '../src/lib/connectionScanFetch';
import { TransactionFetchScope } from '../src/lib/transactionScheduler';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number, parent?: number): Transaction => ({
  txid: id(n),
  vin: parent === undefined ? [{ coinbase: '00' }] : [{ txid: id(parent), vout: 0 }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});
function budget(limit = 20): ScanBudget {
  const ids = new Set<string>();
  return {
    get examined() {
      return ids.size;
    },
    get examinedTxids() {
      return [...ids];
    },
    checkpoint() {},
    examine(txid) {
      if (ids.has(txid)) return;
      if (ids.size >= limit) throw new ScanBudgetExceeded('transactions');
      ids.add(txid);
    },
  };
}
function setup(
  transactions: Transaction[] = [],
  allowNetwork = true,
  loadedSpenders?: ((nodeId: string) => readonly string[]) | null,
) {
  const scope = new TransactionFetchScope('testnet4');
  const controller = new AbortController();
  const transport = {
    fetchTransaction: vi.fn<typeof connectionScanTransport.fetchTransaction>(),
    fetchIndexedSpenders: vi
      .fn<typeof connectionScanTransport.fetchIndexedSpenders>()
      .mockResolvedValue(undefined),
    fetchHistory: vi.fn<typeof connectionScanTransport.fetchHistory>().mockResolvedValue([]),
  };
  const adapter = createConnectionScanFetch(
    {
      network: 'testnet4',
      transactions: Object.fromEntries(transactions.map((t) => [t.txid, t])),
      scope,
      signal: controller.signal,
      allowNetwork,
      loadedSpenders:
        loadedSpenders === null
          ? undefined
          : (loadedSpenders ??
            ((nodeId) =>
              transactions
                .filter((transaction) =>
                  transaction.vin.some((input) => `out:${input.txid}:${input.vout}` === nodeId),
                )
                .map((transaction) => transaction.txid))),
    },
    transport,
  );
  return { ...adapter, transport, controller, scope };
}

describe('connection scan fetch adapter', () => {
  it('does not describe a coinbase input as an upstream branch boundary', async () => {
    const adapter = createConnectionScanFetch({
      network: 'testnet4',
      transactions: { [id(1)]: tx(1) },
      scope: new TransactionFetchScope('testnet4'),
      signal: new AbortController().signal,
      allowNetwork: false,
      fanOut: 1,
    });
    expect(await adapter.resolveNeighbors(`tx:${id(1)}`, 'upstream', budget())).toEqual({
      nodeIds: [],
    });
  });
  it('uses loaded exact spends and charges cached evidence without network', async () => {
    const s = setup([tx(1), tx(2, 1)]);
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [`tx:${id(2)}`],
    });
    expect(b.examinedTxids).toEqual([id(2)]);
    expect(s.transport.fetchIndexedSpenders).not.toHaveBeenCalled();
    expect(s.transport.fetchTransaction).not.toHaveBeenCalled();
  });
  it('bounds every unrelated history candidate in the same transaction budget', async () => {
    const s = setup([tx(1), tx(2), tx(3)]);
    s.transport.fetchHistory.mockResolvedValue(
      [2, 3, 4, 5].map((n) => ({ tx_hash: id(n), height: 1 })),
    );
    const b = budget(3);
    await expect(s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).rejects.toMatchObject({
      reason: 'transactions',
    });
    expect(b.examinedTxids).toEqual([id(1), id(2), id(3)]);
    expect(s.transport.fetchTransaction).not.toHaveBeenCalled();
  });
  it('charges standalone loaded-index inspection against the same budget', async () => {
    const s = setup([tx(1), tx(2), tx(3, 1)], false, null);
    const b = budget(2);
    await expect(s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).rejects.toMatchObject({
      reason: 'transactions',
    });
    expect(b.examinedTxids).toEqual([id(1), id(2)]);
  });
  it('uses supplied loaded indexes without inspecting unrelated transaction inputs', async () => {
    const unrelated = tx(3);
    Object.defineProperty(unrelated, 'vin', {
      get() {
        throw new Error('Unrelated evidence inspected');
      },
    });
    const s = setup([tx(1), tx(2, 1), unrelated], false, () => [id(2)]);
    const b = budget(1);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [`tx:${id(2)}`],
    });
    expect(b.examinedTxids).toEqual([id(2)]);
  });
  it('verifies a loaded spender hint before claiming an observed spending edge', async () => {
    const s = setup([tx(1), tx(2)], false, () => [id(2)]);
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [],
      stopReason: 'failure',
    });
    expect(b.examinedTxids).toEqual([id(2)]);
  });
  it('verifies the creating output before returning an upstream creation edge', async () => {
    const s = setup([tx(1)], false);
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'upstream', b)).toEqual({
      nodeIds: [`tx:${id(1)}`],
    });
    expect(await s.resolveNeighbors(`out:${id(1)}:1`, 'upstream', b)).toEqual({
      nodeIds: [],
      stopReason: 'failure',
    });
    expect(b.examinedTxids).toEqual([id(1)]);
  });
  it('reports an unloaded offline creator as unknown, without inventing an edge', async () => {
    const s = setup([], false);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'upstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'unknown',
    });
    expect(s.transport.fetchTransaction).not.toHaveBeenCalled();
  });
  it('uses attached output scripts without downloading their creating transaction', async () => {
    const unrelated = tx(2, 1);
    // A different known input supplies the script evidence for the requested output.
    unrelated.vin[0].vout = 1;
    unrelated.vin[0].prevout = { value: 1, scriptPubKey: { hex: '51' } };
    const s = setup([unrelated]);
    // Known loaded spend is sufficient and does not require its absent creator.
    await s.resolveNeighbors(`out:${id(1)}:1`, 'downstream', budget());
    expect(s.transport.fetchTransaction).not.toHaveBeenCalled();
  });
  it('reports missing spender evidence as unknown and supports offline scans', async () => {
    const s = setup([tx(1)], false);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'unknown',
    });
    expect(s.transport.fetchHistory).not.toHaveBeenCalled();
  });
  it('gates indexed candidates before downloading', async () => {
    const s = setup([tx(1)]);
    s.transport.fetchIndexedSpenders.mockImplementation(
      async (_network, _points, _existing, _signal, _hints, examine) => {
        examine?.(id(2));
        throw new Error('must not reach this');
      },
    );
    await expect(
      s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget(0)),
    ).rejects.toMatchObject({ reason: 'transactions' });
    expect(s.transport.fetchHistory).not.toHaveBeenCalled();
  });
  it('rejects late transport evidence when the session closes', async () => {
    const s = setup();
    let finish!: (value: Transaction) => void;
    s.transport.fetchTransaction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = s.resolveNeighbors(`tx:${id(1)}`, 'downstream', budget());
    s.scope.close();
    finish(tx(1));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.evidence[id(1)]).toBeUndefined();
  });
  it('sanitizes upstream failures', async () => {
    const s = setup();
    s.transport.fetchTransaction.mockRejectedValue(new Error('private synthetic upstream detail'));
    expect(await s.resolveNeighbors(`tx:${id(1)}`, 'downstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'failure',
    });
  });
  it('rejects a different network before fetching', () => {
    expect(() =>
      createConnectionScanFetch({
        network: 'mainnet',
        transactions: {},
        scope: new TransactionFetchScope('testnet4'),
        signal: new AbortController().signal,
      }),
    ).toThrow('different Bitcoin network');
  });
});

import { runConnectionScanInWorker } from '../src/lib/connectionScanRunner';
import { DEFAULT_SCAN_SETTINGS, type ScanRun } from '../src/domain/connectionScan';
import type { ScanWorkerInput, ScanWorkerOutput } from '../src/lib/connectionScanProtocol';

class FakeScanWorker {
  onmessage: ((event: MessageEvent<ScanWorkerOutput>) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: ScanWorkerInput[] = [];
  terminated = false;
  postMessage(message: ScanWorkerInput) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(message: ScanWorkerOutput) {
    this.onmessage?.({ data: message } as MessageEvent<ScanWorkerOutput>);
  }
}
const request = () => ({
  id: 'scan-public-fixture',
  source: `tx:${id(1)}`,
  targetIds: [`tx:${id(3)}`],
  displayedNodeIds: [`tx:${id(1)}`, `tx:${id(3)}`],
  settings: { ...DEFAULT_SCAN_SETTINGS },
});
const completed = (status: ScanRun['status'] = 'complete'): ScanRun => ({
  ...request(),
  targetIds: request().targetIds,
  startedAt: new Date(0).toISOString(),
  status,
  examined: 2,
  stopReasons: [],
  results: [
    {
      id: 'result-1',
      kind: 'boundary',
      endpoint: `tx:${id(2)}`,
      path: [`tx:${id(1)}`, `out:${id(1)}:0`, `tx:${id(2)}`],
      directions: ['downstream', 'downstream'],
      hops: 1,
      reason: 'fan-out',
    },
  ],
});
function runnerSetup() {
  const worker = new FakeScanWorker();
  const scope = new TransactionFetchScope('testnet4');
  const controller = new AbortController();
  let active = true;
  const progress = vi.fn();
  const pending = runConnectionScanInWorker({
    request: request(),
    network: 'testnet4',
    transactions: { [id(1)]: tx(1), [id(2)]: tx(2, 1), [id(3)]: tx(3) },
    scope,
    signal: controller.signal,
    allowNetwork: false,
    loadedSpenders: (nodeId) => (nodeId === `out:${id(1)}:0` ? [id(2)] : []),
    onProgress: progress,
    isCurrent: () => active,
    workerFactory: () => worker as unknown as Worker,
  });
  return {
    worker,
    scope,
    controller,
    pending,
    progress,
    leave: () => {
      active = false;
    },
  };
}
describe('connection scan worker ownership', () => {
  it('retains only result path transaction evidence', async () => {
    const s = runnerSetup();
    s.worker.reply({ type: 'complete', run: completed() });
    const result = await s.pending;
    expect(Object.keys(result.evidence)).toEqual([id(1), id(2)]);
    expect(s.worker.terminated).toBe(true);
  });
  it('streams new results immediately with only their path evidence while throttling unchanged progress', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const s = runnerSetup();
      const running = completed('running');
      s.worker.reply({ type: 'progress', run: { ...running, results: [] } });
      expect(s.progress).toHaveBeenCalledTimes(1);
      expect(s.progress.mock.calls[0][1]).toEqual({});
      s.worker.reply({ type: 'progress', run: running });
      expect(s.progress).toHaveBeenCalledTimes(2);
      expect(Object.keys(s.progress.mock.calls[1][1])).toEqual([id(1), id(2)]);
      expect(s.progress.mock.calls[1][1][id(3)]).toBeUndefined();
      s.worker.reply({ type: 'progress', run: { ...running, examined: 3 } });
      expect(s.progress).toHaveBeenCalledTimes(2);
      clock.mockReturnValue(1100);
      s.worker.reply({ type: 'progress', run: { ...running, examined: 3 } });
      expect(s.progress).toHaveBeenCalledTimes(3);
      expect(s.progress.mock.calls[2][1]).not.toBe(s.progress.mock.calls[1][1]);
      s.worker.reply({ type: 'complete', run: completed() });
      expect((await s.pending).evidence).toEqual(s.progress.mock.calls[1][1]);
    } finally {
      clock.mockRestore();
    }
  });
  it('delivers final cancelled progress with retained path evidence', async () => {
    const s = runnerSetup();
    s.worker.reply({ type: 'progress', run: completed('running') });
    s.controller.abort();
    s.worker.reply({ type: 'progress', run: completed('cancelled') });
    expect(s.progress.mock.calls.at(-1)![0].status).toBe('cancelled');
    expect(Object.keys(s.progress.mock.calls.at(-1)![1])).toEqual([id(1), id(2)]);
    s.worker.reply({ type: 'complete', run: completed('cancelled') });
    await s.pending;
  });
  it('cancels transport but accepts the worker partial cancelled result', async () => {
    const s = runnerSetup();
    s.controller.abort();
    expect(s.worker.messages.at(-1)).toEqual({ type: 'cancel' });
    expect(s.worker.terminated).toBe(false);
    s.worker.reply({ type: 'complete', run: completed('cancelled') });
    expect((await s.pending).run.status).toBe('cancelled');
  });
  it('terminates on session close and ignores late progress/results', async () => {
    const s = runnerSetup();
    s.scope.close();
    await expect(s.pending).rejects.toMatchObject({ name: 'AbortError' });
    s.worker.reply({ type: 'progress', run: completed() });
    s.worker.reply({ type: 'complete', run: completed() });
    expect(s.progress).not.toHaveBeenCalled();
    expect(s.worker.terminated).toBe(true);
  });
  it('rejects a stale workspace reply even while its fetch scope remains open', async () => {
    const s = runnerSetup();
    s.leave();
    s.worker.reply({ type: 'complete', run: completed() });
    await expect(s.pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.worker.terminated).toBe(true);
  });
  it('mirrors loaded candidate budget consumption across the worker bridge', async () => {
    const s = runnerSetup();
    s.worker.reply({
      type: 'resolve',
      id: 1,
      nodeId: `out:${id(1)}:0`,
      direction: 'downstream',
      examinedTxids: [id(1)],
    });
    await vi.waitFor(() => expect(s.worker.messages.at(-1)?.type).toBe('neighbors'));
    expect(s.worker.messages.at(-1)).toEqual({
      type: 'neighbors',
      id: 1,
      neighbors: { nodeIds: [`tx:${id(2)}`] },
      examinedTxids: [id(2)],
    });
    s.worker.reply({ type: 'complete', run: { ...completed('cancelled'), examined: 0 } });
    expect((await s.pending).run.examined).toBe(2);
  });
});
