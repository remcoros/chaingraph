import { formatBitcoinAmount } from './amountFormat';
import type { Annotation, GraphData, GraphNode } from './types';
import type { EntityVisibility } from './visibility';

export interface GraphFilters {
  tagId?: string;
  /** Any tag membership, independent of one chosen tag. */
  tagState?: 'all' | 'tagged' | 'untagged';
  /** Legacy single-wallet selection, retained for saved workspaces. */
  walletId?: string;
  /** Match any selected wallet; an empty list leaves wallet membership unrestricted. */
  walletIds?: string[];
  /** Derived wallet-address membership, never an ownership claim. */
  walletMatch?: 'all' | 'matched' | 'unmatched';
  query?: string;
  kind?: 'all' | GraphNode['kind'];
  label?: 'all' | 'labeled' | 'unlabeled';
  bookmarkedOnly?: boolean;
  minSats?: number;
  maxSats?: number;
  spend?: 'all' | 'observed' | 'unknown';
  funding?: 'all' | 'missing' | 'loaded';
  showAddresses?: boolean;
  focus?: { id: string; hops: 1 | 2 };
  preserveContext?: boolean;
  includeIds?: string[];
  /** Resolved membership exclusions; callers supply explicit identifiers only. */
  excludeIds?: string[];
}

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
      ![node.label, node.id, node.address, annotation?.label, annotation?.note]
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

export type EntitySort = 'graph' | 'label' | 'value-desc' | 'value-asc' | 'type';

/** Filter dimensions a person can see and remove individually. */
export type FilterKey =
  | 'query'
  | 'kind'
  | 'label'
  | 'tagState'
  | 'tagId'
  | 'walletMatch'
  | 'walletId'
  | 'bookmarkedOnly'
  | 'value'
  | 'spend'
  | 'funding'
  | 'focus'
  | 'includeIds'
  | 'preserveContext';

export interface FilterChip {
  key: FilterKey;
  label: string;
  /** Isolation and context are separate scope controls, not ordinary matches. */
  kind: 'match' | 'scope';
}

const kindNames: Record<string, string> = {
  transaction: 'Transactions',
  output: 'Outputs',
  address: 'Addresses',
};

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

export function activeFilterKeys(filters: GraphFilters): FilterKey[] {
  const keys: FilterKey[] = [];
  if (filters.query?.trim()) keys.push('query');
  if (filters.kind && filters.kind !== 'all') keys.push('kind');
  if (filters.label && filters.label !== 'all') keys.push('label');
  if (filters.tagState && filters.tagState !== 'all') keys.push('tagState');
  if (filters.tagId) keys.push('tagId');
  if (filters.walletMatch && filters.walletMatch !== 'all') keys.push('walletMatch');
  if (selectedWalletFilterIds(filters).length) keys.push('walletId');
  if (filters.bookmarkedOnly) keys.push('bookmarkedOnly');
  if (filters.minSats !== undefined || filters.maxSats !== undefined) keys.push('value');
  if (filters.spend && filters.spend !== 'all') keys.push('spend');
  if (filters.funding && filters.funding !== 'all') keys.push('funding');
  if (filters.focus) keys.push('focus');
  if (filters.includeIds) keys.push('includeIds');
  if (filters.preserveContext) keys.push('preserveContext');
  return keys;
}

export function hasActiveFilters(filters: GraphFilters): boolean {
  return activeFilterKeys(filters).length > 0;
}

/** Remove exactly one filter dimension. Manual entity hiding is never touched. */
export function clearFilterKey(filters: GraphFilters, key: FilterKey): GraphFilters {
  const next = { ...filters };
  if (key === 'value') {
    delete next.minSats;
    delete next.maxSats;
  } else if (key === 'walletId') {
    delete next.walletId;
    delete next.walletIds;
  } else delete next[key];
  return next;
}

