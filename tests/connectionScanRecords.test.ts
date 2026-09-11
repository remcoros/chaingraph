import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS, type ScanResult, type ScanRun } from '../src/domain/connectionScan';
import {
  addScanPath,
  replaceScanRun,
  assertConnectionScanBudget,
  clearScanRuns,
  dismissScanResult,
  prepareScanPath,
} from '../src/domain/connectionScanRecords';
import { buildGraph, newWorkspace, parseWorkspace } from '../src/domain/workspace';
import { projectGraphMembership } from '../src/domain/graphMembership';
import type { Transaction, Workspace } from '../src/domain/types';
import { WorkspaceSessionStore } from '../src/lib/useWorkspaces';
import { decryptWorkspace } from '../src/lib/crypto';
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
  it('encrypts neighbour scope and frozen IDs without retaining its adjacency index', async () => {
    const { workspace, run, evidence } = fixture();
    run.settings.targetScope = 'neighbours';
    const next = replaceScanRun(workspace, run, evidence);
    const encrypted = await validateAndEncryptWorkspace(next, 'public fixture password');
    expect(JSON.stringify(encrypted)).not.toContain(run.source);
    const restored = await decryptAndValidateWorkspace(encrypted, 'public fixture password');
    expect(restored.connectionScans?.runs[0]).toEqual(run);
    expect(Object.keys(restored.connectionScans!)).toEqual(['runs', 'evidence']);
    expect(() =>
      parseWorkspace({
        ...next,
        connectionScans: { ...next.connectionScans, neighbours: { [run.source]: run.targetIds } },
      }),
    ).toThrow();
  });

  it('encrypts custom scope and expanded targets using the existing compact run record', async () => {
    const { workspace, run, evidence } = fixture();
    run.settings.targetScope = 'custom';
    run.targetIds = [tn(3), out(2), out(3), out(3, 1)];
    const next = replaceScanRun(workspace, run, evidence);
    const encrypted = await validateAndEncryptWorkspace(next, 'public fixture password');
    expect(JSON.stringify(encrypted)).not.toContain(run.source);
    const restored = await decryptAndValidateWorkspace(encrypted, 'public fixture password');
    expect(restored.connectionScans?.runs[0]).toEqual(run);
    expect(Object.keys(restored.connectionScans!)).toEqual(['runs', 'evidence']);
  });

  it('encrypts a compact round trip and restores running records without altering a save input', async () => {
    const { workspace, run, evidence } = fixture();
    run.status = 'running';
    const next = replaceScanRun(workspace, run, evidence);
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

  it('keeps prior results and their proof when starting a new scan', () => {
    const { workspace, run, evidence } = fixture();
    const saved = replaceScanRun(workspace, run, { ...evidence, [id(8)]: transaction(8) });
    const latest: ScanRun = {
      ...run,
      id: 'latest',
      source: tn(8),
      targetIds: [],
      results: [
        {
          id: 'latest:1',
          kind: 'boundary',
          endpoint: tn(8),
          path: [tn(8)],
          directions: [],
          hops: 0,
          reason: 'depth',
        },
      ],
    };
    const replaced = replaceScanRun(saved, latest, { [id(8)]: transaction(8) });
    expect(replaced.connectionScans!.runs).toEqual([run, latest]);
    expect(Object.keys(replaced.connectionScans!.evidence)).toEqual([id(2), id(3), id(8)]);
    expect(saved.connectionScans!.runs).toEqual([run]);
    expect(replaced.transactions).toBe(workspace.transactions);
    const started = replaceScanRun(replaced, {
      ...run,
      id: 'next',
      status: 'running',
      results: [],
    });
    expect(started.connectionScans!.runs.map((item) => item.id)).toEqual([
      run.id,
      latest.id,
      'next',
    ]);
    expect(started.connectionScans!.evidence).toEqual(replaced.connectionScans!.evidence);
    expect(clearScanRuns(started).connectionScans).toBeUndefined();
  });

  it('updates streaming results once and prunes only empty older scans', () => {
    const { workspace, run, result, evidence } = fixture();
    const started = replaceScanRun(workspace, { ...run, status: 'running', results: [] });
    const streaming = replaceScanRun(started, { ...run, status: 'running' }, evidence);
    const completed = replaceScanRun(streaming, run);
    expect(completed.connectionScans!.runs).toEqual([run]);
    expect(completed.connectionScans!.evidence).toEqual(evidence);
    const next = replaceScanRun(completed, { ...run, id: 'next', results: [] });
    const afterEmpty = replaceScanRun(next, { ...run, id: 'after-empty', results: [] });
    expect(afterEmpty.connectionScans!.runs.map((item) => item.id)).toEqual([
      run.id,
      'after-empty',
    ]);
    const dismissed = dismissScanResult(afterEmpty, run.id, result.id);
    expect(dismissed.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(dismissed.connectionScans!.runs.at(-1)!.id).toBe('after-empty');
    expect(dismissed.connectionScans!.evidence).toEqual(evidence);
    expect(dismissScanResult(dismissed, run.id, result.id)).toBe(dismissed);
  });

  it('rejects an additional scan at the run limit without dropping earlier findings', () => {
    const { workspace, run, evidence } = fixture();
    let saved = workspace;
    for (let index = 0; index < 20; index++) {
      const source = tn(100 + index);
      saved = replaceScanRun(
        saved,
        {
          ...run,
          id: `run-${index}`,
          source,
          targetIds: [],
          results: [
            {
              id: `result-${index}`,
              kind: 'boundary',
              endpoint: source,
              path: [source],
              directions: [],
              hops: 0,
              reason: 'unknown',
            },
          ],
        },
        { [id(100 + index)]: transaction(100 + index) },
      );
    }
    const before = saved.connectionScans;
    expect(() => replaceScanRun(saved, { ...run, id: 'overflow', results: [] })).toThrow(
      'Clear results before starting another scan',
    );
    expect(saved.connectionScans).toBe(before);
    expect(saved.connectionScans!.runs).toHaveLength(20);
    expect(
      replaceScanRun(saved, { ...saved.connectionScans!.runs[0], examined: 4 }).connectionScans!
        .runs,
    ).toHaveLength(20);
    expect(replaceScanRun(clearScanRuns(saved), run, evidence).connectionScans!.runs).toEqual([
      run,
    ]);
  });

  it('enforces proof and byte limits across accumulated scans without evicting prior results', () => {
    const { workspace, run } = fixture();
    const batch = (start: number, count: number): ScanRun => ({
      ...run,
      id: `batch-${start}`,
      targetIds: Array.from({ length: count }, (_, index) => tn(start + index)),
      results: Array.from({ length: count }, (_, index) => ({
        id: `result-${start + index}`,
        kind: 'connection',
        relationship: 'direct',
        endpoint: tn(start + index),
        path: [tn(1), out(1), tn(start + index)],
        directions: ['downstream', 'downstream'],
        hops: 1,
      })),
    });
    let saved = workspace;
    for (let start = 2; start < 202; start += 50)
      saved = replaceScanRun(
        saved,
        batch(start, 50),
        Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [
            id(start + index),
            transaction(start + index, 1),
          ]),
        ),
      );
    expect(Object.keys(saved.connectionScans!.evidence)).toHaveLength(200);
    expect(() => replaceScanRun(saved, batch(202, 1), { [id(202)]: transaction(202, 1) })).toThrow(
      '200 path transactions',
    );
    expect(saved.connectionScans!.runs).toHaveLength(4);
    const large = (index: number) => ({
      ...transaction(index, 1),
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51'.repeat(550_000) } }],
    });
    const first = replaceScanRun(workspace, batch(2, 1), { [id(2)]: large(2) });
    expect(() => replaceScanRun(first, batch(3, 1), { [id(3)]: large(3) })).toThrow('2 MiB');
    expect(first.connectionScans!.runs.map((item) => item.id)).toEqual(['batch-2']);
  });

  it('validates and restores every retained scan with its compact encrypted evidence', async () => {
    const { workspace, run, evidence } = fixture();
    const latest: ScanRun = {
      ...run,
      id: 'latest',
      status: 'running',
      source: tn(8),
      targetIds: [],
      results: [
        {
          id: 'latest:1',
          kind: 'boundary',
          endpoint: tn(8),
          path: [tn(8)],
          directions: [],
          hops: 0,
          reason: 'depth',
        },
      ],
    };
    const legacy = {
      ...workspace,
      connectionScans: { runs: [run, latest], evidence: { ...evidence, [id(8)]: transaction(8) } },
    };
    const parsed = parseWorkspace(legacy);
    expect(parsed.connectionScans!.runs).toEqual([run, { ...latest, status: 'interrupted' }]);
    expect(Object.keys(parsed.connectionScans!.evidence)).toEqual([id(2), id(3), id(8)]);
    const encrypted = await validateAndEncryptWorkspace(legacy, 'public fixture password');
    const serialized = (await decryptWorkspace(encrypted, 'public fixture password')) as Workspace;
    expect(serialized.connectionScans!.runs).toEqual([run, latest]);
    expect(Object.keys(serialized.connectionScans!.evidence)).toEqual([id(2), id(3), id(8)]);
    const restored = await decryptAndValidateWorkspace(encrypted, 'public fixture password');
    expect(restored).toEqual(parsed);
    expect(legacy.connectionScans.runs).toHaveLength(2);
    expect(legacy.connectionScans.runs[1].status).toBe('running');
    const malformed = {
      ...legacy,
      connectionScans: {
        ...legacy.connectionScans,
        runs: [{ ...run, results: [{ ...run.results[0], hops: 0 }] }, latest],
      },
    };
    expect(() => parseWorkspace(malformed)).toThrow('invalid source, endpoint or path');
  });

  it('adds an exact path or explicit prefix, reveals nodes, and preserves camera and annotations', () => {
    const { workspace, result, run, evidence } = fixture();
    workspace.annotations[out(1)] = { label: 'Public label', note: '', icon: '', bookmarked: true };
    workspace.view.hiddenNodeIds = [tn(3)];
    workspace.view.filters = { kind: 'address' };
    workspace.view.smallAmountThreshold = 500;
    const saved = replaceScanRun(workspace, run, evidence);
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
    const added = addScanPath(replaceScanRun(workspace, run, evidence), result);
    const graph = projectGraphMembership(buildGraph(added), added.view.graphNodeIds);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([...result.path].sort());
    expect(graph.links).toHaveLength(4);
    expect(() => parseWorkspace(added)).not.toThrow();
  });

  it('dismisses current results and clearing leaves graph actions intact', () => {
    const { workspace, run, result, evidence } = fixture();
    const saved = replaceScanRun(workspace, run, evidence);
    const dismissed = dismissScanResult(saved, run.id, result.id);
    expect(dismissed.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(saved.connectionScans!.runs[0].results[0].dismissed).toBeUndefined();
    expect(dismissScanResult(saved, 'past-run', result.id)).toBe(saved);
    expect(clearScanRuns(dismissed).view.graphNodeIds).toEqual(workspace.view.graphNodeIds);
    expect(clearScanRuns(dismissed).connectionScans).toBeUndefined();
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
    const saved = replaceScanRun(workspace, { ...run, results: [boundary] }, evidence);
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

  it('does not resurrect earlier results when undoing an annotation after replacement or clear', () => {
    const { workspace, run, evidence } = fixture();
    const saved = replaceScanRun(workspace, run, evidence);
    const store = new WorkspaceSessionStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    store.open(saved, 'public fixture password');
    const edit = (label: string) =>
      store.update(saved.id, (current) => ({
        ...current,
        annotations: {
          ...current.annotations,
          [run.source]: { label, note: '', icon: '', bookmarked: false },
        },
      }));
    edit('First annotation');
    store.update(
      saved.id,
      (current) => replaceScanRun(current, { ...run, id: 'latest' }, evidence),
      false,
    );
    store.undo(saved.id);
    expect(store.getSession(saved.id)!.data.connectionScans?.runs.map((item) => item.id)).toEqual([
      'latest',
    ]);
    edit('Second annotation');
    store.update(saved.id, clearScanRuns, false);
    store.undo(saved.id);
    expect(store.getSession(saved.id)!.data.connectionScans).toBeUndefined();
    expect(store.getSession(saved.id)!.data.view.graphNodeIds).toEqual(saved.view.graphNodeIds);
  });

  it('retains honest missing-evidence results but blocks adding an unverified path', () => {
    const { workspace, run, result } = fixture();
    const saved = replaceScanRun(workspace, run);
    expect(() => parseWorkspace(saved)).not.toThrow();
    expect(prepareScanPath(saved, result).missingTxids).toEqual([id(2), id(3)]);
    expect(() => addScanPath(saved, result)).toThrow('evidence is missing');
  });

  it.each([{ frontier: [] }, { visited: {} }, { transport: { url: 'private fixture' } }])(
    'rejects transient/unknown scan fields: %j',
    (extra) => {
      const { workspace, run, evidence } = fixture();
      const saved = replaceScanRun(workspace, run, evidence);
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
        replaceScanRun(
          workspace,
          { ...run, results: [{ ...result, ...patch } as ScanResult] },
          evidence,
        ),
      ).toThrow();
    expect(() =>
      replaceScanRun(workspace, run, { ...evidence, [id(3)]: transaction(3, 7) }),
    ).toThrow('not supported');
    expect(() => replaceScanRun(workspace, { ...run, examined: 201 }, evidence)).toThrow(
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
        replaceScanRun(workspace, { ...run, source: tn(2), results: [result] }, evidence),
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
        replaceScanRun(
          workspace,
          { ...run, source: tn(2), results: [descendant] },
          { ...evidence, [id(4)]: spend },
        ),
      ),
    ).not.toThrow();
  });

  it('rejects count and byte overflows with actionable errors', () => {
    const { workspace, run } = fixture();
    expect(() =>
      assertConnectionScanBudget({
        runs: Array.from({ length: 21 }, (_, n) => ({ ...run, id: `run${n}` })),
        evidence: {},
      }),
    ).toThrow('Clear results before starting another scan');
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
      replaceScanRun(workspace, {
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

describe('scan finding evidence and metadata', () => {
  function findingFixture(finding: NonNullable<ScanResult['finding']>) {
    const { workspace, run } = fixture();
    const upstream = finding === 'many-inputs' || finding === 'coinbase';
    const outpoint = ['unspent', 'unspendable', 'spend-unknown'].includes(finding);
    const natural = ['unspent', 'unspendable', 'coinbase'].includes(finding);
    const many = finding === 'many-inputs' || finding === 'many-outputs';
    if (finding === 'many-inputs')
      workspace.transactions[id(1)] = {
        ...transaction(1),
        vin: [
          { txid: id(8), vout: 0 },
          { txid: id(9), vout: 0 },
        ],
      };
    if (finding === 'unspendable') workspace.transactions[id(1)].vout[0].scriptPubKey.hex = '6a';
    const result: ScanResult = {
      id: `finding:${finding}`,
      kind: natural ? 'endpoint' : 'boundary',
      finding,
      endpoint: outpoint ? out(1) : tn(1),
      path: outpoint ? [tn(1), out(1)] : [tn(1)],
      directions: outpoint ? ['downstream'] : [],
      hops: 0,
      scanDirection: upstream ? 'upstream' : 'downstream',
      ...(natural
        ? {}
        : {
            reason: many
              ? 'fan-out'
              : ['transaction-unavailable', 'spend-unknown'].includes(finding)
                ? 'unknown'
                : 'failure',
          }),
      ...(many ? { branchCount: 2 } : {}),
      ...(finding === 'unspent'
        ? { checkedAt: '2026-09-10T12:00:01.000Z', bestBlock: id(99), includesMempool: true }
        : {}),
      ...(finding === 'lookup-failed' ? { issueCode: 'timeout' } : {}),
    };
    return {
      workspace,
      result,
      run: { ...run, targetIds: [], settings: { ...run.settings, fanOut: 2 }, results: [result] },
    };
  }

  it.each([
    'many-inputs',
    'many-outputs',
    'unspent',
    'coinbase',
    'unspendable',
    'transaction-unavailable',
    'spend-unknown',
    'lookup-failed',
    'conflicting-evidence',
  ] as const)('validates %s with its required observed proof', (finding) => {
    const { workspace, run, result } = findingFixture(finding);
    const saved = replaceScanRun(workspace, run);
    expect(parseWorkspace(saved).connectionScans!.runs[0].results[0]).toEqual(result);
  });

  it('round trips timestamped unspent observations without treating them as current spend status', async () => {
    const { workspace, run, result } = findingFixture('unspent');
    workspace.transactions[id(2)] = transaction(2, 1);
    const saved = replaceScanRun(workspace, run);
    const restored = await decryptAndValidateWorkspace(
      await validateAndEncryptWorkspace(saved, 'public fixture password'),
      'public fixture password',
    );
    expect(restored.connectionScans!.runs[0].results[0]).toEqual(result);
  });

  it('rejects forged natural endpoints, branch counts and metadata combinations', () => {
    for (const finding of ['coinbase', 'unspendable', 'many-inputs', 'many-outputs'] as const) {
      const { workspace, run, result } = findingFixture(finding);
      if (finding === 'coinbase') workspace.transactions[id(1)] = transaction(1, 8);
      if (finding === 'unspendable') workspace.transactions[id(1)].vout[0].scriptPubKey.hex = '51';
      if (finding.startsWith('many-')) result.branchCount = 3;
      expect(() => replaceScanRun(workspace, run)).toThrow('not supported');
    }
    const invalidCoinbase = findingFixture('coinbase');
    invalidCoinbase.workspace.transactions[id(1)].vin[0].coinbase = 'not script bytes';
    expect(() => replaceScanRun(invalidCoinbase.workspace, invalidCoinbase.run)).toThrow(
      'not supported',
    );
    const { workspace, run, result } = findingFixture('unspent');
    for (const patch of [
      { checkedAt: undefined },
      { bestBlock: undefined },
      { includesMempool: false },
      { scanDirection: 'upstream' },
      { kind: 'boundary' },
      { reason: 'unknown' },
      { branchCount: 5 },
      { issueCode: 'timeout' },
      { bestBlock: 'invalid' },
      { checkedAt: 'not a date' },
    ]) {
      expect(() =>
        replaceScanRun(workspace, { ...run, results: [{ ...result, ...patch } as ScanResult] }),
      ).toThrow();
    }
    const many = findingFixture('many-outputs');
    expect(() =>
      replaceScanRun(many.workspace, {
        ...many.run,
        results: [{ ...many.result, branchCount: undefined }],
      }),
    ).toThrow('branch count');
    const legacy = fixture();
    expect(() =>
      replaceScanRun(
        legacy.workspace,
        { ...legacy.run, results: [{ ...legacy.result, checkedAt: '2026-09-10T12:00:00.000Z' }] },
        legacy.evidence,
      ),
    ).toThrow('finding type');
  });

  it('checks the exact shared meeting node while retaining legacy paths without this metadata', () => {
    const { workspace, run } = fixture();
    workspace.transactions = { [id(2)]: transaction(2, 1), [id(3)]: transaction(3, 1) };
    const result: ScanResult = {
      id: 'shared',
      kind: 'connection',
      relationship: 'shared-ancestor',
      endpoint: tn(3),
      path: [tn(2), out(1), tn(3)],
      directions: ['upstream', 'downstream'],
      hops: 1,
      scanDirection: 'upstream',
      meetingNode: out(1),
    };
    const shared = { ...run, source: tn(2), results: [result] };
    expect(() => replaceScanRun(workspace, shared)).not.toThrow();
    expect(() =>
      replaceScanRun(workspace, { ...shared, results: [{ ...result, meetingNode: tn(3) }] }),
    ).toThrow('meeting node');
    expect(() =>
      replaceScanRun(workspace, {
        ...shared,
        results: [{ ...result, scanDirection: 'downstream' }],
      }),
    ).toThrow('direction');
  });

  it('blocks contradictory selected edges and full conflicting findings, but accepts verified prefixes', () => {
    const { workspace, run, result, evidence } = fixture();
    const conflict: ScanResult = {
      ...result,
      kind: 'boundary',
      relationship: undefined,
      finding: 'conflicting-evidence',
      reason: 'failure',
      scanDirection: 'downstream',
    };
    const saved = replaceScanRun(workspace, { ...run, results: [conflict] }, evidence);
    expect(prepareScanPath(saved, conflict).blockedByConflict).toBe(true);
    expect(() => addScanPath(saved, conflict)).toThrow('conflicts');
    expect(prepareScanPath(saved, conflict, 4).blockedByConflict).toBe(false);
    expect(addScanPath(saved, conflict, 4).view.graphNodeIds).toContain(out(2));
    const changed = {
      ...saved,
      transactions: { ...saved.transactions, [id(3)]: transaction(3, 8) },
    };
    expect(prepareScanPath(changed, result).blockedByConflict).toBe(true);
    expect(() => addScanPath(changed, result)).toThrow('conflicts');
    expect(prepareScanPath(changed, result, 3).blockedByConflict).toBe(false);
    const stale = {
      ...saved,
      transactions: { ...saved.transactions, [id(2)]: { ...evidence[id(2)], confirmations: -1 } },
    };
    expect(prepareScanPath(stale, result).blockedByConflict).toBe(true);
    expect(() => addScanPath(stale, result)).toThrow('conflicts');
    expect(prepareScanPath(stale, result, 2).blockedByConflict).toBe(false);
    const malformed = { ...result, directions: [] };
    expect(prepareScanPath(saved, malformed).blockedByConflict).toBe(true);
    expect(() => addScanPath(saved, malformed)).toThrow('conflicts');
    const singleton = findingFixture('conflicting-evidence');
    expect(prepareScanPath(singleton.workspace, singleton.result).blockedByConflict).toBe(true);
  });

  it('retains only an explicitly disputed terminal edge and adds only a consistent prefix', () => {
    const { workspace, run } = fixture();
    workspace.transactions = { [id(1)]: transaction(1), [id(3)]: transaction(3, 2) };
    workspace.view.graphNodeIds = [tn(3)];
    const disputed = { ...transaction(2), vin: [{ txid: id(1), vout: 3 }] };
    const result: ScanResult = {
      id: 'terminal-conflict',
      kind: 'boundary',
      finding: 'conflicting-evidence',
      reason: 'failure',
      scanDirection: 'upstream',
      endpoint: out(1, 3),
      path: [tn(3), out(2), tn(2), out(1, 3)],
      directions: ['upstream', 'upstream', 'upstream'],
      hops: 1,
    };
    const saved = replaceScanRun(
      workspace,
      { ...run, source: tn(3), targetIds: [], results: [result] },
      { [id(2)]: disputed },
    );
    expect(() => parseWorkspace(saved)).not.toThrow();
    expect(prepareScanPath(saved, result).blockedByConflict).toBe(true);
    expect(() => addScanPath(saved, result)).toThrow('conflicts');
    // The preceding transaction also has a disputed input, so keep the prefix
    // before that transaction rather than introducing invalid observations.
    expect(prepareScanPath(saved, result, 3).blockedByConflict).toBe(true);
    expect(prepareScanPath(saved, result, 2).blockedByConflict).toBe(false);
    const added = addScanPath(saved, result, 2);
    expect(added.transactions[id(2)]).toBeUndefined();
    expect(added.view.graphNodeIds).toEqual([tn(3), out(2)]);
    expect(() => parseWorkspace(added)).not.toThrow();
    const interior: ScanResult = {
      ...result,
      endpoint: tn(1),
      path: [...result.path, tn(1)],
      directions: [...result.directions, 'upstream'],
      hops: 2,
    };
    expect(() =>
      replaceScanRun(
        workspace,
        { ...run, source: tn(3), targetIds: [], results: [interior] },
        { [id(2)]: disputed },
      ),
    ).toThrow('not supported');
    const ordinary: ScanResult = { ...result, finding: 'lookup-failed' };
    expect(() =>
      replaceScanRun(
        workspace,
        { ...run, source: tn(3), targetIds: [], results: [ordinary] },
        { [id(2)]: disputed },
      ),
    ).toThrow('not supported');
  });

  it('requires creator proof for an unspent outpoint even when a spender represents that output', () => {
    const { workspace, run, result } = findingFixture('unspent');
    workspace.transactions = { [id(2)]: transaction(2, 1) };
    const endpoint = { ...result, path: [out(1)], directions: [], endpoint: out(1) };
    const saved = replaceScanRun(workspace, { ...run, source: out(1), results: [endpoint] });
    expect(prepareScanPath(saved, endpoint).missingTxids).toEqual([id(1)]);
    expect(() => addScanPath(saved, endpoint)).toThrow('missing');
    const proven = replaceScanRun(
      saved,
      { ...run, source: out(1), results: [endpoint] },
      { [id(1)]: transaction(1) },
    );
    expect(Object.keys(proven.connectionScans!.evidence)).toEqual([id(1)]);
    expect(prepareScanPath(proven, endpoint).missingTxids).toEqual([]);
  });

  it('allows rechecks to recategorize an eleventh endpoint within the global result cap', () => {
    const { workspace, run, result } = findingFixture('unspent');
    workspace.transactions[id(1)].vout = Array.from({ length: 51 }, (_, n) => ({
      n,
      value: 1,
      scriptPubKey: { hex: '51' },
    }));
    const endpoints = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...result,
        id: `endpoint:${i}`,
        endpoint: out(1, i),
        path: [tn(1), out(1, i)],
      }));
    const rechecked = replaceScanRun(workspace, {
      ...run,
      results: endpoints(11),
    });
    expect(parseWorkspace(rechecked).connectionScans!.runs[0].results).toHaveLength(11);
    expect(() =>
      replaceScanRun(workspace, {
        ...run,
        results: endpoints(51),
      }),
    ).toThrow();
    const saved = replaceScanRun(workspace, {
      ...run,
      omittedResults: { endpoints: 4, issues: 2 },
      stopReasons: ['backend-unavailable', 'rate-limited', 'offline'],
    });
    expect(parseWorkspace(saved).connectionScans!.runs[0].omittedResults).toEqual({
      endpoints: 4,
      issues: 2,
    });
    expect(() =>
      replaceScanRun(workspace, { ...run, omittedResults: { endpoints: -1, issues: 0 } }),
    ).toThrow();
    expect(() => replaceScanRun(workspace, { ...run, stopReasons: ['time', 'time'] })).toThrow();
  });
});
