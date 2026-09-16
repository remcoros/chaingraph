import type { Transaction } from '../../../Domain/Chain/transaction';
import type { Workspace } from '../../../Domain/Workspace/workspaceTypes';
import { transactionStatus } from './transactionStatus';
import { transactionBlockTime } from './transactionTime';
import { transactionFee } from './transactionFee';
import { formatSats } from './amountFormat';
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
  showTimestamp = true,
}: {
  transaction?: Transaction;
  workspace?: Pick<Workspace, 'network' | 'transactions'>;
  timestampOnly?: boolean;
  showFee?: boolean;
  separateStatusAndTime?: boolean;
  showTimestamp?: boolean;
}) {
  const status = transactionStatus(transaction);
  const time = transactionBlockTime(transaction);
  const explicitFeeSeparator =
    timestampOnly &&
    showTimestamp &&
    showFee &&
    !!time &&
    !!transaction &&
    !!workspace &&
    status.kind === 'confirmed';
  if (timestampOnly && (!time || !showTimestamp)) return null;
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
      {showTimestamp && time && (
        <time
          dateTime={time.iso}
          title={`Block timestamp: ${time.exact}. Not the exact payment time.`}
        >
          {time.compact}
        </time>
      )}
      {showTimestamp && time && showFee && transaction && workspace && (
        <span className="transaction-block-time-separator" aria-hidden="true">
          ·
        </span>
      )}
      {showTimestamp && time && showFee && (
        <TransactionFeeLabel transaction={transaction} workspace={workspace} />
      )}
    </span>
  );
}
