import type { Transaction, Wallet, Workspace } from './types';
import { promoteInputContext } from './workspace';

/** Immutable wallet evidence used by analyses, excluding refresh/UI bookkeeping. */
export function walletEvidenceChanged(previous: Wallet[], next: Wallet[]): boolean {
  return (
    previous.length !== next.length ||
    previous.some((wallet, index) => {
      const other = next[index];
      return (
        wallet.id !== other.id ||
        wallet.key !== other.key ||
        wallet.name !== other.name ||
        wallet.scriptType !== other.scriptType ||
        wallet.addresses !== other.addresses
      );
    })
  );
}

/** Merge only scan-owned fields into the latest workspace, preserving edits made during I/O. */
export function applyWalletScan(
  current: Workspace,
  scanned: Wallet,
  transactions: Transaction[],
): Workspace {
  // A deleted wallet must not be resurrected by a late result.
  if (!current.wallets.some((wallet) => wallet.id === scanned.id)) return current;
  let mergedTransactions = current.transactions;
  for (const transaction of transactions) {
    const previous = current.transactions[transaction.txid];
    // Parsed transaction records are plain JSON. Include every field so future
    // script/raw metadata changes cannot accidentally keep an old finding valid.
    if (previous && JSON.stringify(previous) === JSON.stringify(transaction)) continue;
    if (mergedTransactions === current.transactions)
      mergedTransactions = { ...current.transactions };
    mergedTransactions[transaction.txid] = transaction;
  }
  // Quiet checks may reuse confirmed transactions without returning downloads.
  // Promote only records observed in this wallet's histories, never unrelated parents.
  const discoveredIds = new Set(transactions.map((transaction) => transaction.txid));
  if (current.inputContext)
    for (const address of scanned.addresses)
      for (const item of address.history ?? [])
        if (current.inputContext[item.tx_hash]) discoveredIds.add(item.tx_hash);
  return {
    ...promoteInputContext(current, discoveredIds),
    wallets: current.wallets.map((wallet) => {
      if (wallet.id !== scanned.id) return wallet;
      const unreviewed = [
        ...new Set([
          ...(wallet.unreviewedTransactionIds ?? []),
          ...(scanned.lastActivity?.newTransactionIds ?? []),
        ]),
      ];
      return {
        ...wallet,
        // Preserve evidence identity for a quiet check, including histories and
        // derivation bindings. Refresh timing and queues are separate metadata.
        addresses:
          JSON.stringify(wallet.addresses) === JSON.stringify(scanned.addresses)
            ? wallet.addresses
            : scanned.addresses,
        scannedAt: scanned.scannedAt,
        scanComplete: scanned.scanComplete,
        scanLimit: scanned.scanLimit,
        scanGap: scanned.scanGap,
        pendingTransactionIds: scanned.pendingTransactionIds,
        lastActivity: scanned.lastActivity,
        unreviewedTransactionIds: unreviewed.slice(-10000),
        activityOverflow: wallet.activityOverflow || unreviewed.length > 10000,
      };
    }),
    transactions: mergedTransactions,
  };
}

/** Refresh a retained undo snapshot with the latest scan-owned metadata.
 * Quiet checks and activity acknowledgment are not undoable: undo may restore
 * user edits (names, colors, tags, annotations, views) but must not roll back
 * scan timestamps, bounds, work queues, or review state. Wallet membership stays
 * with the snapshot so an explicit Undo can still restore a user-deleted wallet. */
export function carryScanMetadata(snapshot: Workspace, latest: Workspace): Workspace {
  const latestById = new Map(latest.wallets.map((wallet) => [wallet.id, wallet]));
  let changed = false;
  const wallets = snapshot.wallets.map((wallet) => {
    const current = latestById.get(wallet.id);
    if (!current) return wallet;
    if (
      wallet.scannedAt === current.scannedAt &&
      wallet.scanComplete === current.scanComplete &&
      wallet.scanLimit === current.scanLimit &&
      wallet.scanGap === current.scanGap &&
      wallet.pendingTransactionIds === current.pendingTransactionIds &&
      wallet.lastActivity === current.lastActivity &&
      wallet.unreviewedTransactionIds === current.unreviewedTransactionIds &&
      wallet.activityOverflow === current.activityOverflow
    )
      return wallet;
    changed = true;
    return {
      ...wallet,
      scannedAt: current.scannedAt,
      scanComplete: current.scanComplete,
      scanLimit: current.scanLimit,
      scanGap: current.scanGap,
      pendingTransactionIds: current.pendingTransactionIds,
      lastActivity: current.lastActivity,
      unreviewedTransactionIds: current.unreviewedTransactionIds,
      activityOverflow: current.activityOverflow,
    };
  });
  return changed ? { ...snapshot, wallets } : snapshot;
}

export function walletCheckAge(scannedAt?: string, now = Date.now()): string {
  if (!scannedAt) return 'Not checked yet';
  const minutes = Math.max(0, Math.floor((now - Date.parse(scannedAt)) / 60_000));
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function walletActivitySummary(wallet: Wallet): string {
  const activity = wallet.lastActivity;
  if (!activity) return 'Refresh to check for new transactions.';
  return `${activity.newTransactionIds.length} new to workspace · ${activity.refreshedTransactionCount} ${activity.refreshedTransactionCount === 1 ? 'transaction' : 'transactions'} refreshed`;
}
