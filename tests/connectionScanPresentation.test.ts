import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  type ScanResult,
  type ScanRun,
} from '../src/Domain/ConnectionScan/connectionScan';
import {
  presentScanRun,
  scanStatus,
  scanStatusLabel,
} from '../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScanPresentation';
import {
  resultFinding,
  resultCategory,
} from '../src/Domain/ConnectionScan/connectionScanClassification';

const run: ScanRun = {
  id: 'public-run',
  source: `tx:${'1'.repeat(64)}`,
  targetIds: [],
  settings: { ...DEFAULT_SCAN_SETTINGS },
  startedAt: '2026-09-10T12:00:00.000Z',
  status: 'complete',
  examined: 88,
  stopReasons: ['depth', 'fan-out', 'unknown', 'time'],
  results: [],
};
describe('scan progress presentation', () => {
  it('shows active work and gives a whole-run deadline priority over branch limits and missing evidence', () => {
    expect(scanStatus(run, false)).toEqual({
      label: 'Scan stopped: time limit reached',
      tone: 'warning',
    });
    expect(scanStatus(run, true)).toEqual({ label: 'Scanning…', tone: 'running' });
    expect(scanStatusLabel(run, false)).toBe(scanStatus(run, false).label);
  });
  it.each(
    ([[], ['depth'], ['fan-out'], ['depth', 'fan-out']] as ScanRun['stopReasons'][]).map(
      (stopReasons) => ({ stopReasons }),
    ),
  )('completes normally after configured branch stops %j', ({ stopReasons }) => {
    expect(scanStatus({ ...run, stopReasons }, false)).toEqual({
      label: 'Scan completed.',
      tone: 'complete',
    });
  });
  it.each([
    [['depth', 'results', 'transactions'], 'Scan stopped: transaction limit reached'],
    [['unknown', 'results'], 'Scan stopped: result limit reached'],
    [['depth', 'failure'], 'Scan completed: some paths unavailable'],
    [['fan-out', 'unknown'], 'Scan completed: some paths unavailable'],
  ] as [ScanRun['stopReasons'], string][])(
    'keeps global limit and evidence warnings truthful for %j',
    (stopReasons, label) => {
      expect(scanStatus({ ...run, stopReasons }, false)).toEqual({ label, tone: 'warning' });
    },
  );
  it.each([
    ['cancelled', 'Scan cancelled.', 'warning'],
    ['interrupted', 'Scan interrupted.', 'warning'],
    ['running', 'Scan interrupted.', 'warning'],
    ['failed', 'Scan failed.', 'error'],
  ] as const)(
    'gives %s lifecycle state precedence over previous branch and limit reasons',
    (status, label, tone) => {
      expect(scanStatus({ ...run, status }, false)).toEqual({ label, tone });
    },
  );
  it('does not call a cancelled stop complete even if its saved status says complete', () => {
    expect(scanStatus({ ...run, stopReasons: ['cancelled'] }, false)).toEqual({
      label: 'Scan cancelled.',
      tone: 'warning',
    });
  });
  it.each([
    ['backend-unavailable', 'Scan stopped: backend unavailable'],
    ['rate-limited', 'Scan stopped: request limit reached'],
    ['offline', 'Scan completed: offline coverage only'],
  ] as const)('shows %s as run coverage instead of a finding', (reason, label) => {
    expect(scanStatus({ ...run, stopReasons: [reason] }, false)).toEqual({
      label,
      tone: 'warning',
    });
  });

  it('maps all13 finding kinds and orders primary findings before issues and endpoints', () => {
    const base: ScanResult = {
      id: 'fixture',
      kind: 'boundary',
      endpoint: run.source,
      path: [run.source],
      directions: [],
      hops: 0,
    };
    const entries: [ScanResult, string, string][] = [
      [
        { ...base, kind: 'connection', relationship: 'direct', scanDirection: 'upstream' },
        'upstream-connection',
        'connection',
      ],
      [
        { ...base, kind: 'connection', relationship: 'direct', scanDirection: 'downstream' },
        'downstream-connection',
        'connection',
      ],
      [
        { ...base, kind: 'connection', relationship: 'shared-ancestor' },
        'shared-ancestor',
        'connection',
      ],
      [
        { ...base, kind: 'connection', relationship: 'shared-descendant' },
        'shared-descendant',
        'connection',
      ],
      [{ ...base, finding: 'many-inputs' }, 'many-inputs', 'branch'],
      [{ ...base, finding: 'many-outputs' }, 'many-outputs', 'branch'],
      [{ ...base, finding: 'unspent', kind: 'endpoint' }, 'unspent', 'endpoint'],
      [{ ...base, finding: 'coinbase', kind: 'endpoint' }, 'coinbase', 'endpoint'],
      [{ ...base, finding: 'unspendable', kind: 'endpoint' }, 'unspendable', 'endpoint'],
      [{ ...base, finding: 'transaction-unavailable' }, 'transaction-unavailable', 'issue'],
      [{ ...base, finding: 'spend-unknown' }, 'spend-unknown', 'issue'],
      [{ ...base, finding: 'lookup-failed' }, 'lookup-failed', 'issue'],
      [{ ...base, finding: 'conflicting-evidence' }, 'conflicting-evidence', 'issue'],
    ];
    for (const [result, finding, category] of entries) {
      expect(resultFinding(result)).toBe(finding);
      expect(resultCategory(result)).toBe(category);
    }
    const shown = presentScanRun(
      {
        ...run,
        settings: { ...run.settings, targetScope: 'custom' },
        results: entries.map(([result], index) => ({ ...result, id: String(index) })).reverse(),
      },
      new Set(),
    );
    expect(shown.results.map(resultCategory)).toEqual([
      ...Array(4).fill('connection'),
      ...Array(2).fill('branch'),
      ...Array(4).fill('issue'),
      ...Array(3).fill('endpoint'),
    ]);
  });

  it('removes every legacy global row while retaining coverage and truthful legacy node findings', () => {
    const base: ScanResult = {
      id: 'legacy',
      kind: 'boundary',
      endpoint: run.source,
      path: [run.source],
      directions: [],
      hops: 0,
    };
    const reasons: ScanRun['stopReasons'] = [
      'depth',
      'time',
      'transactions',
      'results',
      'cancelled',
      'backend-unavailable',
      'rate-limited',
      'offline',
    ];
    const legacy = reasons.map((reason) => ({ ...base, id: reason, reason }));
    const shown = presentScanRun({ ...run, results: legacy, stopReasons: reasons }, new Set());
    expect(shown.results).toEqual([]);
    expect(shown.stopReasons).toEqual(reasons);
    expect(resultFinding({ ...base, reason: 'fan-out' })).toBeUndefined();
    expect(resultFinding({ ...base, reason: 'fan-out', scanDirection: 'upstream' })).toBe(
      'many-inputs',
    );
    expect(
      resultFinding({
        ...base,
        reason: 'unknown',
        endpoint: `out:${'1'.repeat(64)}:0`,
        scanDirection: 'downstream',
      }),
    ).toBe('spend-unknown');
    expect(resultFinding({ ...base, reason: 'failure' })).toBe('lookup-failed');
  });

  it('keeps dismissed streaming results dismissed in later snapshots and hides legacy depth and time rows', () => {
    const result: ScanResult = {
      id: 'kept',
      kind: 'boundary' as const,
      endpoint: run.source,
      path: [run.source],
      directions: [],
      hops: 0,
      reason: 'fan-out' as const,
      scanDirection: 'downstream',
    };
    const first = { ...run, results: [result] };
    const next = {
      ...run,
      results: [
        result,
        { ...result, id: 'new' },
        { ...result, id: 'depth', reason: 'depth' as const },
        { ...result, id: 'time', reason: 'time' as const },
      ],
    };
    const dismissed = new Set(['kept']);
    expect(presentScanRun(first, dismissed).results[0].dismissed).toBe(true);
    const shown = presentScanRun(next, dismissed);
    expect(shown.results.map((item) => [item.id, !!item.dismissed])).toEqual([
      ['kept', true],
      ['new', false],
    ]);
    expect(next.results[0].dismissed).toBeUndefined();
    expect(shown.examined).toBe(88);
    expect(shown.stopReasons).toEqual(next.stopReasons);
    expect(next.results).toHaveLength(4);
  });
});
