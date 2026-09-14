import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
  type ScanRun,
} from '../src/Domain/ConnectionScan/connectionScan';
import { addScanPath, replaceScanRun } from '../src/Domain/ConnectionScan/connectionScanRecords';
import type { Transaction } from '../src/Domain/types';
import { newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';
import {
  createConnectionScanFetch,
  type ConnectionScanTransport,
} from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanFetch';
import { TransactionFetchScope } from '../src/Infra/Bitcoin/transactionScheduler';

const id = (n: number) => n.toString(16).padStart(64, '0');
const txNode = (n: number) => `tx:${id(n)}`;
const outNode = (n: number, vout = 0) => `out:${id(n)}:${vout}`;
const ancestor = 1;
const spending = 300;
const branches = Array.from({ length: 5 }, (_, index) => ({
  index,
  middle: 21 + index * 10,
  input: 20 + index * 10,
}));
const transaction = (
  n: number,
  inputs: [number, number][],
  outputCount: number,
  value: number,
): Transaction => ({
  txid: id(n),
  vin: inputs.length
    ? inputs.map(([parent, vout]) => ({ txid: id(parent), vout }))
    : [{ coinbase: '00' }],
  vout: Array.from({ length: outputCount }, (_, n) => ({
    n,
    value,
    scriptPubKey: { hex: '51' },
  })),
});

// Each independent branch spends a different ancestor output. No double spends or
// invented input-to-output allocations are needed to establish the shared ancestry.
const pool = Object.fromEntries(
  [
    transaction(ancestor, [], 5, 10),
    ...branches.flatMap(({ index, middle, input }) => [
      transaction(middle, [[ancestor, index]], 1, 9),
      transaction(input, [[middle, 0]], 1, 8),
    ]),
    transaction(
      spending,
      branches.map(({ input }) => [input, 0]),
      5,
      7,
    ),
  ].map((tx) => [tx.txid, tx]),
);
const displayed = [
  ...branches.map(({ input }) => outNode(input)),
  txNode(spending),
  ...Array.from({ length: 5 }, (_, index) => outNode(spending, index)),
];
function observedEdges(transactions: Record<string, Transaction>) {
  return Object.values(transactions).flatMap((tx) => [
    ...tx.vout.map((output) => [`tx:${tx.txid}`, `out:${tx.txid}:${output.n}`]),
    ...tx.vin.flatMap((input) =>
      input.txid !== undefined && input.vout !== undefined
        ? [[`out:${input.txid}:${input.vout}`, `tx:${tx.txid}`]]
        : [],
    ),
  ]);
}
const settings = {
  ...DEFAULT_SCAN_SETTINGS,
  direction: 'upstream' as const,
  maxHops: 7,
  maxTransactions: 1000,
  maxMilliseconds: 60_000,
  fanOut: 10,
};

function expectedPath(sourceIndex: number, targetIndex: number) {
  const source = branches[sourceIndex]!;
  const target = branches[targetIndex]!;
  return [
    outNode(source.input),
    txNode(source.input),
    outNode(source.middle),
    txNode(source.middle),
    outNode(ancestor, source.index),
    txNode(ancestor),
    outNode(ancestor, target.index),
    txNode(target.middle),
    outNode(target.middle),
    txNode(target.input),
    outNode(target.input),
  ];
}

function inputConnections(run: ScanRun) {
  const inputs = new Set(branches.map(({ input }) => outNode(input)));
  return run.results.filter(
    (result) => result.kind === 'connection' && inputs.has(result.endpoint),
  );
}

async function pureScan(
  sourceIndex: number,
  reverseTargets = false,
  maxHops = 7,
  transactions = pool,
) {
  const source = outNode(branches[sourceIndex]!.input);
  const targetIds = displayed.filter((node) => node !== source);
  const edges = observedEdges(transactions);
  return runConnectionScan({
    id: `five-inputs-${sourceIndex}`,
    source,
    targetIds: reverseTargets ? targetIds.reverse() : targetIds,
    displayedNodeIds: displayed,
    settings: { ...settings, maxHops },
    resolveNeighbors: async (node, direction) => ({
      nodeIds: edges
        .filter((edge) => edge[direction === 'upstream' ? 1 : 0] === node)
        .map((edge) => edge[direction === 'upstream' ? 0 : 1]!),
    }),
  });
}

describe('shared ancestry between the inputs of a five-input, five-output transaction', () => {
  it('finds an isolated five-hop input pair when other inputs have independent origins', async () => {
    const independentOrigins = {
      ...pool,
      ...Object.fromEntries(
        branches.slice(0, 3).map(({ middle }) => [id(middle), transaction(middle, [], 1, 9)]),
      ),
    };
    const run = await pureScan(4, false, 7, independentOrigins);
    expect(inputConnections(run)).toHaveLength(1);
    expect(inputConnections(run)[0]).toMatchObject({
      endpoint: outNode(branches[3]!.input),
      path: expectedPath(4, 3),
      hops: 5,
      relationship: 'shared-ancestor',
    });
  });

  it.each(branches.map((branch) => branch.index))(
    'finds all four five-hop input connections from input %i without losing target witnesses',
    async (sourceIndex) => {
      const run = await pureScan(sourceIndex);
      const findings = inputConnections(run);
      expect(displayed).toHaveLength(11);
      expect(findings.map((result) => result.endpoint).sort()).toEqual(
        branches
          .filter(({ index }) => index !== sourceIndex)
          .map(({ input }) => outNode(input))
          .sort(),
      );
      for (const target of branches.filter(({ index }) => index !== sourceIndex)) {
        expect(findings.find((result) => result.endpoint === outNode(target.input))).toMatchObject({
          relationship: 'shared-ancestor',
          path: expectedPath(sourceIndex, target.index),
          meetingNode: txNode(ancestor),
          hops: 5,
          directions: [...Array(5).fill('upstream'), ...Array(5).fill('downstream')],
        });
      }
      // The transaction allowance is shared across witnesses, not reset per input.
      expect(run.examined).toBe(Object.keys(pool).length);
      expect(run.stopReasons).not.toContain('transactions');
    },
  );

  it('produces the same input paths when the frozen target order is reversed', async () => {
    const ordered = await pureScan(4);
    const reversed = await pureScan(4, true);
    expect(inputConnections(ordered)).toHaveLength(4);
    expect(inputConnections(reversed)).toEqual(inputConnections(ordered));
    expect(reversed.examined).toBe(ordered.examined);
  });

  it('applies the hop allowance to the entire connection rather than each ancestry branch', async () => {
    const tooShort = await pureScan(0, false, 4);
    const enough = await pureScan(0, false, 5);
    expect(inputConnections(tooShort)).toEqual([]);
    expect(inputConnections(enough)).toHaveLength(4);
    expect(inputConnections(enough).every((result) => result.hops === 5)).toBe(true);
  });

  it('publishes every discovered input connection before a later target lookup is cancelled', async () => {
    const source = outNode(branches[4]!.input);
    const controller = new AbortController();
    const edges = observedEdges(pool);
    let ancestorLookups = 0;
    let publishedEndpoints: string[] = [];
    let endpointsBeforeCancellation: string[] | undefined;
    const run = await runConnectionScan({
      id: 'five-inputs-streaming',
      source,
      targetIds: displayed.filter((node) => node !== source),
      displayedNodeIds: displayed,
      settings,
      signal: controller.signal,
      onProgress: (progress) => {
        publishedEndpoints = inputConnections(progress).map((result) => result.endpoint);
      },
      resolveNeighbors: async (node, direction) => {
        if (node === txNode(ancestor) && ++ancestorLookups === 2) {
          // Source ancestry is already explored. All other input branches have
          // now reached that ancestor, before its target-side lookup completes.
          endpointsBeforeCancellation = [...publishedEndpoints];
          controller.abort();
        }
        return {
          nodeIds: edges
            .filter((edge) => edge[direction === 'upstream' ? 1 : 0] === node)
            .map((edge) => edge[direction === 'upstream' ? 0 : 1]!),
        };
      },
    });
    expect(ancestorLookups).toBe(2);
    expect(endpointsBeforeCancellation?.sort()).toEqual(
      branches
        .slice(0, 4)
        .map(({ input }) => outNode(input))
        .sort(),
    );
    expect(inputConnections(run)).toHaveLength(4);
    expect(run.status).toBe('cancelled');
    expect(run.stopReasons).toContain('cancelled');
  });

  it('fetches missing ancestry and retains verified input paths for exact graph acceptance', async () => {
    const workspace = newWorkspace('Public five-input scan fixture', 'testnet4');
    workspace.transactions = { [id(spending)]: pool[id(spending)]! };
    workspace.view.graphNodeIds = [...displayed];
    const sourceIndex = 4;
    const source = outNode(branches[sourceIndex]!.input);
    const signal = new AbortController().signal;
    const transport: ConnectionScanTransport = {
      fetchTransaction: vi.fn(async (_network, txid) => {
        const tx = pool[txid];
        if (!tx) throw new Error('Unknown public fixture transaction.');
        return tx;
      }),
      fetchIndexedSpenders: vi.fn(async () => undefined),
      fetchHistory: vi.fn(async () => []),
      fetchUtxo: vi.fn(async () => undefined),
    };
    const adapter = createConnectionScanFetch(
      {
        network: workspace.network,
        transactions: workspace.transactions,
        scope: new TransactionFetchScope(workspace.network),
        signal,
        allowNetwork: true,
        fanOut: settings.fanOut,
        loadedSpenders: () => [],
      },
      transport,
    );
    const run = await runConnectionScan({
      id: 'five-inputs-evidence',
      source,
      targetIds: displayed.filter((node) => node !== source),
      displayedNodeIds: displayed,
      settings,
      signal,
      resolveNeighbors: adapter.resolveNeighbors,
    });
    expect(inputConnections(run)).toHaveLength(4);
    expect(transport.fetchTransaction).toHaveBeenCalledTimes(Object.keys(pool).length - 1);
    expect(transport.fetchIndexedSpenders).not.toHaveBeenCalled();
    expect(transport.fetchHistory).not.toHaveBeenCalled();
    expect(transport.fetchUtxo).not.toHaveBeenCalled();
    const saved = parseWorkspace(replaceScanRun(workspace, run, adapter.evidence));
    expect(saved.transactions).toEqual(workspace.transactions);
    const retained = saved.connectionScans!.runs[0]!;
    for (const finding of inputConnections(retained)) {
      const accepted = parseWorkspace(addScanPath(saved, finding));
      expect(new Set(accepted.view.graphNodeIds)).toEqual(new Set([...displayed, ...finding.path]));
      expect(accepted.connectionScans!.runs[0]!.source).toBe(source);
    }
  });
});
