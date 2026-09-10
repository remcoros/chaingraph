import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
  type ConnectionScanOptions,
  type ScanResult,
} from '../src/domain/connectionScan';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${hash(n)}`;
const out = (n: number, vout = 0) => `out:${hash(n)}:${vout}`;
type Edge = [string, string];
const creates = (n: number, vout = 0): Edge => [tx(n), out(n, vout)];
const spends = (parent: number, child: number, vout = 0): Edge => [out(parent, vout), tx(child)];

function scan(edges: Edge[], overrides: Partial<ConnectionScanOptions>) {
  // Fixtures represent observed creates/spends edges, with one spender per output.
  // A repeated prevout would turn a search regression into an evidence-conflict test.
  const consumed = edges.filter(([node]) => node.startsWith('out:'));
  expect(new Set(consumed.map(([node]) => node)).size).toBe(consumed.length);
  for (const [node] of consumed) expect(edges.some(([, target]) => target === node)).toBe(true);
  return runConnectionScan({
    id: 'search-symmetry',
    source: tx(10),
    targetIds: [tx(30)],
    displayedNodeIds: [tx(10), tx(30)],
    settings: {
      ...DEFAULT_SCAN_SETTINGS,
      direction: 'upstream',
      maxHops: 7,
      maxTransactions: 1000,
      maxMilliseconds: 60_000,
      fanOut: 10,
    },
    resolveNeighbors: async (node, direction) => ({
      nodeIds: edges
        .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === node)
        .map((edge) => edge[direction === 'downstream' ? 1 : 0]),
    }),
    ...overrides,
  });
}

const connections = (results: ScanResult[]) => results.filter((item) => item.kind === 'connection');

describe('connection search topology regressions', () => {
  const branches = Array.from({ length: 5 }, (_, index) => ({
    index,
    first: 20 + index * 10,
    second: 21 + index * 10,
  }));
  const outputs = branches.map(({ index }) => out(300, index));
  const displayed = [tx(300), ...outputs, ...branches.map(({ index }) => out(100 + index))];
  const downstreamEdges: Edge[] = [
    ...branches.flatMap(({ index, first, second }) => [
      creates(100 + index),
      spends(100 + index, 300),
      creates(300, index),
      spends(300, first, index),
      creates(first),
      spends(first, second),
      creates(second),
      spends(second, 400),
    ]),
    creates(400),
  ];

  it.each(branches.map(({ index }) => index))(
    'finds all four five-hop shared descendants from displayed output %i',
    async (sourceIndex) => {
      const source = branches[sourceIndex]!;
      const run = await scan(downstreamEdges, {
        source: outputs[sourceIndex]!,
        targetIds: displayed.filter((node) => node !== outputs[sourceIndex]),
        displayedNodeIds: displayed,
        settings: {
          ...DEFAULT_SCAN_SETTINGS,
          direction: 'downstream',
          maxHops: 5,
          maxTransactions: 1000,
          maxMilliseconds: 60_000,
          fanOut: 10,
        },
      });
      const found = connections(run.results).filter((item) => outputs.includes(item.endpoint));
      expect(found.map((item) => item.endpoint).sort()).toEqual(
        outputs.filter((node) => node !== outputs[sourceIndex]).sort(),
      );
      for (const target of branches.filter(({ index }) => index !== sourceIndex)) {
        expect(found.find((item) => item.endpoint === outputs[target.index])).toMatchObject({
          relationship: 'shared-descendant',
          meetingNode: tx(400),
          hops: 5,
          path: [
            out(300, sourceIndex),
            tx(source.first),
            out(source.first),
            tx(source.second),
            out(source.second),
            tx(400),
            out(target.second),
            tx(target.second),
            out(target.first),
            tx(target.first),
            out(300, target.index),
          ],
          directions: [...Array(5).fill('downstream'), ...Array(5).fill('upstream')],
        });
      }
      expect(run.stopReasons).not.toContain('transactions');
      expect(run.stopReasons).not.toContain('results');
    },
  );

  it('keeps asymmetric target branches joining below an already explored source intersection', async () => {
    // 1 forks to source 10 and 20; 20 forks to early target 30 and 40 -> 41 -> 42 -> late target 50.
    // The late target must inherit the observed 20 -> 1 ancestry even after 1 was visited.
    const edges: Edge[] = [
      creates(1),
      spends(1, 10),
      creates(10),
      creates(1, 1),
      spends(1, 20, 1),
      creates(20),
      spends(20, 30),
      creates(30),
      creates(20, 1),
      spends(20, 40, 1),
      creates(40),
      spends(40, 41),
      creates(41),
      spends(41, 42),
      creates(42),
      spends(42, 50),
      creates(50),
      creates(80),
      creates(81),
      creates(82),
    ];
    const targets = [out(30), out(50), out(80), out(81), out(82)];
    for (const targetIds of [targets, [...targets].reverse()]) {
      let ancestorLookups = 0;
      let ancestorLookupsAtLateFinding: number | undefined;
      const run = await scan(edges, {
        source: out(10),
        targetIds,
        displayedNodeIds: [out(10), ...targets],
        resolveNeighbors: async (node) => {
          if (node === tx(1)) ancestorLookups++;
          return {
            nodeIds: edges.filter(([, target]) => target === node).map(([source]) => source),
          };
        },
        onProgress: (progress) => {
          if (
            ancestorLookupsAtLateFinding === undefined &&
            progress.results.some((item) => item.endpoint === out(50))
          ) {
            ancestorLookupsAtLateFinding = ancestorLookups;
          }
        },
      });
      const found = connections(run.results);
      expect(found.map((item) => item.endpoint).sort()).toEqual([out(30), out(50)]);
      expect(found.find((item) => item.endpoint === out(30))).toMatchObject({
        meetingNode: tx(1),
        hops: 4,
        path: [out(10), tx(10), out(1), tx(1), out(1, 1), tx(20), out(20), tx(30), out(30)],
      });
      expect(found.find((item) => item.endpoint === out(50))).toMatchObject({
        meetingNode: tx(1),
        hops: 7,
        path: [
          out(10),
          tx(10),
          out(1),
          tx(1),
          out(1, 1),
          tx(20),
          out(20, 1),
          tx(40),
          out(40),
          tx(41),
          out(41),
          tx(42),
          out(42),
          tx(50),
          out(50),
        ],
      });
      expect(ancestorLookupsAtLateFinding).toBe(2);
    }
  });

  it('preserves exact outpoint identity when different outputs have different spenders', async () => {
    const edges: Edge[] = [
      creates(1),
      creates(1, 1),
      spends(1, 2),
      spends(1, 3, 1),
      creates(2),
      creates(3),
    ];
    const run = await scan(edges, {
      source: out(1),
      targetIds: [out(2), out(3)],
      displayedNodeIds: [out(1), out(2), out(3)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream' },
    });
    // A same-txid sibling is not this prevout. Only the branch spending output 0 connects.
    expect(connections(run.results)).toHaveLength(1);
    expect(connections(run.results)[0]).toMatchObject({
      relationship: 'direct',
      endpoint: out(2),
      path: [out(1), tx(2), out(2)],
      hops: 1,
    });
  });

  it.each([
    [tx(10), tx(30), 2],
    [out(10), tx(30), 3],
    [tx(10), out(30), 2],
    [out(10), out(30), 3],
  ])(
    'accounts for source %s and target %s as %i transaction hops',
    async (source, target, hops) => {
      const edges: Edge[] = [
        creates(1),
        spends(1, 10),
        creates(10),
        creates(1, 1),
        spends(1, 30, 1),
        creates(30),
      ];
      const run = await scan(edges, {
        source: source as string,
        targetIds: [target as string],
        displayedNodeIds: [source as string, target as string],
        settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'upstream', maxHops: hops as number },
      });
      expect(connections(run.results)).toHaveLength(1);
      expect(connections(run.results)[0]).toMatchObject({
        relationship: 'shared-ancestor',
        meetingNode: tx(1),
        endpoint: target,
        hops,
      });
      expect(new Set(connections(run.results)[0]!.path).size).toBe(
        connections(run.results)[0]!.path.length,
      );
    },
  );
});
