import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../src/domain/types';
import { ScanBudgetExceeded, type ScanBudget } from '../src/domain/connectionScan';
import {
  createConnectionScanFetch,
  connectionScanTransport,
  type ConnectionScanFetchOptions,
} from '../src/lib/connectionScanFetch';
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
  extra: Partial<ConnectionScanFetchOptions> = {},
) {
  const scope = new TransactionFetchScope('testnet4');
  const controller = new AbortController();
  const transport = {
    fetchTransaction: vi.fn<typeof connectionScanTransport.fetchTransaction>(),
    fetchIndexedSpenders: vi
      .fn<typeof connectionScanTransport.fetchIndexedSpenders>()
      .mockResolvedValue(undefined),
    fetchHistory: vi.fn<typeof connectionScanTransport.fetchHistory>().mockResolvedValue([]),
    fetchUtxo: vi.fn<typeof connectionScanTransport.fetchUtxo>().mockResolvedValue(undefined),
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
      ...extra,
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
      observation: { finding: 'coinbase' },
    });
  });
  it('uses loaded exact spends and charges cached evidence without network', async () => {
    const s = setup([tx(1), tx(2, 1)]);
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [`tx:${id(2)}`],
    });
    expect(b.examinedTxids).toEqual([id(2), id(1)]);
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
    const b = budget(2);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [`tx:${id(2)}`],
    });
    expect(b.examinedTxids).toEqual([id(2), id(1)]);
  });
  it('verifies a loaded spender hint before claiming an observed spending edge', async () => {
    const s = setup([tx(1), tx(2)], false, () => [id(2)]);
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [],
      stopReason: 'failure',
      observation: { finding: 'conflicting-evidence' },
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
      observation: { finding: 'conflicting-evidence' },
    });
    expect(b.examinedTxids).toEqual([id(1)]);
  });
  it('reports an unloaded offline creator as unknown, without inventing an edge', async () => {
    const s = setup([], false);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'upstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'offline',
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
      stopReason: 'offline',
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
      stopReason: 'unknown',
      observation: { finding: 'transaction-unavailable' },
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
import type {
  ConnectionScanRequest,
  ScanWorkerInput,
  ScanWorkerOutput,
} from '../src/lib/connectionScanProtocol';

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
function runnerSetup(scanRequest: ConnectionScanRequest = request()) {
  const worker = new FakeScanWorker();
  const scope = new TransactionFetchScope('testnet4');
  const controller = new AbortController();
  let active = true;
  const progress = vi.fn();
  const pending = runConnectionScanInWorker({
    request: scanRequest,
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
  it('freezes loaded scan context independently from displayed nodes across the worker boundary', async () => {
    const initial = {
      ...request(),
      knownNodeIds: [`tx:${id(1)}`, `out:${id(1)}:0`],
      knownLinks: [[`tx:${id(1)}`, `out:${id(1)}:0`] as [string, string]],
    };
    const expected = structuredClone(initial);
    const s = runnerSetup(initial);
    initial.knownNodeIds.push(`tx:${id(2)}`);
    initial.displayedNodeIds.length = 0;
    initial.knownLinks[0][1] = `out:${id(2)}:0`;
    initial.knownLinks.length = 0;
    expect(s.worker.messages[0]).toEqual({ type: 'start', request: expected });
    s.worker.reply({ type: 'complete', run: completed() });
    await s.pending;
  });
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

describe('scan stopping-point evidence', () => {
  it('reports exact many-input and many-output counts without truncating at the threshold', async () => {
    const many = tx(1);
    many.vin = Array.from({ length: 67 }, (_, n) => ({ txid: id(n + 2), vout: 0 }));
    many.vout = Array.from({ length: 81 }, (_, n) => ({ ...tx(1).vout[0], n }));
    const s = setup([many], false, undefined, { fanOut: 50 });
    expect(await s.resolveNeighbors(`tx:${id(1)}`, 'upstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'fan-out',
      observation: { finding: 'many-inputs', branchCount: 67 },
    });
    expect(await s.resolveNeighbors(`tx:${id(1)}`, 'downstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'fan-out',
      observation: { finding: 'many-outputs', branchCount: 81 },
    });
  });
  it('recognizes only raw OP_RETURN scripts as unspendable', async () => {
    const root = tx(1);
    root.vout[0].scriptPubKey = { hex: '6a026162', type: 'nulldata' };
    const s = setup([root], false);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [],
      observation: { finding: 'unspendable' },
    });
    expect(s.transport.fetchUtxo).not.toHaveBeenCalled();
    root.vout[0].scriptPubKey = { hex: '516a', type: 'nulldata' };
    const other = setup([root], false);
    expect(await other.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'offline',
    });
  });
  it('retains positive unspent metadata and checks a point at most once per run', async () => {
    const s = setup([tx(1)]);
    const observation = {
      finding: 'unspent' as const,
      checkedAt: '2026-09-10T00:00:00.000Z',
      bestBlock: id(9),
      includesMempool: true,
    };
    s.transport.fetchUtxo.mockResolvedValue(observation);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [],
      observation,
    });
    await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget());
    expect(s.transport.fetchUtxo).toHaveBeenCalledOnce();
    expect(s.transport.fetchIndexedSpenders).not.toHaveBeenCalled();
  });
  it('keeps absent current UTXO and empty spender evidence unknown', async () => {
    const s = setup([tx(1)]);
    s.transport.fetchIndexedSpenders.mockResolvedValue({
      transactions: [],
      unresolved: [],
      inspected: 0,
      unavailableTxids: [],
    });
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'unknown',
      observation: { finding: 'spend-unknown' },
    });
  });
  it('does not claim unspent when loaded spends conflict', async () => {
    const s = setup([tx(1), tx(2, 1), tx(3, 1)]);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [],
      stopReason: 'failure',
      observation: { finding: 'conflicting-evidence' },
    });
    expect(s.transport.fetchUtxo).not.toHaveBeenCalled();
  });
  it('reports a loaded spend of OP_RETURN as conflicting observations', async () => {
    const root = tx(1);
    root.vout[0].scriptPubKey.hex = '6a';
    const s = setup([root, tx(2, 1)]);
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toMatchObject({
      observation: { finding: 'conflicting-evidence' },
    });
    expect(s.transport.fetchUtxo).not.toHaveBeenCalled();
  });
  it('rejects incorrect indexed spending transactions before retaining their payload', async () => {
    const s = setup([tx(1)]);
    s.transport.fetchIndexedSpenders.mockResolvedValue({
      transactions: [tx(2)],
      unresolved: [],
      inspected: 1,
      unavailableTxids: [],
    });
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toMatchObject({
      observation: { finding: 'conflicting-evidence' },
    });
    expect(s.evidence[id(2)]).toBeUndefined();
    expect(b.examinedTxids).toEqual([id(1), id(2)]);
  });
  it('follows an exact indexed spend without first downloading its unavailable creator', async () => {
    const s = setup();
    s.transport.fetchTransaction.mockRejectedValue(new Error('Synthetic creator unavailable'));
    s.transport.fetchIndexedSpenders.mockResolvedValue({
      transactions: [tx(2, 1)],
      unresolved: [],
      inspected: 1,
      unavailableTxids: [],
    });
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget())).toEqual({
      nodeIds: [`tx:${id(2)}`],
    });
    expect(s.transport.fetchTransaction).not.toHaveBeenCalled();
    expect(s.transport.fetchUtxo).not.toHaveBeenCalled();
    expect(s.evidence[id(2)]).toBeDefined();
    expect(s.evidence[id(1)]).toBeUndefined();
  });
  it('omits a disputed creator from retained path evidence when its output is absent', async () => {
    const s = setup([tx(1)], false);
    expect(await s.resolveNeighbors(`out:${id(1)}:1`, 'upstream', budget())).toMatchObject({
      observation: { finding: 'conflicting-evidence' },
    });
    expect(s.evidence[id(1)]).toBeUndefined();
  });
  it('rejects fetched transaction identity mismatches without saving their bytes', async () => {
    const s = setup();
    s.transport.fetchTransaction.mockResolvedValue(tx(2));
    expect(await s.resolveNeighbors(`tx:${id(1)}`, 'upstream', budget())).toMatchObject({
      observation: { finding: 'conflicting-evidence' },
    });
    expect(Object.keys(s.evidence)).toEqual([]);
  });
  it('explicit retry refreshes stale loaded endpoint evidence once', async () => {
    const fresh = tx(1);
    fresh.vout[0].scriptPubKey.hex = '6a';
    const s = setup([tx(1)], true, undefined, { refresh: true });
    s.transport.fetchTransaction.mockResolvedValue(fresh);
    const b = budget();
    expect(await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b)).toEqual({
      nodeIds: [],
      observation: { finding: 'unspendable' },
    });
    await s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', b);
    expect(s.transport.fetchTransaction).toHaveBeenCalledOnce();
    expect(b.examinedTxids).toEqual([id(1)]);
  });
  it('rejects a late UTXO observation after the fetch scope closes', async () => {
    const s = setup([tx(1)]);
    let deliver!: (value: undefined) => void;
    s.transport.fetchUtxo.mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = s.resolveNeighbors(`out:${id(1)}:0`, 'downstream', budget());
    await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
    s.scope.close();
    deliver(undefined);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.transport.fetchIndexedSpenders).not.toHaveBeenCalled();
  });
});
