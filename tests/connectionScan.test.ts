import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  SCAN_LIMITS,
  ScanBudgetExceeded,
  isScanNodeId,
  runConnectionScan,
  validateScanSettings,
  type ConnectionScanOptions,
  type ScanDirection,
  type ScanObservation,
} from '../src/domain/connectionScan';

const tx = (n: number) => `tx:${n.toString(16).padStart(64, '0')}`;
const out = (n: number, index = 0) => `out:${n.toString(16).padStart(64, '0')}:${index}`;
type Edge = [string, string];
const creates = (n: number, index = 0): Edge => [tx(n), out(n, index)];
const spends = (parent: number, child: number, index = 0): Edge => [out(parent, index), tx(child)];
function options(
  edges: Edge[],
  changes: Partial<ConnectionScanOptions> = {},
): ConnectionScanOptions {
  return {
    id: 'fixture-run',
    source: tx(1),
    targetIds: [tx(3)],
    displayedNodeIds: [tx(1), tx(3)],
    settings: { ...DEFAULT_SCAN_SETTINGS },
    resolveNeighbors: async (id, direction) => ({
      nodeIds: edges
        .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === id)
        .map((edge) => edge[direction === 'downstream' ? 1 : 0]),
    }),
    ...changes,
  };
}
const pathEdges: Edge[] = [creates(1), spends(1, 2), creates(2), spends(2, 3)];

