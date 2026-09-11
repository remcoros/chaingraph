import {
  validateAndEncryptWorkspace,
  decryptAndValidateWorkspace,
} from '../src/lib/workspaceEncryption';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  SCAN_LIMITS,
  type ScanResult,
  type ScanRun,
} from '../src/domain/connectionScan';
import { addScanPathAddition, prepareScanPathAddition } from '../src/domain/connectionScanAddition';
import {
  prepareScanPath,
  replaceScanRun,
  scanResultEvidenceIds,
} from '../src/domain/connectionScanRecords';
import { newWorkspace, parseWorkspace } from '../src/domain/workspace';
import type { Transaction } from '../src/domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${id(n)}`;
const out = (n: number) => `out:${id(n)}:0`;
const transaction = (n: number, parents: number[] = []): Transaction => ({
  txid: id(n),
  vin: parents.length
    ? parents.map((parent) => ({ txid: id(parent), vout: 0 }))
    : [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});
function fixture() {
  const workspace = newWorkspace('Public cycle fixture', 'mainnet');
  workspace.transactions = { [id(3)]: transaction(3, [4, 5]) };
  workspace.view.graphNodeIds = [tx(3)];
  const result: ScanResult = {
    id: 'scan:1',
    kind: 'connection',
    relationship: 'direct',
    path: [tx(3), out(4), tx(4), out(2), tx(2)],
    endpoint: tx(2),
    directions: ['upstream', 'upstream', 'upstream', 'upstream'],
    hops: 2,
    context: {
      path: [tx(3), out(5), tx(5), out(2), tx(2)],
      directions: ['upstream', 'upstream', 'upstream', 'upstream'],
    },
  };
  const run: ScanRun = {
    id: 'scan',
    source: tx(3),
    targetIds: [tx(2)],
    settings: DEFAULT_SCAN_SETTINGS,
    startedAt: '2026-09-10T12:00:00.000Z',
    status: 'complete',
    examined: 4,
    stopReasons: [],
    results: [result],
  };
  const evidence = {
    [id(2)]: transaction(2),
    [id(4)]: transaction(4, [2]),
    [id(5)]: transaction(5, [2]),
  };
  return { workspace, result, run, evidence };
}

describe('bounded scan context proof', () => {
  it('retains and round trips proof for both routes without any explored search state', () => {
    const { workspace, result, run, evidence } = fixture();
    const retained = replaceScanRun(workspace, run, evidence);
    expect([...scanResultEvidenceIds(result)].sort()).toEqual([id(2), id(3), id(4), id(5)].sort());
    expect(retained.connectionScans?.evidence).toEqual(evidence);
    expect(parseWorkspace(retained).connectionScans).toEqual(retained.connectionScans);
    expect(Object.keys(retained.connectionScans!)).toEqual(['runs', 'evidence']);
  });

  it('encrypts both routes and restores a complete actionable loop', async () => {
    const { workspace, result, run, evidence } = fixture();
    const retained = replaceScanRun(workspace, run, evidence);
    const encrypted = await validateAndEncryptWorkspace(retained, 'public fixture password');
    expect(JSON.stringify(encrypted)).not.toContain(result.context!.path[1]);
    const restored = await decryptAndValidateWorkspace(encrypted, 'public fixture password');
    expect(restored.connectionScans).toEqual(retained.connectionScans);
    const restoredResult = restored.connectionScans!.runs[0].results[0];
    expect(new Set(addScanPathAddition(restored, restoredResult).view.graphNodeIds)).toEqual(
      new Set([...result.path, ...result.context!.path]),
    );
  });

  it('round trips a bridge marker only for connections without a known route', () => {
    const { workspace, result, run, evidence } = fixture();
    result.context = undefined;
    result.bridge = true;
    const retained = replaceScanRun(workspace, run, evidence);
    expect(parseWorkspace(retained).connectionScans?.runs[0].results[0].bridge).toBe(true);
    expect(retained.connectionScans?.evidence[id(5)]).toBeUndefined();
  });

  it.each(['context', 'boundary', 'false'])('rejects invalid bridge marker: %s', (issue) => {
    const { workspace, result, run, evidence } = fixture();
    result.bridge = true;
    if (issue !== 'context') result.context = undefined;
    if (issue === 'boundary') {
      result.kind = 'boundary';
      result.relationship = undefined;
      result.reason = 'unknown';
    }
    if (issue === 'false') Object.assign(result, { bridge: false });
    expect(() => replaceScanRun(workspace, run, evidence)).toThrow();
  });

  it('adds the union once, with matching counts and no sibling outputs', () => {
    const { workspace, result, run, evidence } = fixture();
    const retained = replaceScanRun(workspace, run, evidence);
    const before = structuredClone(retained);
    const plan = prepareScanPathAddition(retained, result);
    expect(plan.blockedByConflict).toBe(false);
    expect(plan.missingTxids).toEqual([]);
    expect(plan.newNodeIds).toHaveLength(6);
    const added = addScanPathAddition(retained, result);
    expect(added.view.graphNodeIds).toEqual(plan.nodeIds);
    expect(added.transactions).toEqual({ ...workspace.transactions, ...evidence });
    expect(added.connectionScans?.runs).toEqual(retained.connectionScans?.runs);
    expect(added.connectionScans?.evidence).toEqual({});
    expect(prepareScanPathAddition(added, result).newNodeIds).toEqual([]);
    expect(added.view.graphNodeIds).not.toContain(`out:${id(5)}:1`);
    expect(retained).toEqual(before);
  });

  it('requires missing context proof for full Add while a partial prefix excludes it', () => {
    const { workspace, result, run, evidence } = fixture();
    const retained = replaceScanRun(workspace, run, {
      [id(2)]: evidence[id(2)],
      [id(4)]: evidence[id(4)],
    });
    expect(prepareScanPath(retained, result).missingTxids).toEqual([]);
    expect(prepareScanPathAddition(retained, result).missingTxids).toEqual([id(5)]);
    expect(() => addScanPathAddition(retained, result)).toThrow(/missing/);
    expect(prepareScanPathAddition(retained, result, 3).missingTxids).toEqual([]);
    const prefix = addScanPathAddition(retained, result, 3);
    expect(prefix.view.graphNodeIds).toEqual([tx(3), out(4), tx(4)]);
    expect(prefix.transactions[id(5)]).toBeUndefined();
  });

  it.each([
    'endpoint',
    'source',
    'duplicate',
    'directions',
    'same route',
    'nonconnection',
    'too many hops',
  ])('rejects invalid context: %s', (issue) => {
    const { workspace, result, run, evidence } = fixture();
    if (issue === 'endpoint') result.context!.path[4] = tx(8);
    if (issue === 'source') result.context!.path[0] = tx(8);
    if (issue === 'duplicate') result.context!.path[2] = tx(3);
    if (issue === 'directions') result.context!.directions.pop();
    if (issue === 'same route')
      result.context = { path: result.path, directions: result.directions };
    if (issue === 'nonconnection') {
      result.kind = 'boundary';
      result.reason = 'unknown';
      result.relationship = undefined;
    }
    if (issue === 'too many hops') {
      result.context = {
        path: [
          tx(3),
          ...Array.from({ length: SCAN_LIMITS.maxHops + 1 }, (_, i) => [
            out(i + 10),
            tx(i + 10),
          ]).flat(),
          out(2),
          tx(2),
        ],
        directions: Array(2 * (SCAN_LIMITS.maxHops + 2)).fill('upstream'),
      };
    }
    expect(() => replaceScanRun(workspace, run, evidence)).toThrow();
    expect(prepareScanPathAddition(workspace, result).blockedByConflict).toBe(true);
  });

  it('rejects newly loaded context proof contradicting a spender outside both routes', () => {
    const { workspace, result, run, evidence } = fixture();
    workspace.transactions[id(6)] = {
      ...transaction(6),
      vin: [{ txid: id(5), vout: 1, prevout: { value: 2, scriptPubKey: { hex: '51' } } }],
    };
    const retained = replaceScanRun(workspace, run, {
      [id(2)]: evidence[id(2)],
      [id(4)]: evidence[id(4)],
    });
    const loaded = { ...retained, connectionScans: { ...retained.connectionScans!, evidence } };
    expect(prepareScanPathAddition(loaded, result).blockedByConflict).toBe(true);
    expect(() => addScanPathAddition(loaded, result)).toThrow(/conflicts/);
  });

  it.each(['wrong edge', 'negative confirmations', 'prevout conflict'])(
    'rejects unsupported context: %s',
    (issue) => {
      const { workspace, result, run, evidence } = fixture();
      if (issue === 'wrong edge') evidence[id(5)].vin = [{ txid: id(8), vout: 0 }];
      if (issue === 'negative confirmations') evidence[id(5)].confirmations = -1;
      if (issue === 'prevout conflict')
        evidence[id(5)].vin[0].prevout = { value: 2, scriptPubKey: { hex: '51' } };
      expect(() => replaceScanRun(workspace, run, evidence)).toThrow();
      const supplied = { ...workspace, connectionScans: { runs: [run], evidence } };
      expect(prepareScanPathAddition(supplied, result).blockedByConflict).toBe(true);
      expect(() => addScanPathAddition(supplied, result)).toThrow(/conflicts/);
    },
  );
});
