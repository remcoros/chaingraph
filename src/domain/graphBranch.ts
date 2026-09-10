import type { GraphData } from './types';

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
