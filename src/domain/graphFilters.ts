import type { Annotation, GraphData, GraphNode } from './types';
import type { EntityVisibility } from './visibility';

export interface GraphFilters {
  tagId?: string;
  /** Any tag membership, independent of one chosen tag. */
  tagState?: 'all' | 'tagged' | 'untagged';
  walletId?: string;
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
): FilteredGraph {
  if (valueFilterError(filters))
    return { nodes: [], links: [], matchedNodes: [], contextNodeIds: [] };
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
  const neighbors = new Map<string, Set<string>>();
  const spent = new Set<string>();
  const funded = new Set<string>();
  const allIds = new Set(graph.nodes.map((node) => node.id));
  for (const link of graph.links) {
    if (!allIds.has(link.source) || !allIds.has(link.target)) continue;
    if (link.kind === 'spends') spent.add(link.source);
    if (link.kind === 'creates') funded.add(link.target);
    if (!visible.has(link.source) || !visible.has(link.target)) continue;
    if (!neighbors.has(link.source)) neighbors.set(link.source, new Set());
    if (!neighbors.has(link.target)) neighbors.set(link.target, new Set());
    neighbors.get(link.source)!.add(link.target);
    neighbors.get(link.target)!.add(link.source);
  }
  let allowed = visible;
  if (filters.focus) {
    const { id, hops } = filters.focus;
    allowed = new Set(visible.has(id) ? [id] : []);
    let frontier = [...allowed];
    for (let hop = 0; hop < Math.min(2, Math.max(0, hops)); hop++) {
      const next: string[] = [];
      for (const nodeId of frontier)
        for (const neighbor of neighbors.get(nodeId) ?? []) {
          if (!allowed.has(neighbor)) {
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
      if (node.kind !== 'output' || (filters.spend === 'observed') !== spent.has(node.id))
        return false;
    }
    if (filters.funding && filters.funding !== 'all') {
      const missing = !funded.has(node.id) || node.value === undefined;
      if (node.kind !== 'output' || (filters.funding === 'missing') !== missing) return false;
    }
    return true;
  });
  const matches = new Set(matchedNodes.map((node) => node.id));
  const retained = new Set(matches);
  if (filters.preserveContext)
    for (const id of matches)
      for (const neighbor of neighbors.get(id) ?? []) {
        if (allowed.has(neighbor)) retained.add(neighbor);
      }
  return {
    nodes: graph.nodes.filter((node) => retained.has(node.id)),
    links: graph.links.filter((link) => retained.has(link.source) && retained.has(link.target)),
    matchedNodes,
    contextNodeIds: [...retained].filter((id) => !matches.has(id)),
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
  if (filters.walletId) keys.push('walletId');
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
  } else delete next[key];
  return next;
}

export function activeFilterChips(
  filters: GraphFilters,
  names: { walletName?: string; tagName?: string } = {},
): FilterChip[] {
  const value = (amount?: number) => (amount === undefined ? '' : amount.toLocaleString('en-US'));
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
      case 'walletId':
        return { key, kind: 'match', label: `Wallet: ${names.walletName ?? 'Removed wallet'}` };
      case 'bookmarkedOnly':
        return { key, kind: 'match', label: 'Bookmarked' };
      case 'value':
        return {
          key,
          kind: 'match',
          label:
            filters.minSats !== undefined && filters.maxSats !== undefined
              ? `${value(filters.minSats)}–${value(filters.maxSats)} sats`
              : filters.minSats !== undefined
                ? `Min ${value(filters.minSats)} sats`
                : `Max ${value(filters.maxSats)} sats`,
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
        return { key, kind: 'scope', label: 'Connected context shown' };
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
