import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS, type ScanResult, type ScanRun } from '../src/domain/connectionScan';
import {
  addScanPath,
  appendScanRun,
  assertConnectionScanBudget,
  clearScanRuns,
  dismissScanResult,
  prepareScanPath,
  removeScanRun,
} from '../src/domain/connectionScanRecords';
import { buildGraph, newWorkspace, parseWorkspace } from '../src/domain/workspace';
import { projectGraphMembership } from '../src/domain/graphMembership';
import type { Transaction } from '../src/domain/types';
import { WorkspaceSessionStore } from '../src/lib/useWorkspaces';
import {
  validateAndEncryptWorkspace,
  decryptAndValidateWorkspace,
} from '../src/lib/workspaceEncryption';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tn = (n: number) => `tx:${id(n)}`;
const out = (n: number, vout = 0) => `out:${id(n)}:${vout}`;
const transaction = (n: number, parent?: number): Transaction => ({
  txid: id(n),
  vin: parent === undefined ? [{ coinbase: '00' }] : [{ txid: id(parent), vout: 0 }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});
function fixture() {
  const workspace = newWorkspace('Public scan fixture', 'mainnet');
  workspace.transactions = { [id(1)]: transaction(1) };
  workspace.view.graphNodeIds = [tn(1), tn(3)];
  const result: ScanResult = {
    id: 'run:1',
    kind: 'connection',
    relationship: 'direct',
    endpoint: tn(3),
    path: [tn(1), out(1), tn(2), out(2), tn(3)],
    directions: ['downstream', 'downstream', 'downstream', 'downstream'],
    hops: 2,
  };
  const run: ScanRun = {
    id: 'run',
    source: tn(1),
    targetIds: [tn(3)],
    settings: { ...DEFAULT_SCAN_SETTINGS },
    startedAt: '2026-09-10T12:00:00.000Z',
    status: 'complete',
    examined: 3,
    stopReasons: [],
    results: [result],
  };
  const evidence = { [id(2)]: transaction(2, 1), [id(3)]: transaction(3, 2) };
  return { workspace, result, run, evidence };
}

describe('compact connection scan records', () => {
  it('encrypts a compact round trip and restores running records without altering a save input', async () => {
    const { workspace, run, evidence } = fixture();
    run.status = 'running';
    const next = appendScanRun(workspace, run, evidence);
    next.view.rightTab = 'scan';
    const encrypted = await validateAndEncryptWorkspace(next, 'public fixture password');
    expect(JSON.stringify(encrypted)).not.toContain(run.source);
    const restored = await decryptAndValidateWorkspace(encrypted, 'public fixture password');
    expect(restored.connectionScans?.runs[0].status).toBe('interrupted');
    expect(restored.view.rightTab).toBe('scan');
    expect(next.connectionScans?.runs[0].status).toBe('running');
    expect(restored.connectionScans?.evidence).toEqual(evidence);
    expect(restored.transactions).toEqual(workspace.transactions);
  });

  it('shares only supporting evidence across runs, and drops unrelated exploration', () => {
    const { workspace, run, evidence } = fixture();
    const saved = appendScanRun(workspace, run, { ...evidence, [id(8)]: transaction(8) });
    const twice = appendScanRun(saved, { ...run, id: 'second' }, evidence);
    expect(Object.keys(twice.connectionScans!.evidence)).toEqual([id(2), id(3)]);
    expect(removeScanRun(twice, run.id).connectionScans!.evidence).toEqual(evidence);
    expect(removeScanRun(saved, run.id).connectionScans).toBeUndefined();
  });

  it('adds an exact path or explicit prefix, reveals nodes, and preserves camera and annotations', () => {
    const { workspace, result, run, evidence } = fixture();
    workspace.annotations[out(1)] = { label: 'Public label', note: '', icon: '', bookmarked: true };
    workspace.view.hiddenNodeIds = [tn(3)];
    workspace.view.filters = { kind: 'address' };
    workspace.view.smallAmountThreshold = 500;
    const saved = appendScanRun(workspace, run, evidence);
    expect(prepareScanPath(saved, result).newNodeIds).toEqual([out(1), tn(2), out(2)]);
    const prefix = addScanPath(saved, result, 3);
    expect(prefix.view.graphNodeIds).toEqual([tn(1), tn(3), out(1), tn(2)]);
    expect(prefix.transactions[id(3)]).toBeUndefined();
    expect(prefix.transactions[id(2)]).toEqual(evidence[id(2)]);
    const added = addScanPath(saved, result);
    expect(added.view.hiddenNodeIds).toBeUndefined();
    expect(added.view.filters).toBeUndefined();
    expect(added.view.smallAmountThreshold).toBe(0);
    expect(added.annotations).toBe(workspace.annotations);
    expect(added.view.graphSnapshot).toBe(workspace.view.graphSnapshot);
    expect(added.view.graphNodeIds).not.toContain(out(1, 1));
    expect(added.view.graphNodeIds).not.toContain(out(2, 1));
    expect(added.connectionScans!.evidence).toEqual({});
    expect(clearScanRuns(added).transactions).toBe(added.transactions);
    expect(clearScanRuns(added).annotations).toBe(added.annotations);
    expect(clearScanRuns(added).view).toBe(added.view);
    expect(() => prepareScanPath(saved, result, 0)).toThrow('explicit');
    expect(() => prepareScanPath(saved, result, 6)).toThrow('explicit');
  });

  it('promotes scoped evidence so accepted edges are actually rendered without adding siblings', () => {
    const { workspace, result, run, evidence } = fixture();
    workspace.inputContext = { [id(1)]: [1] };
    const added = addScanPath(appendScanRun(workspace, run, evidence), result);
    const graph = projectGraphMembership(buildGraph(added), added.view.graphNodeIds);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([...result.path].sort());
    expect(graph.links).toHaveLength(4);
    expect(() => parseWorkspace(added)).not.toThrow();
  });

  it('keeps dismissal local to its run and clearing independent from graph actions', () => {
    const { workspace, run, result, evidence } = fixture();
    const saved = appendScanRun(appendScanRun(workspace, run, evidence), { ...run, id: 'second' });
    const dismissed = dismissScanResult(saved, run.id, result.id);
    expect(dismissed.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(dismissed.connectionScans!.runs[1].results[0].dismissed).toBeUndefined();
    expect(clearScanRuns(dismissed).view.graphNodeIds).toEqual(workspace.view.graphNodeIds);
  });

  it('adds a boundary path in one undo action and preserves later presentation changes', () => {
    const { workspace, run, result, evidence } = fixture();
    const boundary: ScanResult = {
      ...result,
      kind: 'boundary',
      relationship: undefined,
      reason: 'fan-out',
      endpoint: tn(2),
      path: result.path.slice(0, 3),
      directions: result.directions.slice(0, 2),
      hops: 1,
    };
    const saved = appendScanRun(workspace, { ...run, results: [boundary] }, evidence);
    const store = new WorkspaceSessionStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    store.open(saved, 'public fixture password');
    store.update(saved.id, (current) => addScanPath(current, boundary));
    expect(store.getSession(saved.id)!.history).toHaveLength(1);
    store.update(
      saved.id,
      (current) => ({ ...current, view: { ...current.view, glow: false } }),
      false,
    );
    store.undo(saved.id);
    const restored = store.getSession(saved.id)!.data;
    expect(restored.transactions).toEqual(saved.transactions);
    expect(restored.view.graphNodeIds).toEqual(saved.view.graphNodeIds);
    expect(restored.view.glow).toBe(false);
    expect(restored.connectionScans).toEqual(saved.connectionScans);
    expect(() => parseWorkspace(restored)).not.toThrow();
  });

  it('retains honest missing-evidence results but blocks adding an unverified path', () => {
    const { workspace, run, result } = fixture();
    const saved = appendScanRun(workspace, run);
    expect(() => parseWorkspace(saved)).not.toThrow();
    expect(prepareScanPath(saved, result).missingTxids).toEqual([id(2), id(3)]);
    expect(() => addScanPath(saved, result)).toThrow('evidence is missing');
  });

  it.each([{ frontier: [] }, { visited: {} }, { transport: { url: 'private fixture' } }])(
    'rejects transient/unknown scan fields: %j',
    (extra) => {
      const { workspace, run, evidence } = fixture();
      const saved = appendScanRun(workspace, run, evidence);
      expect(() =>
        parseWorkspace({ ...saved, connectionScans: { ...saved.connectionScans, ...extra } }),
      ).toThrow();
      expect(() =>
        parseWorkspace({
          ...saved,
          connectionScans: { ...saved.connectionScans, runs: [{ ...run, ...extra }] },
        }),
      ).toThrow();
    },
  );

  it('rejects forged path directions, relationships, endpoints, hops, and observation mismatches', () => {
    const { workspace, run, result, evidence } = fixture();
    for (const patch of [
      { directions: ['upstream', 'downstream', 'downstream', 'downstream'] },
      { relationship: 'shared-ancestor' },
      { endpoint: tn(4) },
      { hops: 0 },
      { kind: 'boundary' },
      { path: [tn(1), out(1), tn(1)] },
    ])
      expect(() =>
        appendScanRun(
          workspace,
          { ...run, results: [{ ...result, ...patch } as ScanResult] },
          evidence,
        ),
      ).toThrow();
    expect(() =>
      appendScanRun(workspace, run, { ...evidence, [id(3)]: transaction(3, 7) }),
    ).toThrow('not supported');
    expect(() => appendScanRun(workspace, { ...run, examined: 201 }, evidence)).toThrow(
      'transaction count',
    );
  });

  it('accepts exact shared-ancestor and shared-descendant evidence', () => {
    const { workspace, run } = fixture();
    workspace.transactions = {};
    const evidence = {
      [id(1)]: transaction(1),
      [id(2)]: transaction(2, 1),
      [id(3)]: transaction(3, 1),
    };
    const result: ScanResult = {
      id: 'shared',
      kind: 'connection',
      relationship: 'shared-ancestor',
      endpoint: tn(3),
      path: [tn(2), out(1), tn(3)],
      directions: ['upstream', 'downstream'],
      hops: 1,
    };
    expect(() =>
      parseWorkspace(
        appendScanRun(workspace, { ...run, source: tn(2), results: [result] }, evidence),
      ),
    ).not.toThrow();
    const spend = {
      ...transaction(4),
      vin: [
        { txid: id(2), vout: 0 },
        { txid: id(3), vout: 0 },
      ],
    };
    const descendant: ScanResult = {
      ...result,
      relationship: 'shared-descendant',
      path: [tn(2), out(2), tn(4), out(3), tn(3)],
      directions: ['downstream', 'downstream', 'upstream', 'upstream'],
      hops: 2,
    };
    expect(() =>
      parseWorkspace(
        appendScanRun(
          workspace,
          { ...run, source: tn(2), results: [descendant] },
          { ...evidence, [id(4)]: spend },
        ),
      ),
    ).not.toThrow();
  });

  it('rejects count and byte overflows with actionable errors', () => {
    const { workspace, run } = fixture();
    let saved = workspace;
    for (let n = 0; n < 20; n++) saved = appendScanRun(saved, { ...run, id: `run${n}` });
    expect(() => appendScanRun(saved, { ...run, id: 'overflow' })).toThrow('20 runs');
    expect(() =>
      assertConnectionScanBudget({
        runs: [],
        evidence: Object.fromEntries(Array.from({ length: 201 }, (_, n) => [id(n), {}])),
      }),
    ).toThrow('200 path transactions');
    expect(() =>
      assertConnectionScanBudget({ runs: [], evidence: { data: 'x'.repeat(2 * 1024 * 1024) } }),
    ).toThrow('2 MiB');
    expect(() =>
      appendScanRun(workspace, {
        ...run,
        results: Array.from({ length: 51 }, (_, n) => ({ ...run.results[0], id: String(n) })),
      }),
    ).toThrow();
  });

  it('migrates v2 without reseeding intentionally empty canvas membership', () => {
    const { workspace } = fixture();
    const legacy = { ...workspace, version: 2, view: { ...workspace.view, graphNodeIds: [] } };
    const parsed = parseWorkspace(legacy);
    expect(parsed.version).toBe(3);
    expect(parsed.connectionScans).toBeUndefined();
    expect(parsed.view.graphNodeIds).toEqual([]);
    expect(legacy.version).toBe(2);
    expect(() =>
      parseWorkspace({ ...legacy, view: { ...legacy.view, graphNodeIds: undefined } }),
    ).toThrow('missing explicit');
  });
});
