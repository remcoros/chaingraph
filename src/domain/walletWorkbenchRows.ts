import { addressNodeId, outputNodeId, short, txNodeId, type Wallet, type Workspace } from './types';
import { listTagsForNode } from './tags';
import {
  listWalletAddresses,
  listWalletTransactions,
  type WalletUtxoRecord,
} from './walletRecords';
import { isCompletedReview, reviewKey, type WalletReviewItem } from './walletReview';
import {
  listLoadedAddressTransactionIds,
  walletCounterparties,
  type WalletAddressRelationships,
} from './walletRelationships';

export type WalletTab =
  'review' | 'utxos' | 'transactions' | 'addresses' | 'sources' | 'destinations';
export type WalletStatusFilter = 'all' | 'open' | 'later' | 'decided';
export function walletSelectAll(selected: readonly string[], results: readonly string[]) {
  const selectedSet = new Set(selected);
  const resultSet = new Set(results);
  const allSelected = results.length > 0 && results.every((id) => selectedSet.has(id));
  return {
    allSelected,
    next: allSelected ? selected.filter((id) => !resultSet.has(id)) : [...resultSet],
  };
}
export interface WalletRow {
  key: string;
  nodeId: string;
  identifier: string;
  title: string;
  description: string;
  kind: 'transaction' | 'output' | 'address';
  meta: string;
  amountSats?: number;
  address?: string;
  /** Creating transaction, used for exact related selection. */
  txid?: string;
  /** Explicit contexts, not a claim of common ownership or coin allocation. */
  contextTransactionIds: string[];
  outpointIds?: string[];
  relationshipDirection?: 'source' | 'destination';
  utxo?: WalletUtxoRecord;
  reviews: WalletReviewItem[];
  status: 'open' | 'later' | 'reviewed' | 'unknown';
  changed: boolean;
  ownership?: 'wallet' | 'external' | 'unknown';
}

export function walletRowTags(workspace: Workspace, row: WalletRow) {
  return listTagsForNode(workspace, {
    id: row.nodeId,
    kind: row.kind,
    label: '',
    address: row.address,
  });
}

export function walletRowWithContext(workspace: Workspace, row: WalletRow): WalletRow {
  return row.kind === 'address' && row.address && !row.relationshipDirection
    ? { ...row, contextTransactionIds: listLoadedAddressTransactionIds(workspace, row.address) }
    : row;
}

export function resolveWalletRow(
  rows: readonly WalletRow[],
  key?: string,
  previous?: WalletRow,
): WalletRow | undefined {
  const exact = rows.find((row) => row.key === (key ?? previous?.key));
  if (exact) return exact;
  if (previous?.kind === 'output' && !previous.address && (!key || key === previous.key)) {
    const resolved = rows.find(
      (row) => row.kind === 'address' && row.outpointIds?.includes(previous.nodeId),
    );
    if (resolved) return resolved;
  }
  return rows[0];
}

export function reviewRow(item: WalletReviewItem): WalletRow {
  const kind = item.nodeId.startsWith('tx:')
    ? 'transaction'
    : item.nodeId.startsWith('addr:')
      ? 'address'
      : 'output';
  return {
    key: item.key,
    nodeId: item.nodeId,
    identifier: item.nodeId.replace(/^(out|tx|addr):/, ''),
    title: item.title,
    description: item.detail,
    kind,
    meta: '',
    amountSats: item.amountSats,
    address: item.address,
    txid: item.nodeId.startsWith('addr:') ? undefined : item.nodeId.split(':')[1],
    contextTransactionIds:
      kind === 'address' ? (item.transactionIds ?? []) : item.txid ? [item.txid] : [],
    outpointIds: item.outpointIds,
    ownership: item.ownership,
    relationshipDirection:
      kind === 'address' && item.relationshipKinds?.length === 1
        ? item.relationshipKinds[0]
        : undefined,
    reviews: [item],
    status: item.status,
    changed: item.changed,
  };
}

export function buildWalletRelationshipRows(
  workspace: Workspace,
  groups: WalletAddressRelationships,
  items: readonly WalletReviewItem[],
): Record<'sources' | 'destinations', WalletRow[]> {
  const counterparties = walletCounterparties(groups);
  const project = (direction: 'source' | 'destination'): WalletRow[] => {
    const reason = direction === 'source' ? 'source-address' : 'destination-address';
    const addresses = direction === 'source' ? counterparties.sources : counterparties.destinations;
    const directionItems = items.filter((item) => item.reason === reason);
    return [
      ...addresses.map((group) =>
        decorateWalletRow(
          {
            key: group.id,
            nodeId: group.id,
            identifier: group.address,
            title: short(group.address, 12),
            kind: 'address',
            address: group.address,
            description: `${group.count} distinct observed outputs in ${group.transactionIds.length} one-hop transaction contexts. Labels, tags and review decisions apply to this address only. The observed total is not an allocated payment or balance.`,
            meta: `${group.count} outpoints · ${group.transactionIds.length} transactions`,
            contextTransactionIds: group.transactionIds,
            outpointIds: group.outpointIds,
            relationshipDirection: direction,
            ownership: group.ownership,
            amountSats: group.amountSats,
          },
          workspace,
          directionItems,
        ),
      ),
    ];
  };
  return { sources: project('source'), destinations: project('destination') };
}

