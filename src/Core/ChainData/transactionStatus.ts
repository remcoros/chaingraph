import type { Transaction, TransactionStatus } from './transaction';

/** Translate placement coordinates without treating zero confirmations as mempool proof. */
export function statusFromPlacement(
  placement: Omit<TransactionStatus, 'kind'> & { mempool?: boolean },
): TransactionStatus | undefined {
  const { mempool, ...coordinates } = placement;
  if (!Object.values(placement).some((value) => value !== undefined)) return undefined;
  return {
    ...coordinates,
    kind:
      (coordinates.confirmations ?? 0) < 0
        ? 'inactive'
        : coordinates.blockHeight !== undefined || (coordinates.confirmations ?? 0) > 0
          ? 'confirmed'
          : mempool === true
            ? 'mempool'
            : 'unknown',
  };
}

/** History heights 0 and -1 are explicit Electrum mempool observations. */
export function withHistoryHeight(
  transaction: Transaction,
  height: number,
  observation?: TransactionStatus['observation'],
): Transaction {
  if (!Number.isInteger(height) || height < -1 || height > 0x7fffffff)
    throw new Error('Invalid transaction history height.');
  const status = transaction.status;
  if (height > 0) {
    if (status?.kind === 'confirmed' && status.blockHeight === height)
      return observation ? { ...transaction, status: { ...status, observation } } : transaction;
    return {
      ...transaction,
      status: { kind: 'confirmed', blockHeight: height, ...(observation && { observation }) },
    };
  }
  if (status?.kind === 'mempool')
    return observation ? { ...transaction, status: { ...status, observation } } : transaction;
  return {
    ...transaction,
    status: { kind: 'mempool', confirmations: 0, ...(observation && { observation }) },
  };
}
