import type { GraphData } from '../../GraphState/types';

export const SMALL_AMOUNT_PRESETS = [
  0, 546, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000,
] as const;

/** A presentation preference, not a script-dependent relay policy or ownership signal. */
export function isSmallAmount(value: number | undefined, threshold = 0): boolean {
  return threshold > 0 && value !== undefined && value <= threshold;
}

function reachable(graph: GraphData, anchors: ReadonlySet<string>): Set<string> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const neighbors = new Map<string, string[]>();
  for (const { source, target } of graph.links) {
    if (!ids.has(source) || !ids.has(target)) continue;
    if (!neighbors.has(source)) neighbors.set(source, []);
    if (!neighbors.has(target)) neighbors.set(target, []);
    neighbors.get(source)!.push(target);
    neighbors.get(target)!.push(source);
  }
  const found = new Set([...anchors].filter((id) => ids.has(id)));
  const pending = [...found];
  while (pending.length)
    for (const neighbor of neighbors.get(pending.pop()!) ?? [])
      if (!found.has(neighbor)) {
        found.add(neighbor);
        pending.push(neighbor);
      }
  return found;
}

/** Hide isolated transaction/address scaffolding while a value filter is active. */
export function omitAmountOrphans<T extends GraphData>(graph: T, selectedId?: string): T {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const links = graph.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  const incident = new Set(links.flatMap((link) => [link.source, link.target]));
  return {
    ...graph,
    nodes: graph.nodes.filter(
      (node) => node.kind === 'output' || node.id === selectedId || incident.has(node.id),
    ),
    links,
  };
}

/**
 * Hide small outputs and automatic branches detached by their removal. Independent
 * transactions and the selection anchor separate investigations. Previously
 * disconnected components are not treated as descendants of another investigation.
 * This is projection only: cached observations and annotations remain untouched.
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
  const ids = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  const context = new Set(contextTransactionIds);
  const anchors = new Set(
    nodes
      .filter(
        (node) =>
          node.id === selectedId ||
          (node.kind === 'transaction' && !context.has(node.txid ?? node.id.slice(3))),
      )
      .map((node) => node.id),
  );
  const before = reachable(graph, anchors);
  const after = reachable({ nodes, links }, anchors);
  const retained = new Set(
    nodes.filter((node) => !before.has(node.id) || after.has(node.id)).map((node) => node.id),
  );
  const result = omitAmountOrphans(
    {
      nodes: nodes.filter((node) => retained.has(node.id)),
      links: links.filter((link) => retained.has(link.source) && retained.has(link.target)),
    },
    selectedId,
  );
  return {
    ...result,
    hiddenCount:
      graph.nodes.filter((node) => node.kind === 'output').length -
      result.nodes.filter((node) => node.kind === 'output').length,
  };
}
