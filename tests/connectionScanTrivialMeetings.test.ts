import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  SCAN_LIMITS,
  runConnectionScan,
  type ConnectionScanOptions,
  type ScanResult,
} from '../src/Domain/ConnectionScan/connectionScan';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${hash(n)}`;
const out = (n: number, vout = 0) => `out:${hash(n)}:${vout}`;
type Edge = [string, string];
const creates = (n: number, vout = 0): Edge => [tx(n), out(n, vout)];
const spends = (parent: number, child: number, vout = 0): Edge => [out(parent, vout), tx(child)];

function scan(edges: Edge[], overrides: Partial<ConnectionScanOptions> = {}) {
  // Every fixture uses distinct prevouts and at most one spender per output.
  const consumed = edges.filter(([node]) => node.startsWith('out:'));
  expect(new Set(consumed.map(([node]) => node)).size).toBe(consumed.length);
  for (const [node] of consumed) expect(edges.some(([, target]) => target === node)).toBe(true);
  return runConnectionScan({
    id: 'trivial-meetings',
    source: out(1),
    targetIds: [out(1, 1)],
    displayedNodeIds: [out(1), out(1, 1)],
    settings: {
      ...DEFAULT_SCAN_SETTINGS,
      direction: 'upstream',
      maxHops: 7,
      maxTransactions: 1000,
      maxMilliseconds: 60_000,
      fanOut: 200,
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

describe('useful shared meeting results', () => {
  it.each(['upstream', 'both'] as const)(
    'omits the creating transaction alone as a sibling discovery in %s',
    async (direction) => {
      const run = await scan([creates(1), creates(1, 1)], {
        settings: { ...DEFAULT_SCAN_SETTINGS, direction },
      });
      expect(connections(run.results)).toEqual([]);
      expect(run.stopReasons).toEqual([]);
    },
  );

  it('omits both sibling routes when their spending transaction is selected', async () => {
    const inputs = [out(1), out(1, 1)];
    const run = await scan([creates(1), creates(1, 1), spends(1, 2), spends(1, 2, 1), creates(2)], {
      source: tx(2),
      targetIds: [...inputs, out(2)],
      displayedNodeIds: [tx(2), ...inputs, out(2)],
    });
    expect(connections(run.results)).toEqual([]);
  });

  it('leaves result capacity for a useful reconnection after many sibling targets', async () => {
    const siblingCount = SCAN_LIMITS.maxResults + 10;
    const siblings = Array.from({ length: siblingCount }, (_, index) => out(1, index + 1));
    const bridge = siblingCount + 1;
    const run = await scan(
      [
        ...Array.from({ length: bridge + 1 }, (_, index) => creates(1, index)),
        spends(1, 2, bridge),
        creates(2),
      ],
      {
        targetIds: [...siblings, out(2)],
        displayedNodeIds: [out(1), ...siblings, out(2)],
      },
    );
    expect(connections(run.results)).toEqual([
      expect.objectContaining({
        relationship: 'shared-ancestor',
        endpoint: out(2),
        path: [out(1), tx(1), out(1, bridge), tx(2), out(2)],
      }),
    ]);
    expect(run.stopReasons).not.toContain('results');
  });

  const bypass: Edge[] = [
    creates(1),
    spends(1, 10),
    creates(1, 1),
    spends(1, 5, 1),
    creates(5),
    spends(5, 10),
    creates(1, 2),
  ];
  const displayed = [tx(10), out(1), tx(5), out(5), out(1, 2)];
  const longer = [tx(10), out(5), tx(5), out(1, 1), tx(1), out(1, 2)];

  it.each([
    ['source', tx(10), out(1, 2), longer],
    ['target', out(1, 2), tx(10), [...longer].reverse()],
  ] as const)(
    'retains a longer useful %s leg at the same creator as a trivial short route',
    async (_leg, source, target, path) => {
      const run = await scan(bypass, {
        source,
        targetIds: [target],
        displayedNodeIds: displayed,
      });
      expect(connections(run.results)).toEqual([
        expect.objectContaining({
          relationship: 'shared-ancestor',
          meetingNode: tx(1),
          path: [...path],
        }),
      ]);
    },
  );

  it.each(['downstream', 'both'] as const)(
    'keeps a newly discovered common spender of sibling outputs in %s',
    async (direction) => {
      const run = await scan([creates(1), creates(1, 1), spends(1, 2), spends(1, 2, 1)], {
        settings: { ...DEFAULT_SCAN_SETTINGS, direction },
      });
      expect(connections(run.results)).toEqual([
        expect.objectContaining({
          relationship: 'shared-descendant',
          meetingNode: tx(2),
          path: [out(1), tx(2), out(1, 1)],
        }),
      ]);
    },
  );

  it('keeps shared funding when either branch contains a newly discovered outpoint', async () => {
    const run = await scan([creates(1), creates(1, 1), spends(1, 2), spends(1, 3, 1)], {
      source: tx(2),
      targetIds: [tx(3)],
      displayedNodeIds: [tx(2), tx(3)],
    });
    expect(connections(run.results)).toEqual([
      expect.objectContaining({
        relationship: 'shared-ancestor',
        path: [tx(2), out(1), tx(1), out(1, 1), tx(3)],
      }),
    ]);
  });

  it('keeps a hidden picked output as a useful target even with its creator displayed', async () => {
    const run = await scan([creates(1), creates(1, 1)], {
      displayedNodeIds: [out(1), tx(1)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'upstream', targetScope: 'custom' },
    });
    expect(connections(run.results)).toEqual([
      expect.objectContaining({
        relationship: 'shared-ancestor',
        path: [out(1), tx(1), out(1, 1)],
      }),
    ]);
  });

  it('keeps a direct connection to a hidden picked creating transaction', async () => {
    const run = await scan([creates(1)], {
      targetIds: [tx(1)],
      displayedNodeIds: [out(1)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'upstream', targetScope: 'custom' },
    });
    expect(connections(run.results)).toEqual([
      expect.objectContaining({ relationship: 'direct', path: [out(1), tx(1)] }),
    ]);
  });

  it('keeps a direct spend path through the hidden creator of a displayed target', async () => {
    const run = await scan([creates(1), spends(1, 2), creates(2)], {
      targetIds: [out(2)],
      displayedNodeIds: [out(1), out(2)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream' },
    });
    expect(connections(run.results)).toEqual([
      expect.objectContaining({ relationship: 'direct', path: [out(1), tx(2), out(2)] }),
    ]);
  });
});
