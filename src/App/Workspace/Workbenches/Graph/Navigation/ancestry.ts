import { TRANSACTION_BATCH_CONCURRENCY } from '../../../../../Core/ChainData/transactionScheduler';
import type { Transaction } from '../../../../../Core/ChainData';
import { mapLimit, MAX_SCAN_TRANSACTIONS } from '../../../../../Core/ChainData/api';
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
