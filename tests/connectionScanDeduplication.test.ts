import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanResult,
  type ScanRun,
} from '../src/Domain/ConnectionScan/connectionScan';
import {
  groupScanRuns,
  mergeScanRunSnapshots,
} from '../src/Domain/ConnectionScan/connectionScanGroups';
import {
  clearScanRuns,
  dismissScanResult,
  replaceScanRun,
} from '../src/Domain/ConnectionScan/connectionScanRecords';
import type { Transaction } from '../src/Domain/types';
import { newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';

const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${id(n)}`;
const out = (n: number, index = 0) => `out:${id(n)}:${index}`;
const transaction = (n: number, parents: [number, number][] = []): Transaction => ({
  txid: id(n),
  vin: parents.length
    ? parents.map(([parent, vout]) => ({ txid: id(parent), vout }))
    : [{ coinbase: '00' }],
  vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
});

function fixture() {
  const workspace = newWorkspace('Public scan rerun fixture', 'mainnet');
  workspace.transactions = { [id(1)]: transaction(1) };
  workspace.view.graphNodeIds = [tx(1), tx(3)];
  const result: ScanResult = {
    id: 'first:1',
    kind: 'connection',
    relationship: 'direct',
    endpoint: tx(3),
    path: [tx(1), out(1), tx(2), out(2), tx(3)],
    directions: ['downstream', 'downstream', 'downstream', 'downstream'],
    hops: 2,
  };
  const alternative: ScanResult = {
    ...result,
    id: 'first:2',
    path: [tx(1), out(1, 1), tx(4), out(4), tx(3)],
  };
  const run: ScanRun = {
    id: 'first',
    source: tx(1),
    targetIds: [tx(3)],
    settings: { ...DEFAULT_SCAN_SETTINGS },
    startedAt: '2026-09-10T12:00:00.000Z',
    status: 'complete',
    examined: 4,
    stopReasons: [],
    results: [result],
  };
  const evidence = {
    [id(2)]: transaction(2, [[1, 0]]),
    [id(3)]: transaction(3, [
      [2, 0],
      [4, 0],
    ]),
    [id(4)]: transaction(4, [[1, 1]]),
  };
  return { workspace, run, result, alternative, evidence };
}

const rerun = (run: ScanRun, name = 'repeat'): ScanRun => ({
  ...run,
  id: name,
  startedAt: '2026-09-10T12:01:00.000Z',
  settings: { ...run.settings, maxHops: 7, maxTransactions: 1000 },
  results: run.results.map((result, index) => ({ ...result, id: `${name}:${index}` })),
});

describe('connection scan rerun deduplication', () => {
  it('shows one copy during streaming and after completion, regardless of new scan IDs or settings', () => {
    const { run } = fixture();
    const next = rerun(run);
    const started = mergeScanRunSnapshots([run], [{ ...next, status: 'running', results: [] }]);
    expect(groupScanRuns(started)).toHaveLength(1);
    expect(started.at(-1)!.status).toBe('running');

    const streamed = mergeScanRunSnapshots(started, [{ ...next, status: 'running' }]);
    expect(groupScanRuns(streamed)).toHaveLength(1);
    expect(groupScanRuns(streamed)[0].results).toEqual(next.results);
    expect(streamed.map((item) => item.id)).toEqual([next.id]);
    expect(groupScanRuns([run, next])).toHaveLength(1);

    const completed = mergeScanRunSnapshots(streamed, [next]);
    expect(completed).toEqual([next]);
    expect(run.results[0].id).toBe('first:1');
  });

  it('keeps unmatched older paths when a rerun stops before rediscovering them', () => {
    const { run, result, alternative } = fixture();
    const original = { ...run, results: [result, alternative] };
    const cancelled = {
      ...rerun(run),
      status: 'cancelled' as const,
      stopReasons: ['cancelled' as const],
    };
    const merged = mergeScanRunSnapshots([original], [cancelled]);
    expect(merged.map((item) => item.results.map((finding) => finding.path))).toEqual([
      [alternative.path],
      [result.path],
    ]);
    expect(merged.at(-1)!.status).toBe('cancelled');
    expect(groupScanRuns(merged).flatMap((group) => group.results)).toHaveLength(2);
  });

  it.each([
    ['source', (run: ScanRun) => ({ ...run, source: tx(8) })],
    [
      'path',
      (run: ScanRun) => ({
        ...run,
        results: [{ ...run.results[0], path: [tx(1), out(1), tx(8), out(8), tx(3)] }],
      }),
    ],
    [
      'meeting',
      (run: ScanRun) => ({ ...run, results: [{ ...run.results[0], meetingNode: tx(2) }] }),
    ],
    [
      'relationship',
      (run: ScanRun) => ({
        ...run,
        results: [{ ...run.results[0], relationship: 'shared-ancestor' as const }],
      }),
    ],
    [
      'direction',
      (run: ScanRun) => ({
        ...run,
        results: [{ ...run.results[0], scanDirection: 'upstream' as const }],
      }),
    ],
    [
      'path directions',
      (run: ScanRun) => ({
        ...run,
        results: [
          {
            ...run.results[0],
            directions: ['upstream' as const, ...run.results[0].directions.slice(1)],
          },
        ],
      }),
    ],
  ])('does not collapse distinct %s identities', (_name, change) => {
    const { run } = fixture();
    const different = change(rerun(run));
    const groups = groupScanRuns(mergeScanRunSnapshots([run], [different]));
    expect(groups.flatMap((group) => group.results)).toHaveLength(2);
  });

  it('keeps a dismissed finding dismissed through reruns and later streaming snapshots until cleared', () => {
    const { workspace, run, evidence } = fixture();
    const saved = replaceScanRun(workspace, run, evidence);
    const dismissed = dismissScanResult(saved, run.id, run.results[0].id);
    const next = rerun(run);
    const repeated = replaceScanRun(dismissed, { ...next, status: 'running' });
    expect(groupScanRuns(repeated.connectionScans!.runs)).toEqual([]);
    expect(repeated.connectionScans!.runs[0].results[0].dismissed).toBe(true);

    const streamed = replaceScanRun(repeated, { ...next, examined: 9, status: 'running' });
    const completed = parseWorkspace(replaceScanRun(streamed, { ...next, examined: 10 }));
    expect(completed.connectionScans!.runs).toHaveLength(1);
    expect(completed.connectionScans!.runs[0].results[0].dismissed).toBe(true);
    expect(groupScanRuns(mergeScanRunSnapshots(completed.connectionScans!.runs, [next]))).toEqual(
      [],
    );

    const cleared = clearScanRuns(completed);
    expect(cleared.connectionScans).toBeUndefined();
    expect(
      groupScanRuns(replaceScanRun(cleared, next, evidence).connectionScans!.runs),
    ).toHaveLength(1);
  });

  it('retains only the latest identical run over 25 reruns without filling the 20-run limit', () => {
    const { workspace, run, evidence } = fixture();
    let saved = replaceScanRun(workspace, run, evidence);
    for (let index = 0; index < 25; index++) {
      const next = rerun(run, `repeat-${index}`);
      saved = replaceScanRun(saved, { ...next, status: 'running', results: [] });
      saved = parseWorkspace(replaceScanRun(saved, next, evidence));
      expect(saved.connectionScans!.runs).toEqual([next]);
    }
    expect(Object.keys(saved.connectionScans!.evidence).sort()).toEqual([id(2), id(3)]);
    expect(saved.transactions).toEqual(workspace.transactions);
  });

  it('persists alternative paths and their proof while replacing just the repeated path', () => {
    const { workspace, run, result, alternative, evidence } = fixture();
    const saved = replaceScanRun(workspace, { ...run, results: [result, alternative] }, evidence);
    const next = rerun(run);
    const repeated = parseWorkspace(replaceScanRun(saved, next));
    expect(repeated.connectionScans!.runs.map((item) => item.results)).toEqual([
      [alternative],
      next.results,
    ]);
    expect(repeated.connectionScans!.evidence).toEqual(evidence);
  });

  it('refreshes observation metadata on a repeated unspent endpoint', () => {
    const { workspace, run } = fixture();
    const endpoint: ScanResult = {
      id: 'first:unspent',
      kind: 'endpoint',
      finding: 'unspent',
      endpoint: out(1),
      path: [tx(1), out(1)],
      directions: ['downstream'],
      scanDirection: 'downstream',
      hops: 0,
      checkedAt: '2026-09-10T12:00:00.000Z',
      bestBlock: id(90),
      includesMempool: true,
    };
    const original = { ...run, results: [endpoint] };
    const saved = replaceScanRun(workspace, original);
    const next = rerun(original);
    next.results[0] = {
      ...next.results[0],
      checkedAt: '2026-09-10T12:01:00.000Z',
      bestBlock: id(91),
    };
    const updated = parseWorkspace(replaceScanRun(saved, next));
    expect(updated.connectionScans!.runs).toEqual([next]);
    expect(groupScanRuns(updated.connectionScans!.runs)[0].results[0].checkedAt).toBe(
      next.results[0].checkedAt,
    );
  });
});
