import {
  addressReference,
  outpointReference,
  transactionReference,
} from '../../../../Core/Workspace/entityReferences';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { WalletPreparation } from '../../../../Core/Workspace/Wallets/walletPreparation';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import { short } from '../../../../Core/Formatting';
import {
  type Network,
  type TxOutput,
  isOpReturn,
  addressToScriptHash,
  sats,
} from '../../../../Core/Bitcoin';

import { listTagsForNode } from '../../../../Core/Workspace/Annotations/tagMembership';

import type {
  WalletSelectionAddresses,
  WalletSelectionIndex,
} from '../../../../Core/Workspace/Wallets/walletSelectionIndex';
import {
  verifiedWalletAddresses,
  listWalletAddresses,
  listWalletTransactions,
  type WalletUtxoRecord,
  type WalletTransactionRecord,
} from '../../../../Core/Workspace/Wallets/walletRecords';
import {
  isCompletedReview,
  reviewKey,
  type WalletReviewItem,
  type WalletReviewGroup,
} from '../../../../Core/Workspace/Wallets/walletReview';
import {
  listLoadedAddressTransactionIds,
  walletCounterparties,
  walletOutputEvidence,
  type WalletAddressRelationships,
} from '../../../../Core/Workspace/Wallets/walletRelationships';

export type WalletTab =
  'review' | 'utxos' | 'transactions' | 'counterparties' | 'addresses' | 'sources' | 'destinations';
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
  status: WalletReviewItem['status'];
  walletTransaction?: WalletTransactionRecord;
  changed: boolean;
  ownership?: 'wallet' | 'external' | 'unknown';
}

export function walletRowFindings(
  workspace: { analysis: Pick<Workspace['analysis'], 'findings'> },
  row: WalletRow,
) {
  const keys = new Set(
    row.reviews.filter((item) => item.kind === 'finding').map((item) => item.key),
  );
  return workspace.analysis.findings.filter((finding) =>
    [...keys].some((key) => key.endsWith(`|link|${finding.id}`)),
  );
}

/** An exact loaded output can be opened from its transaction even after it is spent. */
export function walletLinkedOutputRow(
  workspace: Pick<Workspace, 'network'>,
  id: string,
  index: Pick<WalletSelectionIndex, 'prevouts' | 'spendingTransactionIds'>,
  walletAddresses: Pick<WalletSelectionAddresses, 'scripthashes'>,
  reviews: readonly WalletReviewItem[],
): WalletRow | undefined {
  const fact = index.prevouts.get(id.replace(/^out:/, ''));
  if (!id.startsWith('out:') || (fact?.status !== 'loaded' && fact?.status !== 'attached'))
    return undefined;
  const evidence = walletOutputEvidence(fact.output, workspace.network);
  const txid = id.slice(4, id.lastIndexOf(':'));
  const owned =
    evidence.scripthash !== undefined && walletAddresses.scripthashes.has(evidence.scripthash);
  return {
    key: id,
    nodeId: id,
    identifier: id.slice(4),
    title: owned ? 'Wallet coin' : 'Transaction output',
    description: '',
    kind: 'output',
    meta: index.spendingTransactionIds.has(id)
      ? 'Spent in loaded history'
      : 'Current spend state unknown',
    amountSats:
      Number.isFinite(fact.output.value) && fact.output.value >= 0
        ? sats(fact.output.value)
        : undefined,
    address: evidence.address,
    txid,
    contextTransactionIds: [txid, ...(index.spendingTransactionIds.get(id) ?? [])],
    reviews: reviews.filter((item) => item.nodeId === id),
    status: 'open',
    changed: false,
    ownership: owned ? 'wallet' : evidence.scripthash ? 'external' : 'unknown',
  };
}

export function walletRowTags(workspace: Workspace, row: WalletRow) {
  return listTagsForNode(workspace, {
    id: row.nodeId,
    kind: row.kind,
    address: row.address,
  });
}

