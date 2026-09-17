import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS } from '../../../../../Core/Workspace/ConnectionScan/connectionScan';
import type {
  ScanResult,
  ScanRun,
} from '../../../../../Core/Workspace/ConnectionScan/connectionScans';
import {
  mergeScanRunSnapshots,
  scanResultGroupKey,
} from '../../../../../Core/Workspace/ConnectionScan/results';
import { groupScanResults, groupScanRuns } from './connectionScanGroups';

const tx = (n: number) => `tx:${n.toString(16).padStart(64, '0')}`;
const connection: ScanResult = {
  id: 'a',
  kind: 'connection',
  relationship: 'shared-ancestor',
  endpoint: tx(2),
  meetingNode: tx(3),
  path: [tx(1), tx(3), tx(2)],
  directions: ['upstream', 'downstream'],
  hops: 2,
};
describe('scan finding groups', () => {
  const run = (id: string, source: string, results: ScanResult[]): ScanRun => ({
    id,
    source,
    results,
    targetIds: [tx(2)],
    settings: { ...DEFAULT_SCAN_SETTINGS },
    startedAt: '2026-09-11T00:00:00.000Z',
    status: 'complete',
    examined: 2,
    stopReasons: [],
  });

  it('keeps old findings visible through a new scan and old-card updates preserve current progress', () => {
    const old = run('old', tx(1), [connection]);
    const pending = { ...run('new', tx(4), []), status: 'running' as const };
    const started = mergeScanRunSnapshots([old], [pending]);
    expect(groupScanRuns(started).map((group) => group.run.source)).toEqual([tx(1)]);
    const fresh = { ...connection, id: 'fresh', path: [tx(4), tx(3), tx(2)] };
    const streaming = { ...pending, examined: 17, results: [fresh] };
    const combined = mergeScanRunSnapshots(started, [streaming]);
    const groups = groupScanRuns(combined);
    expect(groups.map((group) => group.run.source)).toEqual([tx(4), tx(1)]);
    expect(groups[0].id).not.toBe(groups[1].id);
    const dismissed = { ...old, results: [{ ...connection, dismissed: true }] };
    const updated = mergeScanRunSnapshots(combined, [dismissed]);
    expect(updated.at(-1)).toEqual(streaming);
    expect(groupScanRuns(updated).map((group) => group.run.id)).toEqual(['new']);
    expect(groupScanRuns(mergeScanRunSnapshots([], []))).toEqual([]);
  });

  it('prunes empty older snapshots without dropping findings or duplicating streaming runs', () => {
    const old = run('old', tx(1), [connection]);
    const empty = run('empty', tx(3), []);
    const latest = run('latest', tx(4), []);
    const snapshots = mergeScanRunSnapshots([old, empty], [old, empty, latest]);
    expect(snapshots.map((item) => item.id)).toEqual(['old', 'latest']);
  });

  it('groups alternative paths while keeping different meeting points distinct', () => {
    const alternate = {
      ...connection,
      id: 'b',
      path: [tx(1), tx(4), tx(3), tx(2)],
      directions: ['upstream', 'upstream', 'downstream'] as const,
      hops: 3,
    };
    const groups = groupScanResults([
      connection,
      { ...alternate, directions: [...alternate.directions] },
      { ...connection, id: 'c', meetingNode: tx(5) },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].results.map((r) => r.id)).toEqual(['a', 'b']);
    expect(groups[1].results[0].meetingNode).toBe(tx(5));
  });
  it('prioritizes connections and branch decisions, with endpoints last and global limits absent', () => {
    const boundary = {
      ...connection,
      kind: 'boundary' as const,
      relationship: undefined,
      meetingNode: undefined,
      scanDirection: 'downstream' as const,
    };
    const groups = groupScanResults([
      { ...boundary, id: 'end', kind: 'endpoint', finding: 'unspent' },
      { ...boundary, id: 'issue', finding: 'spend-unknown', reason: 'unknown' },
      { ...boundary, id: 'branch', finding: 'many-outputs', reason: 'fan-out' },
      { ...boundary, id: 'limit', reason: 'transactions' },
      { ...connection, id: 'hidden', dismissed: true },
      connection,
    ]);
    expect(groups.map((g) => g.category)).toEqual(['connection', 'branch', 'issue', 'endpoint']);
    expect(groups.flatMap((g) => g.results).map((r) => r.id)).not.toContain('hidden');
    expect(scanResultGroupKey({ ...connection, id: 'another' })).toBe(
      scanResultGroupKey(connection),
    );
  });
});
