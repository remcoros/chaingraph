import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS } from '../../../../../Core/Workspace/ConnectionScan/connectionScan';
import type {
  ScanResult,
  ScanRun,
} from '../../../../../Core/Workspace/ConnectionScan/connectionScans';
import {
  addScanNodeAddition,
  prepareScanNodeAddition,
  addScanPathAddition,
  prepareScanPathAddition,
} from './connectionScanAddition';
import { prepareScanPath } from './connectionScanPath';
import { replaceScanRun } from '../../../../../Core/Workspace/ConnectionScan/updates';
import { buildGraph } from '../../../GraphState/graphEvidence';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../../../Core/Workspace/Persistence';
import { projectGraphMembership } from '../../../GraphState/graphMembership';
import type { Transaction } from '../../../../../Core/ChainData';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${id(n)}`;
const out = (n: number, vout = 0) => `out:${id(n)}:${vout}`;
const transaction = (n: number, parent?: number): Transaction => ({
  txid: id(n),
  vin: parent === undefined ? [{ coinbase: '00' }] : [{ txid: id(parent), vout: 0 }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});
function fixture() {
  const workspace = createWorkspace('Public path addition fixture', 'mainnet');
  workspace.chainData.transactions = { [id(3)]: transaction(3, 2) };
  workspace.view.graphNodeIds = [tx(3)];
  const result: ScanResult = {
    id: 'scan:1',
    kind: 'connection',
    relationship: 'direct',
    path: [tx(3), out(2)],
    endpoint: out(2),
    directions: ['upstream'],
    hops: 0,
  };
  const creatorResult: ScanResult = {
    ...result,
    id: 'scan:2',
    hops: 1,
    path: [...result.path, tx(2)],
    endpoint: tx(2),
    directions: ['upstream', 'upstream'],
  };
  const run: ScanRun = {
    id: 'scan',
    source: tx(3),
    targetIds: [out(2), tx(2)],
    startedAt: '2026-09-10T12:00:00.000Z',
    settings: { ...DEFAULT_SCAN_SETTINGS },
    status: 'complete',
    examined: 2,
    stopReasons: [],
    results: [result, creatorResult],
  };
  return { workspace, result, creatorResult, run, creator: transaction(2, 1) };
}

describe('scan path addition with terminal creator', () => {
  it('counts and adds the creator with the path, preserving saved paths and unrelated metadata', () => {
    const { workspace, result, run, creator } = fixture();
    workspace.annotations.entities[out(2)] = {
      label: 'Reviewed output',
      note: '',
      icon: '',
      bookmarked: false,
    };
    const retained = replaceScanRun(workspace, run, { [id(2)]: creator });
    const before = structuredClone(retained);
    const plan = prepareScanPathAddition(retained, result);
    expect(plan.creatorId).toBe(tx(2));
    expect(plan.nodeIds).toEqual([tx(3), out(2), tx(2)]);
    expect(plan.newNodeIds).toEqual([out(2), tx(2)]);
    expect(plan.missingTxids).toEqual([]);
    expect(plan.blockedByConflict).toBe(false);
    expect(prepareScanPath(retained, result).nodeIds).toEqual(result.path);

    const added = addScanPathAddition(retained, result);
    expect(added.view.graphNodeIds).toEqual(plan.nodeIds);
    expect(
      projectGraphMembership(buildGraph(added), added.view.graphNodeIds)
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual([...plan.nodeIds].sort());
    expect(added.chainData.transactions[id(2)]).toBe(creator);
    expect(added.annotations.entities).toBe(retained.annotations.entities);
    expect(added.connectionScans?.runs).toEqual(retained.connectionScans?.runs);
    expect(added.connectionScans?.evidence).toEqual({});
    expect(added.view.graphNodeIds).not.toContain(out(2, 1));
    expect(added.view.graphNodeIds).not.toContain(out(1));
    expect(retained).toEqual(before);
    expect(() => parseWorkspace(added)).not.toThrow();
    expect(prepareScanPathAddition(added, result).newNodeIds).toEqual([]);
  });

  it('requires missing creator proof even if the spending transaction already proves the outpoint', () => {
    const { workspace, result, creator } = fixture();
    expect(prepareScanPath(workspace, result).missingTxids).toEqual([]);
    expect(prepareScanPathAddition(workspace, result).missingTxids).toEqual([id(2)]);
    expect(() => addScanPathAddition(workspace, result)).toThrow(/missing/);
    workspace.chainData.transactions[id(2)] = creator;
    expect(prepareScanPathAddition(workspace, result).missingTxids).toEqual([]);
    expect(addScanPathAddition(workspace, result).view.graphNodeIds).toEqual([
      tx(3),
      out(2),
      tx(2),
    ]);
  });

  it('does not append a creator already in the path or alter a transaction ending', () => {
    const { workspace, result, creatorResult, creator } = fixture();
    workspace.chainData.transactions[id(2)] = creator;
    const downstream: ScanResult = {
      ...result,
      path: [tx(3), out(3)],
      endpoint: out(3),
      directions: ['downstream'],
    };
    expect(prepareScanPathAddition(workspace, downstream).creatorId).toBeUndefined();
    expect(prepareScanPathAddition(workspace, downstream).nodeIds).toEqual(downstream.path);
    expect(prepareScanPathAddition(workspace, creatorResult).creatorId).toBeUndefined();
    expect(prepareScanPathAddition(workspace, creatorResult).nodeIds).toEqual(creatorResult.path);
  });

  it('uses exactly the selected prefix and its terminal creator', () => {
    const { workspace, creatorResult, creator } = fixture();
    workspace.chainData.transactions[id(2)] = creator;
    const plan = prepareScanPathAddition(workspace, creatorResult, 2);
    expect(plan.nodeIds).toEqual([tx(3), out(2), tx(2)]);
    expect(plan.creatorId).toBe(tx(2));
    expect(addScanPathAddition(workspace, creatorResult, 1).view.graphNodeIds).toEqual([tx(3)]);
    expect(() => prepareScanPathAddition(workspace, creatorResult, 0)).toThrow(/prefix/);
  });

  it.each(['missing output', 'negative confirmations', 'conflicting prevout'] as const)(
    'blocks a creator with %s',
    (failure) => {
      const { workspace, result, creator } = fixture();
      workspace.chainData.transactions[id(2)] = creator;
      if (failure === 'missing output')
        creator.vout = creator.vout.filter((output) => output.n !== 0);
      if (failure === 'negative confirmations')
        creator.status = { kind: 'inactive', confirmations: -1 };
      if (failure === 'conflicting prevout')
        workspace.chainData.transactions[id(3)].vin[0].prevout = {
          value: 2,
          scriptPubKey: { hex: '51' },
        };
      expect(prepareScanPathAddition(workspace, result).blockedByConflict).toBe(true);
      expect(() => addScanPathAddition(workspace, result)).toThrow(/conflicts/);
      expect(workspace.view.graphNodeIds).toEqual([tx(3)]);
    },
  );

  it('blocks contradictory attached evidence outside the displayed path', () => {
    const { workspace, result, creator } = fixture();
    workspace.chainData.transactions[id(2)] = creator;
    workspace.chainData.transactions[id(4)] = {
      ...transaction(4, 2),
      vin: [{ txid: id(2), vout: 1, prevout: { value: 2, scriptPubKey: { hex: '51' } } }],
    };
    expect(prepareScanPathAddition(workspace, result).blockedByConflict).toBe(true);
    expect(() => addScanPathAddition(workspace, result)).toThrow(/conflicts/);
  });

  it('preserves original endpoint conflict findings and natural endpoint evidence checks', () => {
    const { workspace, result, creator } = fixture();
    workspace.chainData.transactions[id(2)] = creator;
    const conflict: ScanResult = {
      ...result,
      kind: 'boundary',
      relationship: undefined,
      finding: 'conflicting-evidence',
      reason: 'failure',
    };
    expect(prepareScanPathAddition(workspace, conflict).blockedByConflict).toBe(true);
    const unspendable: ScanResult = {
      ...result,
      kind: 'endpoint',
      relationship: undefined,
      finding: 'unspendable',
    };
    expect(prepareScanPathAddition(workspace, unspendable).blockedByConflict).toBe(true);
  });

  it('initializes legacy membership before merging creator proof so siblings are not added', () => {
    const { workspace, result, run, creator } = fixture();
    delete workspace.view.graphNodeIds;
    const retained = replaceScanRun(workspace, run, { [id(2)]: creator });
    const existing = new Set(buildGraph(retained).nodes.map((node) => node.id));
    const plan = prepareScanPathAddition(retained, result);
    const added = addScanPathAddition(retained, result);
    expect(added.view.graphNodeIds).toEqual([...existing, ...plan.newNodeIds]);
    expect(added.view.graphNodeIds).not.toContain(out(2, 1));
    expect(added.view.graphNodeIds).not.toContain(out(1));
  });
});

describe('selecting a scan path node', () => {
  it('loads only the clicked creator transaction without adding its outputs or the path', () => {
    const { workspace, run, creator } = fixture();
    const retained = replaceScanRun(workspace, run, { [id(2)]: creator });
    expect(prepareScanNodeAddition(retained, tx(2)).newNodeIds).toEqual([tx(2)]);
    const added = addScanNodeAddition(retained, tx(2));
    expect(added.view.graphNodeIds).toEqual([tx(3), tx(2)]);
    expect(added.chainData.transactions[id(2)]).toBe(creator);
    expect(added.connectionScans?.runs).toEqual(retained.connectionScans?.runs);
  });

  it('adds an outpoint proven by a loaded spender without adding its creator', () => {
    const { workspace } = fixture();
    expect(prepareScanNodeAddition(workspace, out(2)).missingTxids).toEqual([]);
    const added = addScanNodeAddition(workspace, out(2));
    expect(added.view.graphNodeIds).toEqual([tx(3), out(2)]);
    expect(added.chainData.transactions).toEqual(workspace.chainData.transactions);
  });

  it('rejects clicked creator proof that conflicts with another loaded spender', () => {
    const { workspace, creator } = fixture();
    workspace.chainData.transactions[id(2)] = creator;
    workspace.chainData.transactions[id(4)] = {
      ...transaction(4, 2),
      vin: [{ txid: id(2), vout: 1, prevout: { value: 2, scriptPubKey: { hex: '51' } } }],
    };
    expect(prepareScanNodeAddition(workspace, tx(2)).blockedByConflict).toBe(true);
    expect(() => addScanNodeAddition(workspace, tx(2))).toThrow(/conflicts/);
  });

  it('requires evidence for unknown nodes and rejects a nonexistent output', () => {
    const { workspace, creator } = fixture();
    expect(prepareScanNodeAddition(workspace, tx(2)).missingTxids).toEqual([id(2)]);
    expect(prepareScanNodeAddition(workspace, out(1)).missingTxids).toEqual([id(1)]);
    expect(() => addScanNodeAddition(workspace, tx(2))).toThrow(/missing/);
    workspace.chainData.transactions[id(2)] = creator;
    expect(prepareScanNodeAddition(workspace, out(2, 5)).blockedByConflict).toBe(true);
    expect(() => addScanNodeAddition(workspace, out(2, 5))).toThrow(/conflicts/);
  });
});
