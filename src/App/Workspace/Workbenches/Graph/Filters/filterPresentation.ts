import { formatBitcoinAmount } from '../../../../../Core/Formatting';
import { selectedWalletFilterIds } from './graphFilters';
import type { GraphFilters } from '../../../../../Core/Workspace/view';
import type { GraphNode } from '../../../GraphState/types';

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