export function walletRowWithContext(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  },
  row: WalletRow,
  index?: WalletSelectionIndex,
): WalletRow {
  if (row.kind !== 'address' || !row.address || row.relationshipDirection) return row;
  if (!index)
    return {
      ...row,
      contextTransactionIds: listLoadedAddressTransactionIds(workspace, row.address),
    };
  let ids: readonly string[] = [];
  try {
    ids = index.scriptTransactionIds.get(addressToScriptHash(row.address, workspace.network)) ?? [];
  } catch {
    // Invalid or wrong-network addresses cannot acquire transaction contexts.
  }
  return { ...row, contextTransactionIds: [...ids] };
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
    key: reviewProjectionKey(item),
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
      kind === 'address' || item.reason === 'link'
        ? (item.transactionIds ?? (item.txid ? [item.txid] : []))
        : item.txid
          ? [item.txid]
          : [],
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

export function reviewProjectionKey(item: Pick<WalletReviewItem, 'key' | 'scope'>): string {
  return `review:${JSON.stringify([item.key, item.scope])}`;
}

/** Transactions organize the session; each task retains its canonical decision key. */
export function buildWalletReviewRows(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
    wallets: Pick<Workspace['wallets'], 'reviews'>;
  },
  wallet: Pick<Wallet, 'id' | 'addresses'>,
  utxos: readonly WalletUtxoRecord[],
  groups: readonly WalletReviewGroup[],
  records?: Pick<WalletPreparation, 'transactionRecords' | 'addressRecords'>,
): WalletRow[] {
  const transactions = new Map(
    buildWalletRecordRows(workspace, wallet, utxos, [], 'transactions', records).transactions.map(
      (row) => [row.txid, row],
    ),
  );
  return groups.flatMap((group) => {
    const first = group.items[0];
    if (!first) return [];
    const base = group.transactionId ? transactions.get(group.transactionId) : undefined;
    const row = base ?? reviewRow(first);
    const changed = group.items.some((item) => item.changed && !item.satisfied);
    const status =
      changed || group.items.some((item) => !item.satisfied && item.status === 'open')
        ? 'open'
        : group.items.some((item) => !item.satisfied && item.status === 'later')
          ? 'later'
          : group.items.every((item) => item.satisfied)
            ? 'resolved'
            : group.items.length === 1
              ? first.status
              : 'reviewed';
    return [
      {
        ...row,
        key: group.key,
        reviews: group.items,
        status,
        changed,
        ...(group.transactionId
          ? {
              kind: 'transaction' as const,
              nodeId: transactionReference(group.transactionId),
              txid: group.transactionId,
              identifier: group.transactionId,
              contextTransactionIds: [group.transactionId],
            }
          : {}),
      },
    ];
  });
}

export function buildWalletRelationshipRows(
  workspace: { wallets: Pick<Workspace['wallets'], 'reviews'> },
  groups: WalletAddressRelationships,
  items: readonly WalletReviewItem[],
): Record<'sources' | 'destinations', WalletRow[]> {
  const counterparties = walletCounterparties(groups);
  const project = (direction: 'source' | 'destination'): WalletRow[] => {
    const reason = direction === 'source' ? 'source-address' : 'destination-address';
    const addresses = direction === 'source' ? counterparties.sources : counterparties.destinations;
    const directionItems = items.filter((item) => item.reason === 'link' || item.reason === reason);
    return addresses.map((group) =>
      decorateWalletRow(
        {
          key: group.id,
          nodeId: group.id,
          identifier: group.address,
          title: short(group.address),
          kind: 'address',
          address: group.address,
          description: `${group.count} distinct observed outputs in ${group.transactionIds.length} one-hop transaction contexts. Labels, tags and review decisions apply to this address only. The observed total is not an allocated payment or balance.`,
          meta: `${group.count} outpoint${group.count === 1 ? '' : 's'} · ${group.transactionIds.length} transaction${group.transactionIds.length === 1 ? '' : 's'}`,
          contextTransactionIds: group.transactionIds,
          outpointIds: group.outpointIds,
          relationshipDirection: direction,
          ownership: group.ownership,
          amountSats: group.amountSats,
        },
        workspace,
        directionItems,
      ),
    );
  };
  return { sources: project('source'), destinations: project('destination') };
}

