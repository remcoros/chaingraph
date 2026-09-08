import type { GraphData } from './types';

export const SMALL_AMOUNT_PRESETS = [0, 546, 1_000, 10_000, 100_000] as const;

/** A presentation preference, not a script-dependent relay policy or ownership signal. */
export function isSmallAmount(value: number | undefined, threshold = 0): boolean {
  return threshold > 0 && value !== undefined && value < threshold;
}

/**
 * Remove known small outputs before context expansion. Never discard observations.
 * contextTransactionIds contains raw transaction IDs loaded automatically for context.
 * These nodes are omitted only when this amount filter removes every incident edge.
 */
export function filterSmallAmounts(
  graph: GraphData,
  threshold = 0,
  selectedId?: string,
  contextTransactionIds: readonly string[] = [],
): GraphData & { hiddenCount: number } {
  if (!threshold) return { ...graph, hiddenCount: 0 };
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const nodes = graph.nodes.filter(
    (node) =>
      node.kind !== 'output' ||
      node.id === selectedId ||
      (selected?.kind === 'address' && !!selected.address && selected.address === node.address) ||
      !isSmallAmount(node.value, threshold),
  );
  const hiddenCount = graph.nodes.length - nodes.length;
  const ids = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  if (!hiddenCount || !contextTransactionIds.length) return { nodes, links, hiddenCount };
  const context = new Set(contextTransactionIds);
  const originalIds = new Set(graph.nodes.map((node) => node.id));
  const originalIncident = new Set<string>();
  for (const link of graph.links) {
    if (!originalIds.has(link.source) || !originalIds.has(link.target)) continue;
    originalIncident.add(link.source);
    originalIncident.add(link.target);
  }
  const retainedIncident = new Set<string>();
  for (const link of links) {
    retainedIncident.add(link.source);
    retainedIncident.add(link.target);
  }
  return {
    nodes: nodes.filter(
      (node) =>
        node.kind !== 'transaction' ||
        node.id === selectedId ||
        !context.has(node.txid ?? node.id.slice(3)) ||
        !originalIncident.has(node.id) ||
        retainedIncident.has(node.id),
    ),
    // Pruned transactions have no retained incident links, so no second edge pass is needed.
    links,
    hiddenCount,
  };
}
