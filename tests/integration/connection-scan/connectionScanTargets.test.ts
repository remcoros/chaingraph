import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCAN_SETTINGS,
  runConnectionScan,
} from '../../../src/App/Workspace/Workbenches/Graph/ConnectionScan/connectionScan';
import { prepareCustomScanTargets } from '../../../src/App/Workspace/Selection/connectionScanTargets';
const id = (n: number) => n.toString(16).padStart(64, '0');
const tx = (n: number) => `tx:${id(n)}`;
const out = (n: number, index = 0) => `out:${id(n)}:${index}`;

describe('custom scan targets', () => {
  it('keeps exactly the picked IDs, deduplicated without the source', () => {
    expect(
      prepareCustomScanTargets({
        pickedNodeIds: [tx(2), out(2), tx(2), out(1, 7), out(3, 1)],
        source: out(2),
      }),
    ).toEqual([tx(2), out(1, 7), out(3, 1)].sort());
  });

  it('picks an exact outpoint without requiring or expanding its creator', () => {
    expect(
      prepareCustomScanTargets({
        pickedNodeIds: [out(2, 150), out(2, 150)],
        source: tx(1),
      }),
    ).toEqual([out(2, 150)]);
  });

  it('counts a picked transaction once without inspecting or expanding its I/O', () => {
    // Preparation accepts IDs alone, regardless of how many inputs or outputs
    // the transaction has or whether its evidence has been loaded.
    expect(prepareCustomScanTargets({ pickedNodeIds: [tx(2)], source: tx(1) })).toEqual([tx(2)]);
  });

  it('allows an empty target set after excluding the source', () => {
    expect(prepareCustomScanTargets({ pickedNodeIds: [], source: tx(1) })).toEqual([]);
    expect(prepareCustomScanTargets({ pickedNodeIds: [tx(1), tx(1)], source: tx(1) })).toEqual([]);
  });

  it('accepts exactly 1,000 unique picks after source exclusion and rejects overflow', () => {
    const picked = Array.from({ length: 1000 }, (_, n) => out(2, n));
    expect(
      prepareCustomScanTargets({
        pickedNodeIds: [...picked, tx(1), picked[0]!],
        source: tx(1),
      }),
    ).toHaveLength(1000);
    expect(() =>
      prepareCustomScanTargets({
        pickedNodeIds: [...picked, tx(2)],
        source: tx(1),
      }),
    ).toThrow('at most 1,000 targets');
  });

  it('rejects malformed source and picked node IDs', () => {
    for (const picked of ['addr:unknown', out(2, -1), out(2, 0x100000000)]) {
      expect(() => prepareCustomScanTargets({ pickedNodeIds: [picked], source: tx(1) })).toThrow(
        'valid transactions or outputs',
      );
    }
    expect(() =>
      prepareCustomScanTargets({ pickedNodeIds: [tx(2)], source: 'addr:unknown' }),
    ).toThrow('Choose a transaction or output');
  });

  it('traverses hidden inputs to the picked transaction without making those inputs targets', async () => {
    const targetIds = prepareCustomScanTargets({
      pickedNodeIds: [tx(3)],
      source: tx(1),
    });
    const edges = [
      [tx(1), out(1)],
      [out(1), tx(2)],
      [tx(2), out(2, 7)],
      [out(2, 7), tx(3)],
    ];
    const run = await runConnectionScan({
      id: 'custom-targets',
      source: tx(1),
      targetIds,
      displayedNodeIds: [tx(1), tx(3)],
      settings: { ...DEFAULT_SCAN_SETTINGS, targetScope: 'custom', direction: 'downstream' },
      resolveNeighbors: async (id, direction) => ({
        nodeIds: edges
          .filter((edge) => edge[direction === 'downstream' ? 0 : 1] === id)
          .map((edge) => edge[direction === 'downstream' ? 1 : 0]),
      }),
    });
    expect(run.settings.targetScope).toBe('custom');
    expect(run.results).toContainEqual(
      expect.objectContaining({
        kind: 'connection',
        endpoint: tx(3),
        path: [tx(1), out(1), tx(2), out(2, 7), tx(3)],
      }),
    );
    expect(run.targetIds).toEqual([tx(3)]);
    expect(run.results.filter((result) => result.kind === 'connection')).toHaveLength(1);
  });
});
