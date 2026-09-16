import type { Transaction } from './transaction';

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
