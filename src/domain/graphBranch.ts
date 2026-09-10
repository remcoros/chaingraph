import type { GraphData } from './types';

/** Remove a transaction's local footprint, retaining outpoints shared with other admitted transactions. */
export function transactionGraphBranch(
  graph: GraphData,
  admitted: ReadonlySet<string>,
  transactionId: string,
): string[] {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const neighbors = new Set<string>();
  for (const link of graph.links) {
    if (link.source === transactionId && kinds.get(link.target) === 'output')
      neighbors.add(link.target);
    if (link.target === transactionId && kinds.get(link.source) === 'output')
      neighbors.add(link.source);
  }
  for (const link of graph.links) {
    if (
      kinds.get(link.source) === 'transaction' &&
      link.source !== transactionId &&
      admitted.has(link.source)
    )
      neighbors.delete(link.target);
    if (
      kinds.get(link.target) === 'transaction' &&
      link.target !== transactionId &&
      admitted.has(link.target)
    )
      neighbors.delete(link.source);
  }
  return [transactionId, ...neighbors].filter((id) => admitted.has(id));
}
