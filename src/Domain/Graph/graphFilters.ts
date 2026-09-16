import type { Annotation, GraphData, GraphFilters, GraphNode } from '../types';
import type { EntityVisibility } from './visibility';

export interface FilteredGraph extends GraphData {
  matchedNodes: GraphNode[];
  contextNodeIds: string[];
  /** Exact extra loaded one-hop nodes, present when context is enabled or previewed. */
  availableContextNodeCount?: number;
}

export interface GraphFilterIndex {
  readonly graph: GraphData;
  readonly neighbors: ReadonlyMap<string, ReadonlySet<string>>;
  readonly spentIds: ReadonlySet<string>;
  readonly fundedIds: ReadonlySet<string>;
}

/** Reuse for one immutable graph projection; topology is built only when a filter needs it. */
export function buildGraphFilterIndex(graph: GraphData): GraphFilterIndex {
  let nodeIds: Set<string> | undefined;
  let neighbors: Map<string, Set<string>> | undefined;
  let evidence: { spentIds: Set<string>; fundedIds: Set<string> } | undefined;
  const validLink = (source: string, target: string) => {
    nodeIds ??= new Set(graph.nodes.map((node) => node.id));
    return nodeIds.has(source) && nodeIds.has(target);
  };
  const getEvidence = () => {
    if (!evidence) {
      evidence = { spentIds: new Set(), fundedIds: new Set() };
      for (const link of graph.links) {
        if (!validLink(link.source, link.target)) continue;
        if (link.kind === 'spends') evidence.spentIds.add(link.source);
        if (link.kind === 'creates') evidence.fundedIds.add(link.target);
      }
    }
    return evidence;
  };
  return {
    graph,
    get neighbors() {
      if (!neighbors) {
        neighbors = new Map();
        for (const link of graph.links) {
          if (!validLink(link.source, link.target)) continue;
          if (!neighbors.has(link.source)) neighbors.set(link.source, new Set());
          if (!neighbors.has(link.target)) neighbors.set(link.target, new Set());
          neighbors.get(link.source)!.add(link.target);
          neighbors.get(link.target)!.add(link.source);
        }
      }
      return neighbors;
    },
    get spentIds() {
      return getEvidence().spentIds;
    },
    get fundedIds() {
      return getEvidence().fundedIds;
    },
  };
}

/** Explicit multi-selection takes precedence over an older saved single selection. */
export function selectedWalletFilterIds(filters: GraphFilters): string[] {
  return [...new Set(filters.walletIds ?? (filters.walletId ? [filters.walletId] : []))];
}

/** Resolve the union of derived-script matches; callers intersect other filter dimensions. */
export function matchingWalletFilterNodeIds(
  filters: GraphFilters,
  matches: ReadonlyMap<string, { walletIds: string[] }>,
): string[] | undefined {
  const selected = new Set(selectedWalletFilterIds(filters));
  if (!selected.size) return undefined;
  return [...matches]
    .filter(([, match]) => match.walletIds.some((id) => selected.has(id)))
    .map(([nodeId]) => nodeId);
}

export function valueFilterError(filters: GraphFilters): string | undefined {
  for (const value of [filters.minSats, filters.maxSats]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < 0 || value > 2_100_000_000_000_000)
    )
      return 'Enter whole satoshi amounts between 0 and 2,100,000,000,000,000.';
  }
  if (
    filters.minSats !== undefined &&
    filters.maxSats !== undefined &&
    filters.minSats > filters.maxSats
  )
    return 'Minimum value must not exceed maximum value.';
}

