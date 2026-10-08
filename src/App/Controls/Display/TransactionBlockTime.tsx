import type { Transaction } from '../../../Core/ChainData';
import type { Workspace } from '../../../Core/Workspace/workspace';
import type { ReactNode } from 'react';
import { transactionStatus } from './transactionStatus';
import { transactionBlockTime } from './transactionTime';
import { transactionFee } from './transactionFee';
import { formatSats } from '../../../Core/Formatting';
import './transaction-block-time.css';

export function TransactionFeeLabel({
  transaction,
  workspace,
}: {
  transaction?: Transaction;
  workspace?: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  };
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

interface TransactionDisplayProps {
  transaction?: Transaction;
  workspace?: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
  };
}

function TransactionStatusLabel({ transaction }: TransactionDisplayProps) {
  const status = transactionStatus(transaction);
  return <span title={status.title}>{status.label}</span>;
}

function TransactionMetadataSeparator() {
  return (
    <span className="transaction-block-time-separator" aria-hidden="true">
      ·
    </span>
  );
}

/** The frame preserves the shared markup and never chooses a display variant. */
function TransactionTimeFrame({
  transaction,
  status,
  fee,
  statusSeparator,
  className = '',
}: Pick<TransactionDisplayProps, 'transaction'> & {
  status?: ReactNode;
  fee?: ReactNode;
  statusSeparator?: ReactNode;
  className?: string;
}) {
  const time = transactionBlockTime(transaction);
  if (!status && !time) return null;
  return (
    <span className={`transaction-block-time${className}`}>
      {status}
      {time && statusSeparator}
      {time && (
        <time
          dateTime={time.iso}
          title={`Block timestamp: ${time.exact}. Not the exact payment time.`}
        >
          {time.compact}
        </time>
      )}
      {time && fee && <TransactionMetadataSeparator />}
      {time && fee}
    </span>
  );
}

/** Metadata for this transaction only, never its input parents or descendants. */
export function TransactionBlockTime(props: TransactionDisplayProps) {
  return (
    <TransactionTimeFrame
      transaction={props.transaction}
      status={<TransactionStatusLabel {...props} />}
    />
  );
}

export function TransactionBlockTimeWithFee(props: TransactionDisplayProps) {
  return (
    <TransactionTimeFrame
      transaction={props.transaction}
      status={<TransactionStatusLabel {...props} />}
      fee={props.transaction && props.workspace && <TransactionFeeLabel {...props} />}
    />
  );
}

export function TransactionBlockTimeSeparated(props: TransactionDisplayProps) {
  return (
    <TransactionTimeFrame
      transaction={props.transaction}
      status={<TransactionStatusLabel {...props} />}
      statusSeparator={<TransactionMetadataSeparator />}
      className=" transaction-block-time-separated"
    />
  );
}

export function TransactionTimestamp(props: Pick<TransactionDisplayProps, 'transaction'>) {
  return <TransactionTimeFrame transaction={props.transaction} />;
}

export function TransactionTimestampWithFee(props: TransactionDisplayProps) {
  return (
    <TransactionTimeFrame
      transaction={props.transaction}
      fee={props.transaction && props.workspace && <TransactionFeeLabel {...props} />}
      className={
        props.transaction && props.workspace && transactionBlockTime(props.transaction)
          ? ' transaction-block-time-separated'
          : ''
      }
    />
  );
}
