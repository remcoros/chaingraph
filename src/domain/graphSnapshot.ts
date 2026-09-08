import { z } from 'zod';

export const GRAPH_SNAPSHOT_NODE_LIMIT = 50_000;
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const point = z.object({ x: coordinate, y: coordinate, z: coordinate });
export const graphSnapshotSchema = z.object({
  version: z.literal(1),
  dimensions: z.union([z.literal(2), z.literal(3)]),
  camera: z
    .object({ position: point, target: point, up: point })
    .refine(
      ({ position, target, up }) =>
        Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z) > 0.001 &&
        Math.hypot(up.x, up.y, up.z) > 0.001,
      'Invalid camera orientation',
    ),
  nodes: z
    .array(point.extend({ id: z.string().min(1).max(200) }))
    .max(GRAPH_SNAPSHOT_NODE_LIMIT)
    .refine(
      (nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length,
      'Duplicate graph positions',
    ),
});

/** Geometry only: no renderer objects, annotations, Bitcoin data or actions. */
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;

/** A filtered view must not discard coordinates for temporarily hidden nodes. */
export function mergeGraphSnapshot(
  previous: GraphSnapshot | undefined,
  next: GraphSnapshot,
): GraphSnapshot {
  const nodes = new Map(next.nodes.map((node) => [node.id, node]));
  if (previous?.dimensions === next.dimensions) {
    for (const node of previous.nodes) {
      if (nodes.size >= GRAPH_SNAPSHOT_NODE_LIMIT) break;
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    }
  }
  return { ...next, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
