import type { Transaction } from '../../../Domain/Chain/transaction';
import { transactionStatus } from './transactionStatus';

const localTimestampOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  numberingSystem: 'latn',
};

/** Render a stored ISO timestamp in the user's local timezone without a suffix. */
export function formatLocalTimestamp(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const localTimestampFormatter = new Intl.DateTimeFormat(undefined, localTimestampOptions);
  const parts = Object.fromEntries(
    localTimestampFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]),
  );
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute || !parts.second)
    return undefined;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** A Bitcoin block timestamp, rendered as UTC without a timezone suffix. */
function formatBlockTimestamp(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return undefined;
  const iso = date.toISOString();
  const value = `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
  return {
    compact: value,
    exact: value,
    iso,
  };
}

export function transactionBlockTime(transaction?: Transaction) {
  // `time` is not a documented block timestamp. Mempool/unknown observations
  // must not acquire a block date from stale or ambiguous timestamp fields.
  return transactionStatus(transaction).kind === 'confirmed'
    ? formatBlockTimestamp(transaction?.blocktime)
    : undefined;
}
