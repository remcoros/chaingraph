import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCAN_SETTINGS, runConnectionScan } from '../src/domain/connectionScan';
import { addScanPath, replaceScanRun } from '../src/domain/connectionScanRecords';
import type { Transaction } from '../src/domain/types';
import { newWorkspace, parseWorkspace } from '../src/domain/workspace';
import {
  createConnectionScanFetch,
  type ConnectionScanTransport,
} from '../src/lib/connectionScanFetch';
import { TransactionFetchScope } from '../src/lib/transactionScheduler';

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
  const workspace = newWorkspace('Synthetic visible-target regression', 'mainnet');
  workspace.transactions = { [selected.txid]: selected };
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
      transactions: workspace.transactions,
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
