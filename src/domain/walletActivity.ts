import type { Transaction, Wallet, Workspace } from './types';

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
  return {
    ...current,
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