export function decorateWalletRow(
  row: Omit<WalletRow, 'reviews' | 'status' | 'changed'>,
  workspace: { wallets: Pick<Workspace['wallets'], 'reviews'> },
  items: readonly WalletReviewItem[],
  fallbackReviewKey?: string,
): WalletRow {
  const reviews = items.filter((item) => item.subjectIds.includes(row.nodeId));
  const fallback = fallbackReviewKey ? workspace.wallets.reviews?.[fallbackReviewKey] : undefined;
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
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
    wallets: Pick<Workspace['wallets'], 'reviews'>;
  },
  wallet: Pick<Wallet, 'id' | 'addresses'>,
  utxos: readonly WalletUtxoRecord[],
  reviewItems: readonly WalletReviewItem[],
  tab: 'utxos' | 'transactions' | 'addresses' | 'all' = 'all',
  records?: Pick<WalletPreparation, 'transactionRecords' | 'addressRecords'>,
): Record<'utxos' | 'transactions' | 'addresses', WalletRow[]> {
  const byNode = new Map<string, WalletReviewItem[]>();
  for (const item of reviewItems) {
    for (const subjectId of item.subjectIds) {
      const items = byNode.get(subjectId) ?? [];
      items.push(item);
      byNode.set(subjectId, items);
    }
  }
  const decorate = (row: Omit<WalletRow, 'reviews' | 'status' | 'changed'>, key?: string) =>
    decorateWalletRow(row, workspace, byNode.get(row.nodeId) ?? [], key);
  return {
    utxos:
      tab === 'all' || tab === 'utxos'
        ? utxos.map((record) => {
            const identifier = `${record.txid}:${record.vout}`;
            const nodeId = outpointReference(record.txid, record.vout);
            return decorate(
              {
                key: nodeId,
                nodeId,
                identifier,
                title: short(identifier),
                description:
                  'Reported unspent at the last UTXO check. This is an observation, not a spendability guarantee.',
                kind: 'output',
                meta: record.height > 0 ? `#${record.height}` : 'Unconfirmed',
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
        ? (records?.transactionRecords ?? listWalletTransactions(workspace, wallet)).map(
            (record) => {
              const nodeId = transactionReference(record.txid);
              return decorate(
                {
                  key: nodeId,
                  nodeId,
                  identifier: record.txid,
                  title: short(record.txid),
                  description: record.transaction
                    ? `${record.transaction.vin.length} inputs and ${record.transaction.vout.length} outputs. Wallet association does not make every input or output yours.`
                    : 'Reported in wallet history, but not loaded. Open in Graph to load this transaction.',
                  kind: 'transaction',
                  meta: record.mempool
                    ? 'Unconfirmed'
                    : record.height
                      ? `#${record.height}`
                      : 'Height unknown',
                  txid: record.txid,
                  contextTransactionIds: [record.txid],
                  walletTransaction: record,
                  amountSats: record.netSats,
                },
                reviewKey(wallet.id, 'wallet-transaction', record.txid),
              );
            },
          )
        : [],
    addresses:
      tab === 'all' || tab === 'addresses'
        ? (records?.addressRecords ?? listWalletAddresses(workspace, wallet)).map((record) => {
            const nodeId = addressReference(record.address);
            return decorate({
              key: nodeId,
              nodeId,
              identifier: record.address,
              title: short(record.address),
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
  if (filter === 'open')
    return row.reviews.some(
      (item) =>
        !item.legacyOutputReview && !item.satisfied && (item.changed || item.status === 'open'),
    );
  if (filter === 'later')
    return !row.changed && row.reviews.some((item) => !item.satisfied && item.status === 'later');
  if (row.reviews.length)
    return row.reviews.every(
      (item) => item.satisfied || (!item.changed && isCompletedReview({ status: item.status })),
    );
  return !row.changed && row.status !== 'open' && isCompletedReview({ status: row.status });
}

/** Presentation follows verified membership and explicit missing/conflicting evidence. */
export function walletRowRelationship(
  row: WalletRow,
  wallet: Wallet,
  network: Network,
  selected?: {
    prevoutStatus?: string;
    ownership: 'wallet' | 'external' | 'unknown';
    address?: string;
    scriptPubKey?: TxOutput['scriptPubKey'];
  },
  walletAddresses?: WalletSelectionAddresses,
): string {
  if (row.kind === 'transaction') return 'Wallet activity';
  if (selected?.prevoutStatus === 'conflict') return 'Conflicting evidence';
  if (isOpReturn(selected?.scriptPubKey?.hex)) return 'OP_RETURN · Unspendable output';
  const address =
    selected?.address ?? row.address ?? (row.kind === 'address' ? row.identifier : undefined);
  if (address) {
    return (
      walletAddresses
        ? walletAddresses.addresses.has(address)
        : verifiedWalletAddresses(wallet, network).some((entry) => entry.address === address)
    )
      ? 'In this wallet'
      : 'No match in this wallet';
  }
  if (selected?.ownership === 'wallet' || row.ownership === 'wallet') return 'In this wallet';
  if (selected?.scriptPubKey) return 'Script output';
  return 'Unknown script';
}
