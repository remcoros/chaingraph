import { describe, expect, it } from 'vitest';
import {
  graphSnapshotSchema,
  type GraphSnapshot,
} from '../../../../../Domain/Workspace/graphSnapshotStorage';
import { mergeGraphSnapshot } from './graphSnapshot';
import { newWorkspace, parseWorkspace } from '../../../../../Domain/Workspace/workspace';

const snapshot: GraphSnapshot = {
  version: 1,
  dimensions: 3,
  camera: {
    position: { x: 10, y: -20, z: 350 },
    target: { x: 5, y: 5, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  },
  nodes: [
    { id: 'a', x: -12.25, y: 20, z: 40 },
    { id: 'b', x: 15, y: -40, z: -2 },
  ],
};

describe('encrypted graph-view data validation', () => {
  it('preserves optional view state through workspace validation', () => {
    const workspace = newWorkspace('Saved view', 'testnet4');
    expect(parseWorkspace(workspace).view.graphSnapshot).toBeUndefined();
    workspace.view = {
      ...workspace.view,
      graphSnapshot: snapshot,
      selectionId: 'a',
      filters: { query: 'Own coins', includeIds: ['a'], minSats: 10, focus: { id: 'a', hops: 2 } },
      panels: {
        left: { tab: 'tags', collapsed: true },
        right: { tab: 'inspect', collapsed: true },
        mobile: 'right',
        flow: {
          transactionId: '1'.repeat(64),
          expandedInputs: true,
          height: 'collapsed',
        },
      },
      selectedWallet: 'wallet',
      prefetchDepth: 1,
    };
    expect(parseWorkspace(workspace).view).toEqual(workspace.view);
    workspace.view.selectionId = undefined;
    expect(parseWorkspace(JSON.parse(JSON.stringify(workspace))).view.selectionId).toBeUndefined();
  });
  it('rejects non-finite, oversized and degenerate imported camera/position data', () => {
    for (const value of [NaN, Infinity, -Infinity, 10_000_001]) {
      expect(
        graphSnapshotSchema.safeParse({ ...snapshot, nodes: [{ ...snapshot.nodes[0], x: value }] })
          .success,
      ).toBe(false);
    }
    expect(
      graphSnapshotSchema.safeParse({
        ...snapshot,
        camera: { ...snapshot.camera, up: { x: 0, y: 0, z: 0 } },
      }).success,
    ).toBe(false);
    expect(
      graphSnapshotSchema.safeParse({
        ...snapshot,
        camera: { ...snapshot.camera, position: snapshot.camera.target },
      }).success,
    ).toBe(false);
    expect(
      graphSnapshotSchema.safeParse({ ...snapshot, nodes: [snapshot.nodes[0], snapshot.nodes[0]] })
        .success,
    ).toBe(false);
    expect(
      graphSnapshotSchema.safeParse({
        ...snapshot,
        nodes: [{ ...snapshot.nodes[0], id: 'x'.repeat(201) }],
      }).success,
    ).toBe(false);
    expect(
      graphSnapshotSchema.safeParse({
        ...snapshot,
        nodes: Array.from({ length: 50_001 }, (_, index) => ({
          ...snapshot.nodes[0],
          id: String(index),
        })),
      }).success,
    ).toBe(false);
  });
  it('keeps hidden geometry through filtered snapshots without mixing flat and 3D coordinates', () => {
    const next = { ...snapshot, nodes: [{ ...snapshot.nodes[0], x: 999 }] };
    expect(mergeGraphSnapshot(snapshot, next).nodes).toEqual([next.nodes[0], snapshot.nodes[1]]);
    expect(snapshot.nodes[0].x).toBe(-12.25);
    expect(mergeGraphSnapshot(snapshot, { ...next, dimensions: 2 }).nodes).toEqual(next.nodes);
  });
  it('rejects unbounded view filters and invalid transaction-flow references', () => {
    const workspace = newWorkspace('Invalid view', 'testnet4');
    for (const patch of [
      { filters: { minSats: -1 } },
      { filters: { focus: { id: 'a', hops: 3 } } },
      { filters: { query: 'x'.repeat(10001) } },
      { panels: { flow: { transactionId: 'not a txid' } } },
    ]) {
      expect(() =>
        parseWorkspace({ ...workspace, view: { ...workspace.view, ...patch } }),
      ).toThrow();
    }
  });
});