describe('bounded connection traversal', () => {
  it('finds exact direct paths, keeps directions, and freezes target/settings snapshots', async () => {
    const input = options(pathEdges);
    const run = await runConnectionScan(input);
    const direct = run.results.find((result) => result.relationship === 'direct')!;
    expect(direct.path).toEqual([tx(1), out(1), tx(2), out(2), tx(3)]);
    expect(direct.directions).toEqual(Array(4).fill('downstream'));
    expect(direct.hops).toBe(2);
    input.settings.maxHops = 1;
    (input.targetIds as string[]).push(tx(9));
    expect(run.settings.maxHops).toBe(3);
    expect(run.targetIds).toEqual([tx(3)]);
    expect(run.examined).toBeLessThanOrEqual(3);
    expect(run.status).toBe('complete');
    expect(Object.keys(run).sort()).toEqual([
      'deepestHop',
      'examined',
      'id',
      'results',
      'settings',
      'source',
      'startedAt',
      'status',
      'stopReasons',
      'targetIds',
    ]);
  });

  it.each([
    ['upstream', 'shared-ancestor', [creates(2), spends(2, 1), creates(2, 1), spends(2, 3, 1)]],
    ['downstream', 'shared-descendant', [creates(1), spends(1, 2), creates(3), spends(3, 2)]],
  ] as const)(
    'finds %s meetings with one direction change and one shared budget',
    async (direction, relationship, edges) => {
      const run = await runConnectionScan(
        options([...edges] as Edge[], {
          settings: { ...DEFAULT_SCAN_SETTINGS, direction },
        }),
      );
      const result = run.results.find((item) => item.relationship === relationship)!;
      expect(result).toBeDefined();
      expect(result.endpoint).toBe(tx(3));
      expect(result.meetingNode).toBe(tx(2));
      expect(result.scanDirection).toBe(direction);
      expect(result.path[0]).toBe(tx(1));
      expect(result.path.at(-1)).toBe(tx(3));
      expect(result.hops).toBe(2);
      expect(result.directions.slice(0, 2)).toEqual([direction, direction]);
      expect(result.directions.slice(2)).toEqual(
        Array(2).fill(direction === 'upstream' ? 'downstream' : 'upstream'),
      );
      expect(run.examined).toBe(3);
    },
  );

  it('does not alternate directions through unrelated siblings', async () => {
    // 1 -> 2 <- 4 -> 5 <- 3 needs multiple reversals, so is neither directed nor a meeting.
    const edges: Edge[] = [
      creates(1),
      spends(1, 2),
      creates(4),
      spends(4, 2),
      creates(4, 1),
      spends(4, 5, 1),
      creates(3),
      spends(3, 5),
    ];
    const run = await runConnectionScan(options(edges));
    expect(run.results.filter((result) => result.kind === 'connection')).toEqual([]);
  });

  it('excludes paths wholly displayed and deduplicates repeated neighbors and meetings', async () => {
    const run = await runConnectionScan(options([...pathEdges, ...pathEdges]));
    expect(run.results.filter((result) => result.relationship === 'direct')).toHaveLength(1);
    const displayed = await runConnectionScan(
      options(pathEdges, { displayedNodeIds: [tx(1), out(1), tx(2), out(2), tx(3)] }),
    );
    expect(displayed.results.filter((result) => result.kind === 'connection')).toEqual([]);
  });

  it('stops a newly discovered direct path at its first target', async () => {
    const input = options(pathEdges, {
      targetIds: [tx(2), tx(3)],
      displayedNodeIds: [tx(1), tx(2), tx(3)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream' },
    });
    const run = await runConnectionScan(input);
    expect(
      run.results.some((result) => result.endpoint === tx(2) && result.kind === 'connection'),
    ).toBe(true);
    // The first path adds out(1); stop there even though tx(3) is also a target.
    expect(
      run.results
        .filter((result) => result.kind === 'connection')
        .every((result) => result.endpoint === tx(2)),
    ).toBe(true);
  });

  it('preserves a truthful fan-out stopping path without siblings', async () => {
    const edges: Edge[] = [creates(1), spends(1, 2), creates(2), creates(2, 1), creates(2, 2)];
    const run = await runConnectionScan(
      options(edges, {
        settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream', fanOut: 3 },
      }),
    );
    const boundary = run.results.find((result) => result.reason === 'fan-out')!;
    expect(boundary.path).toEqual([tx(1), out(1), tx(2)]);
    expect(boundary.endpoint).toBe(tx(2));
    expect(boundary).toMatchObject({
      finding: 'many-outputs',
      branchCount: 3,
      scanDirection: 'downstream',
    });
    expect(run.results.every((result) => !result.path.includes(out(2)))).toBe(true);
  });

  it('records depth limits without result rows and enforces the combined meeting hop limit', async () => {
    const run = await runConnectionScan(
      options(pathEdges, { settings: { ...DEFAULT_SCAN_SETTINGS, maxHops: 1 } }),
    );
    expect(run.stopReasons).toContain('depth');
    expect(run.results.some((result) => result.reason === 'depth')).toBe(false);
    expect(run.results.some((result) => result.kind === 'connection')).toBe(false);
    expect(run.results.every((result) => result.hops <= 1)).toBe(true);
  });

  it('does not request spender evidence beyond the hop limit but still reaches outpoint targets', async () => {
    const calls: string[] = [];
    const input = options(pathEdges, {
      targetIds: [out(2)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream', maxHops: 1 },
    });
    const original = input.resolveNeighbors;
    input.resolveNeighbors = async (...args) => {
      calls.push(args[0]);
      return original(...args);
    };
    const run = await runConnectionScan(input);
    expect(
      run.results.some((result) => result.relationship === 'direct' && result.endpoint === out(2)),
    ).toBe(true);
    const limited = options(pathEdges, { targetIds: [], settings: input.settings });
    const expanded: string[] = [];
    const resolve = limited.resolveNeighbors;
    limited.resolveNeighbors = async (...args) => {
      expanded.push(args[0]);
      return resolve(...args);
    };
    const stopped = await runConnectionScan(limited);
    expect(expanded).not.toContain(out(2));
    expect(stopped.stopReasons).toContain('depth');
    expect(stopped.results.some((result) => result.reason === 'depth')).toBe(false);
  });

  it('publishes a direct result before the next frontier waits for evidence', async () => {
    let release!: () => void;
    let waiting = false;
    const progress = vi.fn();
    const input = options(pathEdges, {
      targetIds: [tx(2), tx(9)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream' },
      onProgress: progress,
    });
    const original = input.resolveNeighbors;
    input.resolveNeighbors = async (...args) => {
      if (args[0] === out(2)) {
        waiting = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original(...args);
    };
    const pending = runConnectionScan(input);
    await vi.waitFor(() => expect(waiting).toBe(true));
    const published = progress.mock.calls.at(-1)![0];
    expect(published.status).toBe('running');
    expect(
      published.results.some(
        (result: { relationship?: string; endpoint: string }) =>
          result.relationship === 'direct' && result.endpoint === tx(2),
      ),
    ).toBe(true);
    release();
    await pending;
  });

  it('does not consume the result allowance with many hop-limit branches', async () => {
    const edges: Edge[] = Array.from({ length: 60 }, (_, index) => [
      creates(1, index),
      spends(1, index + 2, index),
      creates(index + 2),
    ]).flat();
    const run = await runConnectionScan(
      options(edges, {
        targetIds: [],
        settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream', maxHops: 1, fanOut: 100 },
      }),
    );
    expect(run.stopReasons).toEqual(['depth']);
    expect(run.results).toEqual([]);
  });

  it('counts cached and fallback candidate examination in the same total budget', async () => {
    const run = await runConnectionScan(
      options([], {
        settings: { ...DEFAULT_SCAN_SETTINGS, maxTransactions: 2 },
        resolveNeighbors: async (_id, _direction, budget) => {
          budget.examine(tx(8).slice(3));
          budget.examine(tx(8).slice(3));
          expect(budget.examinedTxids).toHaveLength(2);
          budget.examine(tx(9).slice(3));
          return { nodeIds: [] };
        },
      }),
    );
    expect(run.examined).toBe(2);
    expect(run.stopReasons).toContain('transactions');
    expect(run.results).toEqual([]);
  });

  it('alternates source/target and direction fronts deterministically', async () => {
    const calls: [string, ScanDirection][] = [];
    await runConnectionScan(
      options([], {
        targetIds: [tx(9), tx(3)],
        resolveNeighbors: async (id, direction) => {
          calls.push([id, direction]);
          return { nodeIds: [] };
        },
      }),
    );
    expect(calls.slice(0, 4)).toEqual([
      [tx(1), 'upstream'],
      [tx(3), 'upstream'],
      [tx(1), 'downstream'],
      [tx(3), 'downstream'],
    ]);
  });

  it('reports unknown spender evidence without calling it unspent', async () => {
    const run = await runConnectionScan(
      options([], {
        source: out(1),
        resolveNeighbors: async () => ({ nodeIds: [], stopReason: 'unknown' }),
      }),
    );
    expect(run.results[0]).toMatchObject({ kind: 'boundary', reason: 'unknown', endpoint: out(1) });
    expect(run.stopReasons).toEqual(['unknown']);
  });

  it('stops elapsed work and rejects a late neighbor response', async () => {
    let now = 0;
    const run = await runConnectionScan(
      options(pathEdges, {
        now: () => now,
        resolveNeighbors: async () => {
          now = DEFAULT_SCAN_SETTINGS.maxMilliseconds + 1;
          return { nodeIds: [out(1)] };
        },
      }),
    );
    expect(run.stopReasons).toContain('time');
    expect(run.results).toEqual([]);
  });

  it.each(['source', 'target'] as const)(
    'keeps earlier findings when the %s frontier times out without adding time rows',
    async (side) => {
      let now = 0;
      let releaseTimeout!: () => void;
      const earlierFinding = new Promise<void>((resolve) => {
        releaseTimeout = resolve;
      });
      const progress = vi.fn((run) => {
        if (run.results.length) releaseTimeout();
      });
      const input = options(pathEdges, {
        targetIds: side === 'source' ? [] : [tx(2), tx(9)],
        settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream' },
        now: () => now,
        onProgress: progress,
      });
      const original = input.resolveNeighbors;
      input.resolveNeighbors = async (...args) => {
        const [id] = args;
        if (side === 'source') {
          if (id === tx(1)) return { nodeIds: [out(1), out(1, 1)] };
          if (id === out(1)) return { nodeIds: [], stopReason: 'fan-out' };
          await earlierFinding;
          now = DEFAULT_SCAN_SETTINGS.maxMilliseconds + 1;
          return { nodeIds: [] };
        }
        // The target-side outpoint follows the direct source->tx(2) finding.
        if (id === out(2)) {
          await earlierFinding;
          now = DEFAULT_SCAN_SETTINGS.maxMilliseconds + 1;
          return { nodeIds: [] };
        }
        return original(...args);
      };
      const run = await runConnectionScan(input);
      expect(run.stopReasons).toContain('time');
      expect(run.results.length).toBeGreaterThan(0);
      expect(run.results.every((result) => result.reason !== 'time')).toBe(true);
      expect(
        progress.mock.calls.some(
          ([snapshot]) => snapshot.status === 'running' && snapshot.results.length > 0,
        ),
      ).toBe(true);
      expect(
        run.results.some((result) =>
          side === 'source' ? result.reason === 'fan-out' : result.relationship === 'direct',
        ),
      ).toBe(true);
    },
  );

  it('cancels pending work without accepting its late neighbors', async () => {
    const controller = new AbortController();
    const run = await runConnectionScan(
      options(pathEdges, {
        signal: controller.signal,
        resolveNeighbors: async () => {
          controller.abort();
          return { nodeIds: [out(1)] };
        },
      }),
    );
    expect(run.status).toBe('cancelled');
    expect(run.stopReasons).toContain('cancelled');
    expect(run.results).toEqual([]);
  });

  it('sanitizes resolver failures into useful boundaries', async () => {
    const run = await runConnectionScan(
      options([], {
        resolveNeighbors: async () => {
          throw new Error('private upstream fixture detail');
        },
      }),
    );
    expect(run.stopReasons).toEqual(['failure']);
    expect(run.results[0]).toMatchObject({ kind: 'boundary', reason: 'failure' });
    expect(JSON.stringify(run)).not.toContain('private upstream');
  });

  it('caps saved results and reports that boundary instead of silently truncating', async () => {
    const run = await runConnectionScan(
      options([], {
        targetIds: [],
        settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream', fanOut: 100 },
        resolveNeighbors: async (id) =>
          id === tx(1)
            ? { nodeIds: Array.from({ length: 60 }, (_, index) => out(1, index)) }
            : { nodeIds: [], stopReason: 'fan-out' },
      }),
    );
    expect(run.results).toHaveLength(SCAN_LIMITS.maxResults);
    expect(run.stopReasons).toContain('results');
    expect(new Set(run.results.map((result) => result.id)).size).toBe(SCAN_LIMITS.maxResults);
  });

  it('never dispatches work for an already cancelled run', async () => {
    const signal = AbortSignal.abort();
    let calls = 0;
    const run = await runConnectionScan(
      options([], {
        signal,
        resolveNeighbors: async () => {
          calls++;
          return { nodeIds: [] };
        },
      }),
    );
    expect(calls).toBe(0);
    expect(run.status).toBe('cancelled');
    expect(run.examined).toBe(0);
  });

  it.each([
    ['unspent', 'downstream', out(1), 'endpoint'],
    ['coinbase', 'upstream', tx(1), 'endpoint'],
    ['unspendable', 'downstream', out(1), 'endpoint'],
    ['many-inputs', 'upstream', tx(1), 'boundary'],
    ['many-outputs', 'downstream', tx(1), 'boundary'],
    ['transaction-unavailable', 'upstream', tx(1), 'boundary'],
    ['spend-unknown', 'downstream', out(1), 'boundary'],
    ['lookup-failed', 'downstream', out(1), 'boundary'],
    ['conflicting-evidence', 'downstream', out(1), 'boundary'],
  ] as const)(
    'retains %s observation context without inventing path edges',
    async (finding, direction, source, kind) => {
      const observation: ScanObservation = {
        finding,
        ...(finding === 'many-inputs' || finding === 'many-outputs' ? { branchCount: 70 } : {}),
        ...(finding === 'unspent'
          ? {
              checkedAt: '2026-09-11T00:00:00.000Z',
              bestBlock: 'a'.repeat(64),
              includesMempool: true,
            }
          : {}),
        ...(finding === 'lookup-failed' ? { issueCode: 'timeout' as const } : {}),
      };
      const run = await runConnectionScan(
        options([], {
          source,
          targetIds: [],
          settings: { ...DEFAULT_SCAN_SETTINGS, direction },
          resolveNeighbors: async () => ({ nodeIds: [], observation }),
        }),
      );
      expect(run.results).toHaveLength(1);
      expect(run.results[0]).toMatchObject({
        ...observation,
        kind,
        scanDirection: direction,
        path: [source],
        directions: [],
        endpoint: source,
      });
    },
  );

  it.each([
    'time',
    'transactions',
    'results',
    'cancelled',
    'backend-unavailable',
    'rate-limited',
  ] as const)('stops all fronts for %s without resource or lifecycle cards', async (stopReason) => {
    const resolveNeighbors = vi.fn<ConnectionScanOptions['resolveNeighbors']>(async () => ({
      nodeIds: [out(1)],
      stopReason,
    }));
    const run = await runConnectionScan(options([], { resolveNeighbors }));
    // Up to one window may already be in flight when a stop response arrives.
    expect(resolveNeighbors.mock.calls.length).toBeGreaterThan(0);
    expect(resolveNeighbors.mock.calls.length).toBeLessThanOrEqual(4);
    expect(resolveNeighbors.mock.calls.every((call) => call[3].aborted)).toBe(true);
    expect(run.stopReasons).toContain(stopReason);
    expect(run.results).toEqual([]);
    expect(run.status).toBe(stopReason === 'cancelled' ? 'cancelled' : 'complete');
  });

  it('keeps loaded directed searches useful during offline coverage without creating offline cards', async () => {
    const input = options(pathEdges, {
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream' },
    });
    const original = input.resolveNeighbors;
    input.resolveNeighbors = async (...args) => ({
      ...(await original(...args)),
      stopReason: 'offline',
    });
    const run = await runConnectionScan(input);
    expect(run.stopReasons).toContain('offline');
    expect(run.results.some((result) => result.relationship === 'direct')).toBe(true);
    expect(run.results.every((result) => result.kind === 'connection')).toBe(true);
  });

  it('reserves primary finding capacity while counting omitted endpoints and issues', async () => {
    const progress = vi.fn();
    const run = await runConnectionScan(
      options([], {
        settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream', fanOut: 100 },
        onProgress: progress,
        resolveNeighbors: async (node) => {
          if (node === tx(1))
            return {
              nodeIds: [
                ...Array.from({ length: 13 }, (_, i) => out(1, i)),
                ...Array.from({ length: 13 }, (_, i) => out(1, i + 20)),
                out(1, 99),
              ],
            };
          if (node === tx(3)) return { nodeIds: [] };
          const index = Number(node.split(':')[2]);
          if (index < 13) return { nodeIds: [], observation: { finding: 'unspendable' } };
          if (index < 33)
            return {
              nodeIds: [],
              observation: { finding: 'lookup-failed', issueCode: 'lookup-failed' },
            };
          return { nodeIds: [tx(3)] };
        },
      }),
    );
    expect(run.results.filter((result) => result.kind === 'endpoint')).toHaveLength(
      SCAN_LIMITS.maxEndpointResults,
    );
    expect(run.results.filter((result) => result.finding === 'lookup-failed')).toHaveLength(
      SCAN_LIMITS.maxIssueResults,
    );
    expect(run.results.some((result) => result.relationship === 'direct')).toBe(true);
    expect(run.omittedResults).toEqual({ endpoints: 3, issues: 3 });
    expect(run.stopReasons).not.toContain('results');
    const snapshots = progress.mock.calls
      .map(([snapshot]) => snapshot.omittedResults)
      .filter(Boolean);
    expect(snapshots.some((snapshot) => snapshot.issues < 3)).toBe(true);
  });

  it('validates hard bounds, canonical ids and target caps without silent truncation', async () => {
    expect(DEFAULT_SCAN_SETTINGS.fanOut).toBe(SCAN_LIMITS.fanOut);
    expect(DEFAULT_SCAN_SETTINGS.fanOut).toBe(1000);
    expect(() =>
      validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, maxHops: SCAN_LIMITS.maxHops + 1 }),
    ).toThrow();
    expect(() => validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, fanOut: 0 })).toThrow();
    expect(() =>
      validateScanSettings({ ...DEFAULT_SCAN_SETTINGS, maxTransactions: NaN }),
    ).toThrow();
    expect(isScanNodeId(out(1))).toBe(true);
    expect(isScanNodeId(`${out(1)}0`)).toBe(false);
    expect(isScanNodeId(out(1, 0x100000000))).toBe(false);
    await expect(
      runConnectionScan(options([], { targetIds: Array(1001).fill(tx(3)) })),
    ).rejects.toThrow('Too many');
    await expect(runConnectionScan(options([], { source: 'addr:fixture' }))).rejects.toThrow();
    expect(new ScanBudgetExceeded('transactions').reason).toBe('transactions');
  });
});
