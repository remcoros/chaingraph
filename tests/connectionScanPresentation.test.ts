import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS, type ScanResult, type ScanRun } from '../src/domain/connectionScan';
import { presentScanRun, scanStatusLabel } from '../src/domain/connectionScanPresentation';

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
  it('explains a partial transaction count using the whole-run stop, not earlier branch limits', () => {
    expect(scanStatusLabel(run, false)).toBe('Time limit reached');
    expect(scanStatusLabel(run, true)).toBe('Scanning');
    expect(scanStatusLabel({ ...run, status: 'cancelled' }, false)).toBe('Cancelled');
    expect(scanStatusLabel({ ...run, stopReasons: ['depth'] }, false)).toBe('3-hop limit reached');
    expect(scanStatusLabel({ ...run, stopReasons: [] }, false)).toBe('Finished');
  });
  it('keeps dismissed streaming results dismissed in later snapshots and hides legacy depth rows', () => {
    const result: ScanResult = {
      id: 'kept',
      kind: 'boundary' as const,
      endpoint: run.source,
      path: [run.source],
      directions: [],
      hops: 0,
      reason: 'fan-out' as const,
    };
    const first = { ...run, results: [result] };
    const next = {
      ...run,
      results: [
        result,
        { ...result, id: 'new' },
        { ...result, id: 'depth', reason: 'depth' as const },
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
  });
});
