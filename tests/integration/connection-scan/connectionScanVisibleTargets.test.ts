import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
} from '../../../src/Core/Workspace/ConnectionScan/connectionScan';
import type { ScanResult } from '../../../src/Core/Workspace/ConnectionScan/connectionScans';
import {
  indexScanNeighbours,
  prepareNeighbourScanTargets,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanNeighbours';
import { addScanPath } from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanPath';
import { replaceScanRun } from '../../../src/Core/Workspace/ConnectionScan/updates';
import type { Transaction } from '../../../src/Core/ChainData';
import { buildGraph } from '../../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import {
  createConnectionScanFetch,
  type ConnectionScanTransport,
} from '../../../src/Core/Workspace/ConnectionScan/connectionScanFetch';
import { TransactionFetchScope } from '../../../src/Core/ChainData/transactionScheduler';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${hash(n)}`;
const out = (n: number, vout: number) => `out:${hash(n)}:${vout}`;
const transaction = (n: number, inputs: [number, number][], outputs: number): Transaction => ({
  txid: hash(n),
  vin: inputs.map(([parent, vout]) => ({ txid: hash(parent), vout })),
  vout: Array.from({ length: outputs }, (_, n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});
// Synthetic reproduction of a verified mainnet topology. A five-input transaction
// spends output 150 of a 247-output transaction, and output 1 of another five-input
// transaction that spends output 50 of that same creator. All prevouts are distinct.
const selected = transaction(
  3,
  [
    [5, 1],
    [8, 150],
    [101, 0],
    [102, 0],
    [103, 0],
  ],
  5,
);
const creator = transaction(8, [[100, 0]], 247);
const intermediate = transaction(
  5,
  [
    [8, 50],
    [104, 0],
    [105, 0],
    [106, 0],
    [107, 0],
  ],
  5,
);
const displayed = [
  tx(3),
  ...selected.vin.map((v) => `out:${v.txid}:${v.vout}`),
  ...selected.vout.map((v) => out(3, v.n)),
];
const hiddenPath = [out(8, 150), tx(8), out(8, 50), tx(5), out(5, 1)];

async function scan(source: string, maxHops = 7, direction: 'upstream' | 'both' = 'upstream') {
  const workspace = createWorkspace('Synthetic visible-target regression', 'mainnet');
  workspace.chainData.transactions = { [selected.txid]: selected };
  workspace.view.graphNodeIds = [...displayed];
  const pool = Object.fromEntries([selected, creator, intermediate].map((t) => [t.txid, t]));
  const transport: ConnectionScanTransport = {
    fetchTransaction: vi.fn(async (_network, id) => {
      if (pool[id]) return pool[id];
      throw new Error('Synthetic branch unavailable.');
    }),
    fetchIndexedSpenders: vi.fn(async () => undefined),
    fetchHistory: vi.fn(async () => []),
    fetchUtxo: vi.fn(async () => undefined),
  };
  const signal = new AbortController().signal;
  const adapter = createConnectionScanFetch(
    {
      network: 'mainnet',
      transactions: workspace.chainData.transactions,
      scope: new TransactionFetchScope('mainnet'),
      signal,
      fanOut: 11,
      loadedSpenders: (node) =>
        selected.vin.some((v) => node === `out:${v.txid}:${v.vout}`) ? [selected.txid] : [],
    },
    transport,
  );
  const run = await runConnectionScan({
    id: 'visible-target-regression',
    source,
    targetIds: displayed.filter((node) => node !== source),
    displayedNodeIds: displayed,
    settings: {
      ...DEFAULT_SCAN_SETTINGS,
      direction,
      maxHops,
      maxTransactions: 1000,
      maxMilliseconds: 60_000,
      fanOut: 11,
    },
    resolveNeighbors: adapter.resolveNeighbors,
  });
  return { run, adapter, workspace, transport };
}

describe('scanning beyond already displayed input paths', () => {
  it.each(['upstream', 'both'] as const)(
    'finds the hidden input reconnection from the selected transaction in %s',
    async (direction) => {
      const { run, adapter, workspace } = await scan(tx(3), 7, direction);
      expect(displayed).toHaveLength(11);
      const result = run.results.find(
        (r) => r.kind === 'connection' && r.endpoint === out(5, 1) && r.path.includes(out(8, 150)),
      );
      expect(result).toMatchObject({
        path: [tx(3), ...hiddenPath],
        hops: 2,
        meetingNode: tx(8),
        relationship: 'shared-ancestor',
      });
      const saved = parseWorkspace(replaceScanRun(workspace, run, adapter.evidence));
      const accepted = parseWorkspace(addScanPath(saved, result!));
      expect(new Set(accepted.view.graphNodeIds)).toEqual(new Set([...displayed, ...hiddenPath]));
    },
  );

  it('also finds the same connection when its input is selected', async () => {
    const { run } = await scan(out(8, 150));
    expect(run.results).toContainEqual(
      expect.objectContaining({ kind: 'connection', path: hiddenPath, hops: 2 }),
    );
  });

  it('respects whole-path hop bounds without treating 247 outputs as an upstream branch boundary', async () => {
    const short = await scan(tx(3), 1);
    const enough = await scan(tx(3), 2);
    expect(short.run.results.some((r) => r.kind === 'connection')).toBe(false);
    expect(enough.run.results).toContainEqual(
      expect.objectContaining({ path: [tx(3), ...hiddenPath], hops: 2 }),
    );
    expect(enough.run.results.some((r) => r.finding === 'many-outputs')).toBe(false);
  });
});

describe('default neighbour scan from a transaction-only graph', () => {
  it.each([
    ['only the selected transaction', tx(3), [tx(3)]],
    ['the selected transaction and its inputs and outputs', tx(3), displayed],
    ['only the selected input', out(8, 150), [out(8, 150)]],
    ['the selected input and its spending transaction context', out(8, 150), displayed],
  ] as const)('streams the deeper loop with %s displayed', async (_label, source, graphNodeIds) => {
    const workspace = createWorkspace('Synthetic transaction-only regression', 'mainnet');
    workspace.chainData.transactions = { [selected.txid]: selected };
    workspace.view.graphNodeIds = [...graphNodeIds];
    const graph = buildGraph(workspace);
    const neighbours = indexScanNeighbours(graph);
    const targetIds = prepareNeighbourScanTargets({
      source,
      neighbours,
    }).ids;
    expect(targetIds).toHaveLength(10);
    expect(new Set(targetIds)).toEqual(new Set(displayed.filter((node) => node !== source)));
    const pool = Object.fromEntries([selected, creator, intermediate].map((t) => [t.txid, t]));
    const transport: ConnectionScanTransport = {
      fetchTransaction: vi.fn(async (_network, id) => {
        if (pool[id]) return pool[id];
        throw new Error('Synthetic branch unavailable.');
      }),
      fetchIndexedSpenders: vi.fn(async () => undefined),
      fetchHistory: vi.fn(async () => []),
      fetchUtxo: vi.fn(async () => undefined),
    };
    const adapter = createConnectionScanFetch(
      {
        network: 'mainnet',
        transactions: workspace.chainData.transactions,
        scope: new TransactionFetchScope('mainnet'),
        signal: new AbortController().signal,
        fanOut: DEFAULT_SCAN_SETTINGS.fanOut,
        loadedSpenders: (node) =>
          selected.vin.some((v) => node === `out:${v.txid}:${v.vout}`) ? [selected.txid] : [],
      },
      transport,
    );
    const streamed: ScanResult[] = [];
    const run = await runConnectionScan({
      id: 'transaction-only-regression',
      source,
      targetIds,
      displayedNodeIds: workspace.view.graphNodeIds,
      knownNodeIds: [...neighbours.keys()],
      settings: { ...DEFAULT_SCAN_SETTINGS },
      resolveNeighbors: adapter.resolveNeighbors,
      onProgress: (progress) => streamed.push(...progress.results),
    });
    expect(
      streamed.some((result) => result.kind === 'connection' && result.path.length === 2),
    ).toBe(false);
    const result = run.results.find(
      (item) =>
        item.kind === 'connection' &&
        item.endpoint === out(5, 1) &&
        item.path.includes(out(8, 150)),
    );
    expect(result).toMatchObject({
      path: source === tx(3) ? [tx(3), ...hiddenPath] : hiddenPath,
      hops: 2,
      meetingNode: tx(8),
      relationship: 'shared-ancestor',
    });
    expect(streamed).toContainEqual(result);
    const saved = parseWorkspace(replaceScanRun(workspace, run, adapter.evidence));
    const accepted = parseWorkspace(addScanPath(saved, result!));
    expect(new Set(accepted.view.graphNodeIds)).toEqual(new Set([...graphNodeIds, ...hiddenPath]));
    expect(accepted.chainData.transactions[creator.txid]).toBeDefined();
    expect(accepted.chainData.transactions[intermediate.txid]).toBeDefined();
  });
});
