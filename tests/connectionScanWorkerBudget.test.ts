import { expect, it, vi } from 'vitest';
import { DEFAULT_SCAN_SETTINGS } from '../src/Domain/ConnectionScan/connectionScan';
import type { Transaction } from '../src/Domain/types';
import { connectionScanTransport } from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanFetch';
import type {
  ScanWorkerInput,
  ScanWorkerOutput,
} from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanProtocol';
import { runConnectionScanInWorker } from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanRunner';
import { TransactionFetchScope } from '../src/Infra/Bitcoin/transactionScheduler';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const out = (n: number) => `out:${hash(n)}:0`;
const tx = (n: number): Transaction => ({
  txid: hash(n),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
});

it('keeps admitted connections when concurrent roots compete with discovered evidence for the budget', async () => {
  const controller = new AbortController();
  const scope = new TransactionFetchScope('testnet4');
  let terminated = false;
  let releaseEvidence!: () => void;
  const competingRootSent = new Promise<void>((resolve) => {
    releaseEvidence = resolve;
  });
  const worker = {
    onmessage: null as ((event: MessageEvent<ScanWorkerOutput>) => void) | null,
    onerror: null,
    postMessage(message: ScanWorkerInput) {
      queueMicrotask(() => {
        if (!terminated) runtime.onmessage?.({ data: message } as MessageEvent<ScanWorkerInput>);
      });
    },
    terminate() {
      terminated = true;
    },
  };
  const runtime = {
    onmessage: null as ((event: MessageEvent<ScanWorkerInput>) => void) | null,
    postMessage(message: ScanWorkerOutput) {
      // Delay one root at the bridge while two admitted roots discover a shared spender.
      // The worker must not independently spend the runner's last reservation on it.
      if (message.type === 'resolve' && message.nodeId === `tx:${hash(3)}`) {
        releaseEvidence();
        return;
      }
      queueMicrotask(() => {
        if (!terminated) worker.onmessage?.({ data: message } as MessageEvent<ScanWorkerOutput>);
      });
    },
  };
  vi.stubGlobal('self', runtime);
  const spender = tx(2);
  spender.vin = [1, 4].map((n) => ({ txid: hash(n), vout: 0 }));
  const lookup = vi
    .spyOn(connectionScanTransport, 'fetchIndexedSpenders')
    .mockImplementation(async (_network, _points, _existing, _signal, _hints, examine) => {
      await competingRootSent;
      examine?.(spender.txid);
      return { transactions: [spender], unresolved: [], inspected: 1, unavailableTxids: [] };
    });
  const utxo = vi.spyOn(connectionScanTransport, 'fetchUtxo').mockResolvedValue(undefined);
  try {
    // Execute the real worker message handler, with an in-process message transport.
    await import('../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScan.worker');
    const result = await runConnectionScanInWorker({
      request: {
        id: 'shared-budget',
        source: out(1),
        targetIds: [out(4), `tx:${hash(3)}`],
        displayedNodeIds: [out(1), out(4), `tx:${hash(3)}`],
        settings: {
          ...DEFAULT_SCAN_SETTINGS,
          direction: 'downstream',
          maxTransactions: 3,
          maxMilliseconds: 1000,
        },
      },
      network: 'testnet4',
      transactions: { [hash(1)]: tx(1), [hash(4)]: tx(4) },
      loadedSpenders: () => [],
      scope,
      signal: controller.signal,
      workerFactory: () => worker as unknown as Worker,
      onProgress(run) {
        if (run.results.some((item) => item.kind === 'connection')) controller.abort();
      },
    });
    expect(result.run.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'connection',
          endpoint: out(4),
          relationship: 'shared-descendant',
        }),
      ]),
    );
    expect(result.run.examined).toBe(3);
    expect(result.run.stopReasons).not.toContain('transactions');
    expect(result.evidence[hash(2)]).toEqual(spender);
    expect(terminated).toBe(true);
  } finally {
    controller.abort();
    scope.close();
    lookup.mockRestore();
    utxo.mockRestore();
    vi.unstubAllGlobals();
  }
});