export function decorateWalletRow(
  row: Omit<WalletRow, 'reviews' | 'status' | 'changed'>,
  workspace: Workspace,
  items: readonly WalletReviewItem[],
  fallbackReviewKey?: string,
): WalletRow {
  const reviews = items.filter((item) => item.nodeId === row.nodeId);
  const fallback = fallbackReviewKey ? workspace.walletReviews?.[fallbackReviewKey] : undefined;
  const changed = reviews.some((item) => item.changed);
  const status =
    changed || reviews.some((item) => item.status === 'open')
      ? 'open'
      : reviews.some((item) => item.status === 'later')
        ? 'later'
        : reviews.length
          ? reviews.every((item) => item.status === 'unknown')
            ? 'unknown'
            : 'reviewed'
          : (fallback?.status ?? 'open');
  return { ...row, reviews, status, changed };
}

export function buildWalletRecordRows(
  workspace: Workspace,
  wallet: Wallet,
  utxos: readonly WalletUtxoRecord[],
  reviewItems: readonly WalletReviewItem[],
  tab: 'utxos' | 'transactions' | 'addresses' | 'all' = 'all',
): Record<'utxos' | 'transactions' | 'addresses', WalletRow[]> {
  const byNode = new Map<string, WalletReviewItem[]>();
  for (const item of reviewItems) {
    const items = byNode.get(item.nodeId) ?? [];
    items.push(item);
    byNode.set(item.nodeId, items);
  }
  const decorate = (row: Omit<WalletRow, 'reviews' | 'status' | 'changed'>, key?: string) =>
    decorateWalletRow(row, workspace, byNode.get(row.nodeId) ?? [], key);
  return {
    utxos:
      tab === 'all' || tab === 'utxos'
        ? utxos.map((record) => {
            const identifier = `${record.txid}:${record.vout}`;
            const nodeId = outputNodeId(record.txid, record.vout);
            return decorate(
              {
                key: nodeId,
                nodeId,
                identifier,
                title: short(identifier, 12),
                description:
                  'Reported unspent at the last UTXO check. This is an observation, not a spendability guarantee.',
                kind: 'output',
                meta:
                  record.height > 0
                    ? `Block ${record.height.toLocaleString('en-US')}`
                    : 'Unconfirmed',
                amountSats: record.valueSats,
                address: record.address,
                txid: record.txid,
                contextTransactionIds: [record.txid],
                utxo: record,
                ownership: 'wallet',
              },
              reviewKey(wallet.id, 'current-utxo', identifier),
            );
          })
        : [],
    transactions:
      tab === 'all' || tab === 'transactions'
        ? listWalletTransactions(workspace, wallet).map((record) => {
            const nodeId = txNodeId(record.txid);
            return decorate(
              {
                key: nodeId,
                nodeId,
                identifier: record.txid,
                title: short(record.txid, 12),
                description: record.transaction
                  ? `${record.transaction.vin.length} inputs and ${record.transaction.vout.length} outputs. Wallet association does not make every input or output yours.`
                  : 'Reported in wallet history, but not loaded. Open in Graph to load this transaction.',
                kind: 'transaction',
                meta: record.mempool
                  ? 'Unconfirmed'
                  : record.height
                    ? `Block ${record.height.toLocaleString('en-US')}`
                    : 'Height unknown',
                txid: record.txid,
                contextTransactionIds: [record.txid],
              },
              reviewKey(wallet.id, 'new-activity', record.txid),
            );
          })
        : [],
    addresses:
      tab === 'all' || tab === 'addresses'
        ? listWalletAddresses(workspace, wallet).map((record) => {
            const nodeId = addressNodeId(record.address);
            return decorate({
              key: nodeId,
              nodeId,
              identifier: record.address,
              title: short(record.address, 12),
              description: `${record.loadedOutputCount} loaded outputs; ${record.history?.length ?? 0} history entries. Flow contexts require a verified loaded input or output match, not history membership alone.`,
              kind: 'address',
              address: record.address,
              meta: `${record.branch === 0 ? 'Receive' : 'Change'} ${record.index}`,
              contextTransactionIds: [],
              ownership: 'wallet',
            });
          })
        : [],
  };
}

export function matchesWalletStatus(row: WalletRow, filter: WalletStatusFilter): boolean {
  if (filter === 'all') return true;
  if (row.reviews.length && row.reviews.every((item) => item.legacyOutputReview)) {
    if (filter === 'open') return false;
    if (filter === 'later') return row.reviews.some((item) => item.status === 'later');
    return row.reviews.every(
      (item) => item.status !== 'open' && isCompletedReview({ status: item.status }),
    );
  }
  if (filter === 'open') return row.changed || row.status === 'open';
  if (filter === 'later') return !row.changed && row.status === 'later';
  return !row.changed && row.status !== 'open' && isCompletedReview({ status: row.status });
}
