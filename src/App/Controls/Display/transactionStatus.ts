import type { Transaction } from '../../../Core/ChainData';

export interface TransactionStatus {
  kind: 'confirmed' | 'mempool' | 'unknown' | 'conflicted';
  label: string;
  title: string;
}

/** Saved observations, never a height inferred from a changing chain tip. */
export function transactionStatus(transaction?: Transaction): TransactionStatus {
  if (transaction?.status?.kind === 'inactive')
    return {
      kind: 'conflicted',
      label: 'Outside active chain',
      title: 'The saved observation reports a transaction outside the active chain.',
    };
  if (transaction?.status?.blockHeight !== undefined)
    return {
      kind: 'confirmed',
      label: `#${transaction.status?.blockHeight}`,
      title: 'Containing block height from the last saved chain observation.',
    };
  if (transaction?.status?.kind === 'mempool')
    return {
      kind: 'mempool',
      label: 'Unconfirmed',
      title: 'Seen in the mempool at the last lookup. Refresh to check its current status.',
    };
  if (transaction?.status?.kind === 'confirmed')
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
