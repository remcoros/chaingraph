import type { Transaction } from '../../../Domain/Chain/transaction';

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
