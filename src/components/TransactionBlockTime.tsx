import type { Transaction } from '../domain/types';
import { transactionStatus } from '../domain/transactionStatus';
import { transactionBlockTime } from '../domain/transactionTime';
import './transaction-block-time.css';

/** Metadata for this transaction only, never its input parents or descendants. */
export function TransactionBlockTime({
  transaction,
  timestampOnly = false,
}: {
  transaction?: Transaction;
  timestampOnly?: boolean;
}) {
  const status = transactionStatus(transaction);
  const time = transactionBlockTime(transaction);
  if (timestampOnly && !time) return null;
  return (
    <span className="transaction-block-time">
      {!timestampOnly && <span title={status.title}>{status.label}</span>}
      {time && (
        <time
          dateTime={time.iso}
          title={`Block timestamp: ${time.exact}. Not the exact payment time.`}
        >
          {time.compact}
        </time>
      )}
    </span>
  );
}