/** Filters observations in a loaded snapshot, never inferring chain-wide spend status. */
export function filterGraph(
  graph: GraphData,
  filters: GraphFilters = {},
  annotations: Record<string, Annotation> = {},
  visibility: { hiddenNodeIds?: readonly string[]; mode?: EntityVisibility } = {},
  options: { index?: GraphFilterIndex; previewContext?: boolean } = {},
): FilteredGraph {
  if (valueFilterError(filters))
    return {
      nodes: [],
      links: [],
      matchedNodes: [],
      contextNodeIds: [],
      ...(options.previewContext || filters.preserveContext
        ? { availableContextNodeCount: 0 }
        : {}),
    };
  const hidden = new Set(visibility.hiddenNodeIds ?? []);
  const mode = visibility.mode ?? 'visible';
  const visible = new Set(
    graph.nodes
      .filter(
        (node) =>
          (filters.showAddresses !== false || node.kind !== 'address') &&
          (mode === 'all' || hidden.has(node.id) === (mode === 'hidden')),
      )
      .map((node) => node.id),
  );
  const index = options.index?.graph === graph ? options.index : buildGraphFilterIndex(graph);
  const spent = filters.spend && filters.spend !== 'all' ? index.spentIds : undefined;
  const funded = filters.funding && filters.funding !== 'all' ? index.fundedIds : undefined;
  let allowed = visible;
  if (filters.focus) {
    const neighbors = index.neighbors;
    const { id, hops } = filters.focus;
    allowed = new Set(visible.has(id) ? [id] : []);
    let frontier = [...allowed];
    for (let hop = 0; hop < Math.min(2, Math.max(0, hops)); hop++) {
      const next: string[] = [];
      for (const nodeId of frontier)
        for (const neighbor of neighbors.get(nodeId) ?? []) {
          if (visible.has(neighbor) && !allowed.has(neighbor)) {
            allowed.add(neighbor);
            next.push(neighbor);
          }
        }
      frontier = next;
    }
  }
  const query = filters.query?.trim().toLocaleLowerCase();
  const included = filters.includeIds ? new Set(filters.includeIds) : undefined;
  const excluded = filters.excludeIds ? new Set(filters.excludeIds) : undefined;
  const matchedNodes = graph.nodes.filter((node) => {
    if (included && !included.has(node.id)) return false;
    if (excluded?.has(node.id)) return false;
    if (
      !allowed.has(node.id) ||
      (filters.kind && filters.kind !== 'all' && node.kind !== filters.kind)
    )
      return false;
    const annotation = annotations[node.id];
    if (
      query &&
      ![
        [annotation?.icon, annotation?.label || node.label].filter(Boolean).join(' '),
        node.id,
        node.address,
        annotation?.label,
        annotation?.note,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    const labeled = Boolean(annotation?.label.trim());
    if ((filters.label === 'labeled' && !labeled) || (filters.label === 'unlabeled' && labeled))
      return false;
    if (filters.bookmarkedOnly && !annotation?.bookmarked) return false;
    if (filters.minSats !== undefined && (node.value === undefined || node.value < filters.minSats))
      return false;
    if (filters.maxSats !== undefined && (node.value === undefined || node.value > filters.maxSats))
      return false;
    if (filters.spend && filters.spend !== 'all') {
      if (node.kind !== 'output' || (filters.spend === 'observed') !== spent!.has(node.id))
        return false;
    }
    if (filters.funding && filters.funding !== 'all') {
      const missing = !funded!.has(node.id) || node.value === undefined;
      if (node.kind !== 'output' || (filters.funding === 'missing') !== missing) return false;
    }
    return true;
  });
  const matches = new Set(matchedNodes.map((node) => node.id));
  const previewContext = options.previewContext || filters.preserveContext;
  const context = new Set<string>();
  // Visit original matches only. A high-fan-out neighbor must not start a second hop.
  // A single edge pass avoids allocating adjacency sets for ordinary filtering/context.
  if (previewContext && matches.size && matches.size < allowed.size) {
    for (const link of graph.links) {
      if (matches.has(link.source) && !matches.has(link.target) && allowed.has(link.target))
        context.add(link.target);
      if (matches.has(link.target) && !matches.has(link.source) && allowed.has(link.source))
        context.add(link.source);
    }
  }
  const contextNodeIds = filters.preserveContext ? [...context] : [];
  const retained = contextNodeIds.length ? new Set([...matches, ...contextNodeIds]) : matches;
  return {
    nodes: contextNodeIds.length
      ? graph.nodes.filter((node) => retained.has(node.id))
      : matchedNodes,
    links: graph.links.filter((link) => retained.has(link.source) && retained.has(link.target)),
    matchedNodes,
    contextNodeIds,
    ...(previewContext ? { availableContextNodeCount: context.size } : {}),
  };
}

/** Intersect explicit identifier lists; undefined entries mean "no restriction". */
export function intersectIds(
  sets: readonly (readonly string[] | undefined)[],
): string[] | undefined {
  let result: string[] | undefined;
  for (const set of sets) {
    if (!set) continue;
    if (!result) {
      result = [...new Set(set)];
      continue;
    }
    const allowed = new Set(set);
    result = result.filter((id) => allowed.has(id));
  }
  return result;
}
