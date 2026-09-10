import type { GraphData } from './types';

/** Terminal I/O has at most one distinct participating neighbor. Use membership
 * for removal or manual visibility for hiding, never a temporary filter result.
 * Address links count too, matching transaction removal's connection protection. */
export function graphUnconnectedOutputIds(
  graph: GraphData,
  participating: ReadonlySet<string>,
): Set<string> {
  const present = new Set(
    graph.nodes.filter((node) => participating.has(node.id)).map((node) => node.id),
  );
  const candidates = new Set(
    graph.nodes
      .filter((node) => node.kind === 'output' && present.has(node.id))
      .map((node) => node.id),
  );
  const firstNeighbor = new Map<string, string>();
  const connect = (id: string, neighbor: string) => {
    if (!candidates.has(id) || !present.has(neighbor) || id === neighbor) return;
    const first = firstNeighbor.get(id);
    if (first === undefined) firstNeighbor.set(id, neighbor);
    else if (first !== neighbor) candidates.delete(id);
  };
  for (const link of graph.links) {
    connect(link.source, link.target);
    connect(link.target, link.source);
  }
  return candidates;
}

/** Loaded input/output nodes directly attached to the supplied transactions.
 * No recursion: unrelated branches of their creating/spending transactions stay out. */
export function graphTransactionOutputIds(
  graph: GraphData,
  transactionIds: ReadonlySet<string>,
): Set<string> {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const outputs = new Set<string>();
  for (const link of graph.links) {
    if (
      transactionIds.has(link.source) &&
      kinds.get(link.source) === 'transaction' &&
      kinds.get(link.target) === 'output'
    )
      outputs.add(link.target);
    if (
      transactionIds.has(link.target) &&
      kinds.get(link.target) === 'transaction' &&
      kinds.get(link.source) === 'output'
    )
      outputs.add(link.source);
  }
  return outputs;
}

/** Include only newly orphaned I/O of requested transactions. Evaluate the whole
 * request together so shared outputs disappear only when every connection does.
 * Participating nodes express membership for removal, or manual visibility for hiding. */
export function graphRemovalClosure(
  graph: GraphData,
  participating: ReadonlySet<string>,
  requested: Iterable<string>,
): string[] {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const removed = new Set([...requested].filter((id) => participating.has(id)));
  const transactions = new Set([...removed].filter((id) => kinds.get(id) === 'transaction'));
  const candidates = new Set<string>();
  for (const link of graph.links) {
    if (
      transactions.has(link.source) &&
      participating.has(link.target) &&
      kinds.get(link.target) === 'output'
    )
      candidates.add(link.target);
    if (
      transactions.has(link.target) &&
      participating.has(link.source) &&
      kinds.get(link.source) === 'output'
    )
      candidates.add(link.source);
  }
  const survives = (id: string) => kinds.has(id) && participating.has(id) && !removed.has(id);
  for (const link of graph.links) {
    if (candidates.has(link.source) && survives(link.target)) candidates.delete(link.source);
    if (candidates.has(link.target) && survives(link.source)) candidates.delete(link.target);
  }
  for (const id of candidates) removed.add(id);
  // Stable membership order avoids an edge-order-dependent result without sorting.
  return [...participating].filter((id) => removed.has(id));
}

/** A transaction's removable local footprint retains every other participating connection. */
export function transactionGraphBranch(
  graph: GraphData,
  admitted: ReadonlySet<string>,
  transactionId: string,
): string[] {
  return graphRemovalClosure(graph, admitted, [transactionId]);
}