export function activeFilterChips(
  filters: GraphFilters,
  names: { walletName?: string; walletNames?: string[]; tagName?: string } = {},
): FilterChip[] {
  return activeFilterKeys(filters).map((key): FilterChip => {
    switch (key) {
      case 'query':
        return {
          key,
          kind: 'match',
          label: `Search: ${
            filters.query!.trim().length > 22
              ? `${filters.query!.trim().slice(0, 20)}…`
              : filters.query!.trim()
          }`,
        };
      case 'kind':
        return { key, kind: 'match', label: `Type: ${kindNames[filters.kind!] ?? filters.kind}` };
      case 'label':
        return {
          key,
          kind: 'match',
          label: filters.label === 'labeled' ? 'Has a label' : 'No label',
        };
      case 'tagState':
        return {
          key,
          kind: 'match',
          label: filters.tagState === 'tagged' ? 'Has any tag' : 'No tags',
        };
      case 'tagId':
        return { key, kind: 'match', label: `Tag: ${names.tagName ?? 'Removed tag'}` };
      case 'walletMatch':
        return {
          key,
          kind: 'match',
          label: filters.walletMatch === 'matched' ? 'Wallet match' : 'No wallet match',
        };
      case 'walletId': {
        const ids = selectedWalletFilterIds(filters);
        const labels = ids.map(
          (_, index) =>
            names.walletNames?.[index] ??
            (ids.length === 1 ? names.walletName : undefined) ??
            'Removed wallet',
        );
        return {
          key,
          kind: 'match',
          label: `${ids.length === 1 ? 'Wallet' : 'Wallets'}: ${labels.join(', ')}`,
        };
      }
      case 'bookmarkedOnly':
        return { key, kind: 'match', label: 'Bookmarked' };
      case 'value':
        return {
          key,
          kind: 'match',
          label:
            filters.minSats !== undefined && filters.maxSats !== undefined
              ? `${formatBitcoinAmount(filters.minSats)} – ${formatBitcoinAmount(filters.maxSats)}`
              : filters.minSats !== undefined
                ? `Min ${formatBitcoinAmount(filters.minSats)}`
                : `Max ${formatBitcoinAmount(filters.maxSats)}`,
        };
      case 'spend':
        return {
          key,
          kind: 'match',
          label: filters.spend === 'observed' ? 'Loaded spend' : 'No loaded spend',
        };
      case 'funding':
        return {
          key,
          kind: 'match',
          label: filters.funding === 'missing' ? 'Missing funding' : 'Funding loaded',
        };
      case 'focus':
        return {
          key,
          kind: 'scope',
          label: `${filters.focus!.hops} ${filters.focus!.hops === 1 ? 'hop' : 'hops'} from selection`,
        };
      case 'includeIds':
        return {
          key,
          kind: 'scope',
          label: `Isolated ${filters.includeIds!.length.toLocaleString('en-US')} entities`,
        };
      default:
        return { key, kind: 'scope', label: 'Neighboring nodes included' };
    }
  });
}

/** Exact wording for a batch scope, for example "28 matching outputs". */
export function describeMatchScope(nodes: readonly GraphNode[]): string {
  const kinds = new Set(nodes.map((node) => node.kind));
  const [single, plural] =
    kinds.size === 1
      ? {
          transaction: ['transaction', 'transactions'],
          output: ['output', 'outputs'],
          address: ['address', 'addresses'],
        }[[...kinds][0]]
      : ['entity', 'entities'];
  return `${nodes.length.toLocaleString('en-US')} matching ${nodes.length === 1 ? single : plural}`;
}

export function sortEntities(nodes: GraphNode[], sort: EntitySort): GraphNode[] {
  if (sort === 'graph') return nodes;
  return [...nodes].sort((a, b) => {
    if (sort === 'value-asc' || sort === 'value-desc') {
      if (a.value === undefined && b.value !== undefined) return 1;
      if (b.value === undefined && a.value !== undefined) return -1;
      const difference = (a.value ?? 0) - (b.value ?? 0);
      if (difference) return sort === 'value-asc' ? difference : -difference;
    }
    if (sort === 'type') {
      const difference = a.kind.localeCompare(b.kind);
      if (difference) return difference;
    }
    return a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id);
  });
}
