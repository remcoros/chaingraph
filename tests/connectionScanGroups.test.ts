import { describe, expect, it } from 'vitest';
import type { ScanResult } from '../src/domain/connectionScan';
import { groupScanResults, scanResultGroupKey } from '../src/domain/connectionScanGroups';
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
