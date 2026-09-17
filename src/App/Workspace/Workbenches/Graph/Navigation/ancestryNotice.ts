import type { loadAncestors } from './ancestry';
/** Successful graph changes are visible directly; only explain limits or no further inputs. */
export function ancestryNotice(result: Awaited<ReturnType<typeof loadAncestors>>) {
  const parts: string[] = [];
  if (!result.previousTransactionIds.length && !result.failed && !result.truncated)
    parts.push('Coinbase transaction: no previous inputs to load.');
  if (result.truncated)
    parts.push(
      'Partial expansion: 500-transaction limit reached. Trace individual paths to continue.',
    );
  if (result.failed)
    parts.push(
      `${result.failed} previous transaction${result.failed === 1 ? '' : 's'} could not be loaded. Retry the path to continue.`,
    );
  return parts.join(' ');
}
