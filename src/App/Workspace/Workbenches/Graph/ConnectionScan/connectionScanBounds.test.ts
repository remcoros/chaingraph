import { describe, expect, it } from 'vitest';
import { DEFAULT_SCAN_SETTINGS, runConnectionScan, SCAN_LIMITS } from './connectionScan';
import type { ConnectionScanOptions, ScanRun } from './connectionScan';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${hash(n)}`;
const out = (n: number, vout = 0) => `out:${hash(n)}:${vout}`;

// Each branch consumes its own output of transaction 1. No double spends.
function ancestry(targetCount = 4): ConnectionScanOptions {
  const edges: [string, string][] = [];
  for (let branch = 0; branch <= targetCount; branch++) {
    edges.push(
      [tx(1), out(1, branch)],
      [out(1, branch), tx(branch + 2)],
      [tx(branch + 2), out(branch + 2)],
    );
  }
  return {
    id: 'bounded-meetings',
    source: out(2),
    targetIds: Array.from({ length: targetCount }, (_, index) => out(index + 3)),
    displayedNodeIds: [
      out(2),
      ...Array.from({ length: targetCount }, (_, index) => out(index + 3)),
    ],
    settings: {
      ...DEFAULT_SCAN_SETTINGS,
      direction: 'upstream',
      maxHops: 3,
      maxTransactions: 1000,
      maxMilliseconds: 60_000,
      fanOut: 100,
    },
    resolveNeighbors: async (node, direction) => ({
      nodeIds: edges
        .filter((edge) => edge[direction === 'upstream' ? 1 : 0] === node)
        .map((edge) => edge[direction === 'upstream' ? 0 : 1]),
    }),
  };
}
const connections = (run: ScanRun) => run.results.filter((result) => result.kind === 'connection');

describe('connection reconstruction boundaries', () => {
  it('keeps useful discoveries when a later lookup exhausts the shared transaction allowance', async () => {
    const request = ancestry();
    request.settings.maxTransactions = 10;
    const resolve = request.resolveNeighbors;
    let discovered = 0;
    let forcedBudgetStop = false;
    request.onProgress = (run) => {
      discovered = connections(run).length;
    };
    request.resolveNeighbors = async (...args) => {
      if (discovered >= 2) {
        forcedBudgetStop = true;
        for (let n = 100; n < 120; n++) args[2].examine(hash(n));
      }
      return resolve(...args);
    };
    const run = await runConnectionScan(request);
    expect(forcedBudgetStop).toBe(true);
    expect(connections(run).length).toBeGreaterThanOrEqual(2);
    expect(run.examined).toBe(10);
    expect(run.stopReasons).toContain('transactions');
    expect(run.results.every((result) => result.kind === 'connection')).toBe(true);
  });

  it('retains published paths when the deadline arrives during meeting reconstruction', async () => {
    const request = ancestry();
    let now = 0;
    request.now = () => now;
    request.onProgress = (run) => {
      if (connections(run).length === 2) now = request.settings.maxMilliseconds;
    };
    const run = await runConnectionScan(request);
    expect(connections(run)).toHaveLength(2);
    expect(run.stopReasons).toContain('time');
    expect(run.results.every((result) => result.kind === 'connection')).toBe(true);
  });

  it('never reconstructs through a target branch boundary while other roots remain searchable', async () => {
    const request = ancestry();
    request.settings.fanOut = 2;
    const resolve = request.resolveNeighbors;
    request.resolveNeighbors = async (...args) =>
      args[0] === tx(3)
        ? {
            nodeIds: [out(1, 1), out(99)],
            stopReason: 'fan-out',
            observation: { finding: 'many-inputs', branchCount: 2 },
          }
        : resolve(...args);
    const run = await runConnectionScan(request);
    expect(run.stopReasons).toContain('fan-out');
    expect(
      connections(run)
        .map((result) => result.endpoint)
        .sort(),
    ).toEqual([out(4), out(5), out(6)]);
    expect(run.results.every((result) => !result.path.includes(out(99)))).toBe(true);
  });

  it('isolates an unavailable target branch without inventing a connection or stopping other roots', async () => {
    const request = ancestry();
    const resolve = request.resolveNeighbors;
    request.resolveNeighbors = async (...args) =>
      args[0] === tx(3)
        ? {
            nodeIds: [],
            stopReason: 'unknown',
            observation: { finding: 'transaction-unavailable' },
          }
        : resolve(...args);
    const run = await runConnectionScan(request);
    expect(run.stopReasons).toContain('unknown');
    expect(
      connections(run)
        .map((result) => result.endpoint)
        .sort(),
    ).toEqual([out(4), out(5), out(6)]);
  });

  it('shares the result cap across reconstructed target paths and never serializes traversal edges', async () => {
    const request = ancestry(70);
    let largestSnapshot = 0;
    request.onProgress = (run) => {
      largestSnapshot = Math.max(largestSnapshot, run.results.length);
    };
    const run = await runConnectionScan(request);
    expect(connections(run)).toHaveLength(SCAN_LIMITS.maxResults);
    expect(largestSnapshot).toBe(SCAN_LIMITS.maxResults);
    expect(run.stopReasons).toContain('results');
    expect(run.examined).toBeLessThanOrEqual(request.settings.maxTransactions);
    expect(JSON.stringify(run)).not.toMatch(/predecessors|successors|visited|queue/);
    for (const result of connections(run)) {
      expect(new Set(result.path).size).toBe(result.path.length);
      expect(result.hops).toBe(3);
      expect(result.path[0]).toBe(request.source);
      expect(request.targetIds).toContain(result.endpoint);
    }
  });
});
