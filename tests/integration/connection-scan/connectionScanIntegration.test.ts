import { describe, expect, it } from 'vitest';
import { indexGraphFlow } from '../../../src/App/Workspace/Workbenches/Graph/Renderer/flowContext';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScan';
import {
  addScanPath,
  replaceScanRun,
  clearScanRuns,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanRecords';
import { buildGraph } from '../../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../../src/App/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/App/Workspace/Persistence/Format';
import type { Transaction } from '../../../src/Domain/Chain/transaction';
import { createConnectionScanFetch } from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanFetch';
import { TransactionFetchScope } from '../../../src/Infra/Bitcoin/transactionScheduler';

const id = (n: number) => n.toString(16).padStart(64, '0');
const node = (n: number) => `tx:${id(n)}`;
const transaction = (n: number, inputs: [number, number][] = []): Transaction => ({
  txid: id(n),
  vin: inputs.length
    ? inputs.map(([parent, vout]) => ({ txid: id(parent), vout }))
    : [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});

describe('connection scan module integration', () => {
  it.each([
    { source: 1, target: 4, direction: 'downstream' as const, relationship: 'direct' },
    { source: 2, target: 3, direction: 'upstream' as const, relationship: 'shared-ancestor' },
    { source: 2, target: 3, direction: 'downstream' as const, relationship: 'shared-descendant' },
  ])(
    'retains verified $relationship evidence through record validation and exact graph acceptance',
    async ({ source, target, direction, relationship }) => {
      const pool = Object.fromEntries(
        [
          transaction(1),
          transaction(2, [[1, 0]]),
          transaction(3, [[1, 1]]),
          transaction(4, [
            [2, 0],
            [3, 0],
          ]),
          transaction(9),
        ].map((tx) => [tx.txid, tx]),
      );
      const workspace = createWorkspace('Public scan integration fixture', 'testnet4');
      workspace.transactions = { [id(source)]: pool[id(source)], [id(target)]: pool[id(target)] };
      workspace.view.graphNodeIds = [node(source), node(target)];
      const loadedIndex = indexGraphFlow(buildGraph({ ...workspace, transactions: pool }));
      const signal = new AbortController().signal;
      const adapter = createConnectionScanFetch({
        network: workspace.network,
        transactions: pool,
        scope: new TransactionFetchScope(workspace.network),
        signal,
        allowNetwork: false,
        loadedSpenders: (id) => loadedIndex.spenders.get(id) ?? [],
      });
      const run = await runConnectionScan({
        id: `integration-${relationship}`,
        source: node(source),
        targetIds: [node(target)],
        displayedNodeIds: workspace.view.graphNodeIds,
        settings: { ...DEFAULT_SCAN_SETTINGS, direction },
        signal,
        resolveNeighbors: adapter.resolveNeighbors,
      });
      const result = run.results.find((result) => result.relationship === relationship);
      expect(result).toBeDefined();
      expect(run.examined).toBeLessThanOrEqual(run.settings.maxTransactions);
      const saved = parseWorkspace(replaceScanRun(workspace, run, adapter.evidence));
      expect(saved.transactions).toEqual(workspace.transactions);
      expect(saved.connectionScans?.evidence[id(9)]).toBeUndefined();
      const added = parseWorkspace(addScanPath(saved, result!));
      expect(added.view.graphNodeIds?.sort()).toEqual([...new Set(result!.path)].sort());
      expect(clearScanRuns(added).view.graphNodeIds).toEqual(added.view.graphNodeIds);
    },
  );
});
