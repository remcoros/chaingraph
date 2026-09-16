import { GRAPH_SNAPSHOT_NODE_LIMIT, type GraphSnapshot } from '../../../GraphState/graphSnapshot';

export type { GraphSnapshot };

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
