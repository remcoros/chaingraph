import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
  type ScanNeighbors,
} from '../src/Domain/ConnectionScan/connectionScan';

const hash = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${hash(n)}`;
const out = (n: number, vout = 0) => `out:${hash(n)}:${vout}`;

describe('parallel connection exploration', () => {
  it('keeps a connection from an admitted lookup after a peer exhausts the transaction budget', async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = await runConnectionScan({
      id: 'budget-drain',
      source: out(1),
      targetIds: [tx(2)],
      displayedNodeIds: [out(1), tx(2)],
      knownLinks: [],
      settings: {
        ...DEFAULT_SCAN_SETTINGS,
        direction: 'downstream',
        maxTransactions: 2,
      },
      resolveNeighbors: async (id, _direction, budget) => {
        if (id === out(1)) {
          await ready;
          return { nodeIds: [tx(2)] };
        }
        try {
          budget.examine(hash(3));
        } finally {
          setTimeout(release, 0);
        }
        return { nodeIds: [] };
      },
    });
    expect(run.examined).toBe(2);
    expect(run.stopReasons).toContain('transactions');
    expect(
      run.results.some((result) => result.kind === 'connection' && result.endpoint === tx(2)),
    ).toBe(true);
  });

  it('publishes a fast connection while another direction is blocked, then cancels that lookup', async () => {
    const controller = new AbortController();
    let waiting = false;
    let aborted = false;
    let foundWhileWaiting = false;
    const run = await runConnectionScan({
      id: 'parallel',
      source: tx(1),
      targetIds: [tx(3)],
      displayedNodeIds: [tx(1), tx(3)],
      settings: { ...DEFAULT_SCAN_SETTINGS, maxHops: 3 },
      signal: controller.signal,
      resolveNeighbors: async (id, direction, _budget, signal) => {
        if (id === tx(1) && direction === 'upstream') {
          waiting = true;
          return new Promise<ScanNeighbors>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        }
        const edges = [
          [tx(1), out(1)],
          [out(1), tx(2)],
          [tx(2), out(2)],
          [out(2), tx(3)],
        ];
        return {
          nodeIds: edges
            .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === id)
            .map((edge) => edge[direction === 'downstream' ? 1 : 0]!),
        };
      },
      onProgress: (snapshot) => {
        if (snapshot.results.some((result) => result.kind === 'connection')) {
          foundWhileWaiting ||= waiting && !aborted;
          controller.abort();
        }
      },
    });
    expect(foundWhileWaiting).toBe(true);
    expect(aborted).toBe(true);
    expect(run.status).toBe('cancelled');
    expect(
      run.results.some((result) => result.relationship === 'direct' && result.endpoint === tx(3)),
    ).toBe(true);
    expect(run.deepestHop).toBeGreaterThan(0);
  });

  it('bounds the window and never advances a front past an unresolved breadth level', async () => {
    const controller = new AbortController();
    let active = 0;
    let maximum = 0;
    let released = false;
    const starts: string[] = [];
    let releaseSlow!: () => void;
    let signalWindow!: () => void;
    const windowFull = new Promise<void>((resolve) => {
      signalWindow = resolve;
    });
    const signals: AbortSignal[] = [];
    const pending = runConnectionScan({
      id: 'bounded-window',
      source: tx(1),
      targetIds: [],
      displayedNodeIds: [tx(1)],
      settings: { ...DEFAULT_SCAN_SETTINGS, direction: 'downstream', maxHops: 2 },
      signal: controller.signal,
      resolveNeighbors: async (id, _direction, _budget, signal) => {
        starts.push(id);
        if (id === tx(1))
          return { nodeIds: [out(1, 0), out(1, 1), out(1, 2), out(1, 3), out(1, 4)] };
        if (id.startsWith('tx:')) {
          expect(released).toBe(true);
          return { nodeIds: [] };
        }
        active++;
        maximum = Math.max(maximum, active);
        signals.push(signal);
        if (active === 4) signalWindow();
        const vout = Number(id.split(':')[2]);
        if (vout === 0)
          await new Promise<void>((resolve) => {
            releaseSlow = resolve;
          });
        else await windowFull;
        active--;
        return { nodeIds: [tx(vout + 2)] };
      },
    });
    await windowFull;
    // Let faster peers publish their results while the first outpoint stays pending.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toContain(out(1, 4));
    expect(starts.filter((id) => id.startsWith('tx:'))).toEqual([tx(1)]);
    released = true;
    releaseSlow();
    const run = await pending;
    expect(maximum).toBe(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(run.deepestHop).toBe(1);
    expect(run.examined).toBe(6);
    expect(run.stopReasons).toEqual([]);
  });
});
