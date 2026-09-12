import type { Transaction, Workspace } from '../domain/types';
import { transactionStatus } from '../domain/transactionStatus';
import { transactionBlockTime } from '../domain/transactionTime';
import { transactionFee } from '../domain/transactionFee';
import { formatSats } from '../domain/amountFormat';
import './transaction-block-time.css';

export function TransactionFeeLabel({
  transaction,
  workspace,
}: {
  transaction?: Transaction;
  workspace?: Pick<Workspace, 'network' | 'transactions'>;
}) {
  if (!transaction || !workspace || transactionStatus(transaction).kind !== 'confirmed')
    return null;
  const fee = transactionFee(workspace, transaction);
  return (
    <span className="transaction-block-time-fee">
      {fee ? `${fee.feeRateSatVb.toFixed(2)} sat/vB - ${formatSats(fee.feeSats)}` : 'Fee unknown'}
    </span>
  );
}

/** Metadata for this transaction only, never its input parents or descendants. */
export function TransactionBlockTime({
  transaction,
  workspace,
  timestampOnly = false,
  showFee = true,
  separateStatusAndTime = false,
}: {
  transaction?: Transaction;
  workspace?: Pick<Workspace, 'network' | 'transactions'>;
  timestampOnly?: boolean;
  showFee?: boolean;
  separateStatusAndTime?: boolean;
}) {
  const status = transactionStatus(transaction);
  const time = transactionBlockTime(transaction);
  const explicitFeeSeparator =
    timestampOnly &&
    showFee &&
    !!time &&
    !!transaction &&
    !!workspace &&
    status.kind === 'confirmed';
  if (timestampOnly && !time) return null;
  return (
    <span
      className={`transaction-block-time${separateStatusAndTime || explicitFeeSeparator ? ' transaction-block-time-separated' : ''}`}
    >
      {!timestampOnly && <span title={status.title}>{status.label}</span>}
      {!timestampOnly && separateStatusAndTime && time && (
        <span className="transaction-block-time-separator" aria-hidden="true">
          ·
        </span>
      )}
      {time && (
        <time
          dateTime={time.iso}
          title={`Block timestamp: ${time.exact}. Not the exact payment time.`}
        >
          {time.compact}
        </time>
      )}
      {time && showFee && transaction && workspace && (
        <span className="transaction-block-time-separator" aria-hidden="true">
          ·
        </span>
      )}
      {time && showFee && <TransactionFeeLabel transaction={transaction} workspace={workspace} />}
    </span>
  );
}
