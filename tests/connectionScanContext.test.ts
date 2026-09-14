import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
  type ConnectionScanOptions,
} from '../src/Domain/ConnectionScan/connectionScan';
import {
  prepareScanContext,
  scanReconnectionKey,
} from '../src/Domain/ConnectionScan/connectionScanContext';
import { mergeScanRunSnapshots } from '../src/Domain/ConnectionScan/connectionScanGroups';

const tx = (n: number) => `tx:${n.toString(16).padStart(64, '0')}`;
const out = (n: number, v = 0) => `out:${n.toString(16).padStart(64, '0')}:${v}`;
type Edge = [string, string];
function scan(edges: Edge[], knownLinks: Edge[], changes: Partial<ConnectionScanOptions> = {}) {
  return runConnectionScan({
    id: 'context-scenario',
    source: tx(4),
    targetIds: [out(1)],
    displayedNodeIds: [tx(4)],
    knownNodeIds: [...new Set(knownLinks.flat())],
    knownLinks,
    settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'upstream' },
    resolveNeighbors: async (id, direction) => ({
      nodeIds: edges
        .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === id)
        .map((edge) => edge[direction === 'downstream' ? 1 : 0]),
    }),
    ...changes,
  });
}
const ancestry: Edge[] = [
  [out(1), tx(2)],
  [tx(2), out(2)],
  [out(2), tx(4)],
];

describe('automatic connection qualification against frozen routes', () => {
  it('does not call the same hidden ancestry route a discovery', async () => {
    const run = await scan(ancestry, ancestry);
    expect(run.results.filter((r) => r.kind === 'connection')).toEqual([]);
  });

  it('finds a new edge between known nodes and retains the separate existing route', async () => {
    const known: Edge[] = [
      [out(1), tx(3)],
      [tx(3), out(3)],
      [out(3), tx(4)],
    ];
    const run = await scan([...ancestry, ...known], known, {
      knownNodeIds: [...new Set([...ancestry, ...known].flat())],
    });
    const results = run.results.filter((r) => r.kind === 'connection');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      relationship: 'direct',
      path: [tx(4), out(2), tx(2), out(1)],
      context: {
        path: [tx(4), out(3), tx(3), out(1)],
        directions: ['upstream', 'upstream', 'upstream'],
      },
    });
  });

  it('continues through a rejected automatic target to a deeper bridge', async () => {
    const run = await scan(ancestry, [[out(2), tx(4)]], { targetIds: [out(2), out(1)] });
    expect(run.results.filter((r) => r.kind === 'connection')).toMatchObject([
      { endpoint: out(1), relationship: 'direct', bridge: true },
    ]);
  });

  it('does not reinterpret an oversized existing route as a disconnected bridge', async () => {
    const known: Edge[] = [[out(1), tx(20)]];
    for (let n = 20; n < 29; n++) known.push([tx(n), out(n)], [out(n), tx(n + 1)]);
    known.push([tx(29), out(29)], [out(29), tx(4)]);
    const run = await scan(ancestry, known);
    expect(run.results.filter((r) => r.kind === 'connection')).toEqual([]);
  });

  it('does not let fetched branches become their own existing return route', async () => {
    const run = await scan(ancestry, [[out(2), tx(4)]]);
    expect(run.results.filter((r) => r.kind === 'connection')).toMatchObject([{ bridge: true }]);
    expect(run.results.some((r) => r.context)).toBe(false);
  });

  it('keeps overlapping prefixes and tails of a genuine reconnection', async () => {
    const known: Edge[] = [
      [out(1), tx(3)],
      [tx(3), out(3)],
      [out(3), tx(4)],
      [tx(4), out(4)],
      [out(4), tx(5)],
    ];
    const run = await scan([...ancestry, ...known], known, { source: tx(5) });
    const result = run.results.find((r) => r.relationship === 'direct')!;
    expect(result.path).toEqual([tx(5), out(4), tx(4), out(2), tx(2), out(1)]);
    expect(result.context?.path).toEqual([tx(5), out(4), tx(4), out(3), tx(3), out(1)]);
  });

  it('deduplicates opposite views of the same loop across reruns', async () => {
    const known: Edge[] = [
      [out(1), tx(4)],
      [out(2), tx(4)],
    ];
    const edges: Edge[] = [
      ...known,
      [tx(1), out(1)],
      [tx(1), out(1, 1)],
      [out(1, 1), tx(2)],
      [tx(2), out(2)],
    ];
    const a = await scan(edges, known, { targetIds: [out(1), out(2)] });
    const b = await scan(edges, known, { id: 'second', targetIds: [out(2), out(1)] });
    const connections = a.results.filter((r) => r.kind === 'connection');
    expect(connections).toHaveLength(1);
    expect(scanReconnectionKey(connections[0])).toBeDefined();
    expect(
      mergeScanRunSnapshots([a], [b])
        .flatMap((r) => r.results)
        .filter((r) => r.kind === 'connection'),
    ).toHaveLength(1);
  });

  it('checks cancellation/deadlines while indexing a large loaded graph', async () => {
    let calls = 0;
    await expect(
      prepareScanContext(tx(4), ancestry, new Set(), async () => {
        if (++calls > 2) throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
  });
});
