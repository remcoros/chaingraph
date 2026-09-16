/** Persisted and transient filters applied to the Graph workspace. */
export interface GraphFilters {
  tagId?: string;
  tagState?: 'all' | 'tagged' | 'untagged';
  walletId?: string;
  walletIds?: string[];
  walletMatch?: 'all' | 'matched' | 'unmatched';
  query?: string;
  kind?: 'all' | 'transaction' | 'output' | 'address';
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
  excludeIds?: string[];
}
