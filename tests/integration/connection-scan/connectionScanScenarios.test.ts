import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
} from '../../../src/Core/Workspace/ConnectionScan/connectionScan';
import { isScanNodeId } from '../../../src/Core/Workspace/ConnectionScan/scanNode';
import type {
  ScanResult,
  ScanSettings,
} from '../../../src/Core/Workspace/ConnectionScan/connectionScans';
import { mergeScanRunSnapshots } from '../../../src/Core/Workspace/ConnectionScan/results';
import type { Workspace } from '../../../src/Core/Workspace/workspace';

import { addScanPathAddition } from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanAddition';

import {
  indexScanNeighbours,
  prepareNeighbourScanTargets,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanNeighbours';
import { replaceScanRun } from '../../../src/Core/Workspace/ConnectionScan/updates';
import { projectGraphMembership } from '../../../src/App/Workspace/GraphState/graphMembership';
import type { Transaction } from '../../../src/Core/ChainData';

import { buildGraph } from '../../../src/App/Workspace/GraphState/graphEvidence';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import {
  createConnectionScanFetch,
  type ConnectionScanTransport,
} from '../../../src/Core/Workspace/ConnectionScan/connectionScanFetch';
import { TransactionFetchScope } from '../../../src/Core/ChainData/transactionScheduler';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${hash(n)}`;
const out = (n: number, vout = 0) => `out:${hash(n)}:${vout}`;
const transaction = (n: number, inputs: [number, number][] = [], outputs = 2): Transaction => ({
  txid: hash(n),
  vin: inputs.length
    ? inputs.map(([parent, vout]) => ({ txid: hash(parent), vout }))
    : [{ coinbase: '00' }],
  vout: Array.from({ length: outputs }, (_, n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});
const poolOf = (transactions: Transaction[]) =>
  Object.fromEntries(transactions.map((value) => [value.txid, value]));
const edge = (a: string, b: string) => [a, b].sort().join('|');
const pathEdges = (path: readonly string[]) => path.slice(1).map((node, i) => edge(path[i], node));
const cycleEdges = (result: ScanResult) =>
  [...new Set([...pathEdges(result.path), ...pathEdges(result.context?.path ?? [])])].sort();
const connections = (results: ScanResult[]) =>
  results.filter((result) => result.kind === 'connection');
const relations = (results: ScanResult[]) =>
  connections(results)
    .map((result) => ({
      endpoint: result.endpoint,
      relationship: result.relationship,
      bridge: result.bridge ?? false,
      meetingNode: result.meetingNode,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Exercise the production graph index, target snapshot, evidence adapter and scanner together. */
async function scanScenario(
  workspace: Workspace,
  pool: Record<string, Transaction>,
  source: string,
  options: { targets?: string[]; settings?: Partial<ScanSettings>; id?: string } = {},
) {
  const settings = { ...DEFAULT_SCAN_SETTINGS, ...options.settings };
  const graph = buildGraph(workspace);
  const neighbours = indexScanNeighbours(graph);
  const targetIds = options.targets ?? prepareNeighbourScanTargets({ source, neighbours }).ids;
  const knownLinks = [...neighbours].flatMap(([node, adjacent]) =>
    adjacent.filter((other) => node < other).map((other) => [node, other] as const),
  );
  const displayed = projectGraphMembership(graph, workspace.view.graphNodeIds)
    .nodes.filter((node) => !workspace.view.hiddenNodeIds?.includes(node.id))
    .map((node) => node.id);
  const transport: ConnectionScanTransport = {
    fetchTransaction: async (_network, id) => {
      if (!pool[id]) throw new Error('Synthetic transaction unavailable.');
      return pool[id];
    },
    fetchIndexedSpenders: async (_network, points, _existing, _signal, _hints, beforeInspect) => {
      const transactions = Object.values(pool).filter((value) =>
        value.vin.some((input) =>
          points.some((point) => input.txid === point.txid && input.vout === point.vout),
        ),
      );
      for (const value of transactions) beforeInspect?.(value.txid);
      return {
        exact: 'complete',
        transactions,
        unresolved: [],
        inspected: transactions.length,
        unavailableTxids: [],
      };
    },
    fetchHistory: async () => [],
    fetchUtxo: async () => undefined,
  };
  const scope = new TransactionFetchScope(workspace.network);
  const signal = new AbortController().signal;
  const adapter = createConnectionScanFetch(
    {
      network: workspace.network,
      transactions: workspace.chainData.transactions,
      scope,
      signal,
      fanOut: settings.fanOut,
    },
    transport,
  );
  try {
    const run = await runConnectionScan({
      id: options.id ?? 'synthetic-scenario',
      source,
      targetIds,
      settings,
      knownNodeIds: graph.nodes.filter((node) => isScanNodeId(node.id)).map((node) => node.id),
      knownLinks,
      displayedNodeIds: displayed,
      signal,
      resolveNeighbors: adapter.resolveNeighbors,
    });
    return { run, evidence: adapter.evidence, targetIds };
  } finally {
    scope.close();
  }
}

function whirlpool() {
  const selected = transaction(
    30,
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
  const workspace = createWorkspace('Public five-input scenario', 'mainnet');
  workspace.chainData.transactions = { [selected.txid]: selected };
  workspace.view.graphNodeIds = [tx(30)];
  return { workspace, pool: poolOf([selected, creator, intermediate]) };
}
const expectedLoop = [tx(30), out(8, 150), tx(8), out(8, 50), tx(5), out(5, 1), tx(30)];
const expectedLoopEdges = pathEdges(expectedLoop).sort();

describe('synthetic scan scenarios through loaded graph and transaction evidence', () => {
  it('finds exactly the hidden input loop from the only canvas transaction with defaults', async () => {
    const { workspace, pool } = whirlpool();
    const { run, evidence, targetIds } = await scanScenario(workspace, pool, tx(30));
    expect(targetIds).toHaveLength(10);
    expect(connections(run.results).map(cycleEdges)).toEqual([expectedLoopEdges]);
    expect(connections(run.results).map((result) => result.relationship)).toEqual([
      'shared-ancestor',
    ]);
    expect(connections(run.results).every((result) => !result.bridge && !!result.context)).toBe(
      true,
    );
    const saved = replaceScanRun(workspace, run, evidence);
    const added = addScanPathAddition(saved, connections(run.results)[0]);
    expect(new Set(added.view.graphNodeIds)).toEqual(new Set(expectedLoop));
    const acceptedGraph = projectGraphMembership(buildGraph(added), added.view.graphNodeIds);
    expect(acceptedGraph.links.map((link) => edge(link.source, link.target)).sort()).toEqual(
      expectedLoopEdges,
    );
  });

  it.each(['neighbours', 'custom'] as const)(
    'returns identical exact relations in %s when I/O are unadded, shown, or manually hidden',
    async (targetScope) => {
      const { workspace, pool } = whirlpool();
      const allNodes = buildGraph(workspace).nodes.map((node) => node.id);
      const targets = prepareNeighbourScanTargets({
        source: tx(30),
        neighbours: indexScanNeighbours(buildGraph(workspace)),
      }).ids;
      for (const view of [
        { ...workspace.view, graphNodeIds: [tx(30)] },
        { ...workspace.view, graphNodeIds: allNodes },
        {
          ...workspace.view,
          graphNodeIds: allNodes,
          hiddenNodeIds: allNodes.filter((node) => node !== tx(30)),
        },
      ]) {
        const { run, targetIds } = await scanScenario({ ...workspace, view }, pool, tx(30), {
          targets,
          settings: { targetScope },
        });
        expect(targetIds).toEqual(targets);
        if (targetScope === 'neighbours')
          expect(connections(run.results).map(cycleEdges)).toEqual([expectedLoopEdges]);
        else
          expect(
            connections(run.results)
              .map((r) => [...new Set(pathEdges(r.path))].sort())
              .sort(),
          ).toEqual(
            [
              pathEdges(expectedLoop.slice(0, -1)).sort(),
              pathEdges([tx(30), out(5, 1), tx(5), out(8, 50), tx(8), out(8, 150)]).sort(),
            ].sort(),
          );
      }
    },
  );

  it('finds the same exact loop when one known input is the source', async () => {
    const { workspace, pool } = whirlpool();
    const { run } = await scanScenario(workspace, pool, out(8, 150));
    expect(connections(run.results).map(cycleEdges)).toEqual([expectedLoopEdges]);
  });

  it('does not rediscover a fully loaded loop just because only its root is on canvas', async () => {
    const { workspace, pool } = whirlpool();
    workspace.chainData.transactions = pool;
    const { run } = await scanScenario(workspace, pool, tx(30));
    expect(connections(run.results)).toEqual([]);
  });

  it('merges reruns of the same exact cycle into one retained connection', async () => {
    const { workspace, pool } = whirlpool();
    const first = await scanScenario(workspace, pool, tx(30), { id: 'first' });
    const second = await scanScenario(workspace, pool, tx(30), { id: 'second' });
    const merged = mergeScanRunSnapshots([first.run], [second.run]);
    expect(merged.flatMap((run) => connections(run.results)).map(cycleEdges)).toEqual([
      expectedLoopEdges,
    ]);
  });

  it.each(['upstream', 'downstream', 'both'] as const)(
    'omits ordinary already loaded ancestry in %s even with only the root on canvas',
    async (direction) => {
      const pool = poolOf([transaction(1), transaction(2, [[1, 0]]), transaction(3, [[2, 0]])]);
      const workspace = createWorkspace('Public loaded ancestry scenario', 'mainnet');
      workspace.chainData.transactions = pool;
      workspace.view.graphNodeIds = [tx(3)];
      const { run } = await scanScenario(workspace, pool, tx(3), { settings: { direction } });
      expect(connections(run.results)).toEqual([]);
    },
  );

  it.each(['upstream', 'downstream', 'both'] as const)(
    'does not report direct creation or a return to the same creator in %s',
    async (direction) => {
      const selected = transaction(2, [[1, 0]], 1);
      const workspace = createWorkspace('Public direct I/O scenario', 'mainnet');
      workspace.chainData.transactions = { [selected.txid]: selected };
      workspace.view.graphNodeIds = [tx(2)];
      const { run } = await scanScenario(workspace, poolOf([selected, transaction(1)]), tx(2), {
        settings: { direction },
      });
      expect(connections(run.results)).toEqual([]);
    },
  );

  it('omits a shared creator already identified by sibling prevouts on disconnected transaction anchors', async () => {
    const pool = poolOf([transaction(1), transaction(2, [[1, 0]]), transaction(3, [[1, 1]])]);
    const workspace = createWorkspace('Public implicit creator scenario', 'mainnet');
    workspace.chainData.transactions = { [hash(2)]: pool[hash(2)], [hash(3)]: pool[hash(3)] };
    workspace.view.graphNodeIds = [tx(2), tx(3)];
    const { run } = await scanScenario(workspace, pool, tx(2), {
      targets: [tx(3)],
      settings: { targetScope: 'added', direction: 'upstream' },
    });
    expect(connections(run.results)).toEqual([]);
  });

  it('reports exactly the deeper shared ancestor between disconnected loaded transaction anchors', async () => {
    const pool = poolOf([
      transaction(9),
      transaction(1, [[9, 0]]),
      transaction(5, [[9, 1]]),
      transaction(2, [[1, 0]]),
      transaction(3, [[5, 0]]),
    ]);
    const workspace = createWorkspace('Public disconnected ancestor scenario', 'mainnet');
    workspace.chainData.transactions = { [hash(2)]: pool[hash(2)], [hash(3)]: pool[hash(3)] };
    workspace.view.graphNodeIds = [tx(2), tx(3)];
    const { run } = await scanScenario(workspace, pool, tx(2), {
      targets: [tx(3)],
      settings: { targetScope: 'added', direction: 'upstream', maxHops: 7 },
    });
    expect(relations(run.results)).toEqual([
      { endpoint: tx(3), relationship: 'shared-ancestor', bridge: true, meetingNode: tx(9) },
    ]);
    expect(connections(run.results).map((result) => result.path)).toEqual([
      [tx(2), out(1), tx(1), out(9), tx(9), out(9, 1), tx(5), out(5), tx(3)],
    ]);
  });

  it('reports exactly the discovered shared spender of disconnected outputs, independent of target visibility', async () => {
    const pool = poolOf([
      transaction(1),
      transaction(2),
      transaction(3, [
        [1, 0],
        [2, 0],
      ]),
    ]);
    const workspace = createWorkspace('Public disconnected spender scenario', 'mainnet');
    workspace.chainData.transactions = { [hash(1)]: pool[hash(1)], [hash(2)]: pool[hash(2)] };
    for (const graphNodeIds of [[out(1)], [out(1), out(2)]]) {
      workspace.view = { ...workspace.view, graphNodeIds };
      const { run } = await scanScenario(workspace, pool, out(1), {
        targets: [out(2)],
        settings: { targetScope: 'added', direction: 'downstream' },
      });
      expect(relations(run.results)).toEqual([
        { endpoint: out(2), relationship: 'shared-descendant', bridge: true, meetingNode: tx(3) },
      ]);
      expect(connections(run.results).map((result) => result.path)).toEqual([
        [out(1), tx(3), out(2)],
      ]);
    }
  });
});
