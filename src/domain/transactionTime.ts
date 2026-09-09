import type { Transaction } from './types';
import { transactionStatus } from './transactionStatus';

/** Unix seconds, always GMT, regardless of the browser's locale or timezone. */
export function formatGmtTimestamp(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return undefined;
  const iso = date.toISOString();
  const day = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return {
    compact: `${day} · ${iso.slice(11, 16)} GMT`,
    exact: `${iso.slice(0, 10)} ${iso.slice(11, 19)} GMT`,
    iso,
  };
}

export function transactionBlockTime(transaction?: Transaction) {
  // `time` is not a documented block timestamp. Mempool/unknown observations
  // must not acquire a block date from stale or ambiguous timestamp fields.
  return transactionStatus(transaction).kind === 'confirmed'
    ? formatGmtTimestamp(transaction?.blocktime)
    : undefined;
}

/** Reconcile a Wallet record's observed height with its loaded transaction.
 * An attached UTXO/history height alone does not supply a timestamp. */
export function walletRecordBlockObservation(
  txid: string,
  transaction: Transaction | undefined,
  height: number | undefined,
  mempool: boolean,
): Transaction {
  return {
    txid,
    vin: [],
    vout: [],
    ...transaction,
    blockHeight: height !== undefined && height > 0 ? height : undefined,
    mempool,
    blocktime:
      !mempool && (!transaction?.blockHeight || transaction.blockHeight === height)
        ? transaction?.blocktime
        : undefined,
  };
}
