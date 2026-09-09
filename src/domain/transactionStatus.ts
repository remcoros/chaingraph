import type { Transaction } from './types';

export interface TransactionStatus {
  kind: 'confirmed' | 'mempool' | 'unknown' | 'conflicted';
  label: string;
  title: string;
}

/** Saved observations, never a height inferred from a changing chain tip. */
export function transactionStatus(transaction?: Transaction): TransactionStatus {
  if ((transaction?.confirmations ?? 0) < 0)
    return {
      kind: 'conflicted',
      label: 'Outside active chain',
      title: 'The saved observation reports a transaction outside the active chain.',
    };
  if (transaction?.blockHeight !== undefined)
    return {
      kind: 'confirmed',
      label: `#${transaction.blockHeight}`,
      title: 'Containing block height from the last saved chain observation.',
    };
  if (transaction?.mempool === true)
    return {
      kind: 'mempool',
      label: 'Unconfirmed',
      title: 'Seen in the mempool at the last lookup. Refresh to check its current status.',
    };
  if ((transaction?.confirmations ?? 0) > 0)
    return {
      kind: 'confirmed',
      label: 'Confirmed',
      title: 'Confirmed in the saved observation; its block height has not been loaded.',
    };
  return {
    kind: 'unknown',
    label: 'Status unknown',
    title: 'No confirmed block height or mempool observation has been loaded.',
  };
}

/** History heights 0 and -1 are explicit Electrum mempool observations. */
export function withHistoryHeight(transaction: Transaction, height: number): Transaction {
  if (!Number.isInteger(height) || height < -1 || height > 0x7fffffff)
    throw new Error('Invalid transaction history height.');
  if (height > 0) {
    if (
      transaction.blockHeight === height &&
      transaction.mempool !== true &&
      (transaction.confirmations ?? 1) > 0
    )
      return transaction;
    return {
      ...transaction,
      ...(transaction.blockHeight !== height
        ? { blockhash: undefined, blocktime: undefined, time: undefined }
        : {}),
      blockHeight: height,
      mempool: undefined,
      confirmations:
        transaction.blockHeight === height && (transaction.confirmations ?? 0) > 0
          ? transaction.confirmations
          : undefined,
    };
  }
  if (
    transaction.mempool === true &&
    transaction.blockHeight === undefined &&
    transaction.blockhash === undefined &&
    transaction.confirmations === 0
  )
    return transaction;
  return {
    ...transaction,
    blockHeight: undefined,
    blockhash: undefined,
    blocktime: undefined,
    time: undefined,
    confirmations: 0,
    mempool: true,
  };
}
