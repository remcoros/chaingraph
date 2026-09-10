import { TRANSACTION_BATCH_CONCURRENCY } from './transactionScheduler';
import type { Transaction, Workspace } from '../domain/types';
import { mapLimit, MAX_SCAN_TRANSACTIONS } from './api';

/** A hidden entity is still a valid trace source; a removed branch is not. */
export function traceSourceExists(workspace: Workspace, nodeId: string): boolean {
  const [kind, txid, index] = nodeId.split(':');
  if (kind === 'tx') return !!workspace.transactions[txid];
  if (kind !== 'out') return false;
  const n = Number(index);
  return (
    !!workspace.transactions[txid]?.vout.some((output) => output.n === n) ||
    Object.values(workspace.transactions).some((tx) =>
      tx.vin.some((input) => input.txid === txid && input.vout === n),
    )
  );
}

/** Breadth-first ancestry, bounded across the entire action, including both levels. */
export async function loadAncestors(
  roots: Transaction[],
  existing: Record<string, Transaction>,
  depth: 1 | 2,
  options: {
    signal?: AbortSignal;
    /** Bound to the initiating workspace network, or an offline fixture. */
    fetch: (txid: string, signal?: AbortSignal) => Promise<Transaction>;
    onProgress?: (message: string) => void;
  },
) {
  if (depth !== 1 && depth !== 2) throw new Error('Choose one or two previous levels.');
  const known = new Map(Object.entries(existing));
  roots.forEach((tx) => known.set(tx.txid, tx));
  const visited = new Set(roots.map((tx) => tx.txid));
  const transactions: Transaction[] = [];
  let frontier = roots;
  let requested = 0;
  let failed = 0;
  let truncated = false;
  for (let level = 1; level <= depth; level++) {
    options.signal?.throwIfAborted();
    const ids = [
      ...new Set(frontier.flatMap((tx) => tx.vin.flatMap((i) => (i.txid ? [i.txid] : [])))),
    ].filter((id) => !visited.has(id));
    ids.forEach((id) => visited.add(id));
    const missing = ids.filter((id) => !known.has(id));
    const batch = missing.slice(0, MAX_SCAN_TRANSACTIONS - requested);
    truncated ||= batch.length < missing.length;
    requested += batch.length;
    let done = 0;
    await mapLimit(batch, TRANSACTION_BATCH_CONCURRENCY, async (id) => {
      options.signal?.throwIfAborted();
      try {
        const tx = await options.fetch(id, options.signal);
        options.signal?.throwIfAborted();
        known.set(id, tx);
        transactions.push(tx);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        failed++;
      }
      options.onProgress?.(
        `Previous level ${level}/${depth}: ${++done}/${batch.length} transactions`,
      );
    });
    frontier = ids.flatMap((id) => (known.has(id) ? [known.get(id)!] : []));
  }
  return {
    transactions,
    failed,
    truncated,
    // Explicit traversal reveals cached ancestors too, without downloading them again.
    resolvedTransactionIds: [...visited].filter((id) => known.has(id)),
    previousTransactionIds: [...visited].filter(
      (id) => known.has(id) && !roots.some((root) => root.txid === id),
    ),
  };
}

/** Cached flow inputs can gain graph context without another network download. */
export function ancestryNotice(
  result: Awaited<ReturnType<typeof loadAncestors>>,
  before: Pick<Workspace, 'transactions' | 'inputContext'>,
) {
  const added = result.previousTransactionIds.filter((id) => !before.transactions[id]).length;
  const revealed = result.previousTransactionIds.filter((id) => before.inputContext?.[id]).length;
  const parts: string[] = [];
  if (added) parts.push(`${added} previous transaction${added === 1 ? '' : 's'} added.`);
  if (revealed)
    parts.push(
      `Expanded ${revealed} cached input transaction${revealed === 1 ? '' : 's'} to show all inputs and outputs. No repeat download needed.`,
    );
  if (!added && !revealed && !result.failed && !result.truncated)
    parts.push(
      result.previousTransactionIds.length
        ? 'Previous transactions are already visible. Trace a parent transaction to continue one level deeper.'
        : 'Coinbase transaction: no previous inputs to load.',
    );
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
