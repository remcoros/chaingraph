import type { Wallet } from './wallets';
import { deriveAddresses } from './walletDerivation';
import type { Network } from '../../Bitcoin';
import { type Transaction, withHistoryHeight } from '../../ChainData';

import {
  fetchHistory,
  fetchTransaction,
  mapLimit,
  MAX_SCAN_TRANSACTIONS,
  type ScanProgress,
} from '../../ChainData/api';
import {
  TRANSACTION_BATCH_CONCURRENCY,
  transactionScheduler,
  type TransactionFetchHints,
} from '../../ChainData/transactionScheduler';
function createAsyncLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    while (active < limit) {
      const run = queue.shift();
      if (!run) return;
      run();
    }
  };
  return function runLimited<R>(fn: () => Promise<R>, signal?: AbortSignal): Promise<R> {
    signal?.throwIfAborted();
    return new Promise<R>((resolve, reject) => {
      let queued = true;
      const run = () => {
        queued = false;
        signal?.removeEventListener('abort', abortQueued);
        active++;
        Promise.resolve()
          .then(() => {
            signal?.throwIfAborted();
            return fn();
          })
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          });
      };
      const abortQueued = () => {
        if (!queued) return;
        queued = false;
        const index = queue.indexOf(run);
        if (index >= 0) queue.splice(index, 1);
        reject(signal?.reason ?? new DOMException('Request cancelled.', 'AbortError'));
      };
      if (active < limit) run();
      else {
        queue.push(run);
        signal?.addEventListener('abort', abortQueued, { once: true });
      }
    });
  };
}

export async function scanWallet(
  wallet: Wallet,
  network: Network,
  existing: Record<string, Transaction>,
  options: {
    gap: number;
    maxIndex: number;
    signal?: AbortSignal;
    onProgress?: (p: ScanProgress) => void;
    fetchHints?: TransactionFetchHints;
  },
): Promise<{
  wallet: Wallet;
  transactions: Transaction[];
  truncated: boolean;
}> {
  if (
    !Number.isInteger(options.gap) ||
    options.gap < 1 ||
    options.gap > 100 ||
    !Number.isInteger(options.maxIndex) ||
    options.maxIndex < 1 ||
    options.maxIndex > 1000
  )
    throw new Error(
      'Use a gap between 1 and 100 and an address limit between 1 and 1,000 per branch.',
    );
  const fetchHints: TransactionFetchHints = {
    ...options.fetchHints,
    priority: 'background',
    observation: {},
  };
  const scanController = new AbortController();
  const fetchScope = fetchHints.scope ?? transactionScheduler.standalone;
  fetchScope.beginObservation(fetchHints.observation!);
  const scanSignal = options.signal
    ? AbortSignal.any([options.signal, scanController.signal, fetchScope.signal])
    : AbortSignal.any([scanController.signal, fetchScope.signal]);
  const limitHistoryFetch = createAsyncLimiter(4);
  const progressHistoryIds = new Set<string>();
  let checked = 0;
  const scanBranch = async (
    branch: 0 | 1,
  ): Promise<{ addresses: Wallet['addresses']; complete: boolean }> => {
    const branchAddresses: Wallet['addresses'] = [];
    let gap = 0;
    let index = 0;
    const knownUsed = Math.max(
      -1,
      ...wallet.addresses
        .filter((a) => a.branch === branch && a.history?.length)
        .map((a) => a.index),
    );
    while (index < options.maxIndex && (gap < options.gap || index <= knownUsed)) {
      scanSignal.throwIfAborted();
      const size = Math.min(10, options.maxIndex - index);
      const derived = deriveAddresses(wallet.key, network, wallet.scriptType, branch, index, size);
      const histories = await Promise.all(
        derived.map((d) =>
          limitHistoryFetch(() => fetchHistory(network, d.scripthash, scanSignal), scanSignal),
        ),
      );
      for (let i = 0; i < derived.length; i++) {
        const history = histories[i];
        branchAddresses.push({ ...derived[i], history });
        gap = history.length ? 0 : gap + 1;
        for (const h of history) {
          progressHistoryIds.add(h.tx_hash);
        }
        checked++;
      }
      index += size;
      options.onProgress?.({
        done: checked,
        message: `${wallet.name}: checked ${checked} addresses · ${progressHistoryIds.size} transactions`,
      });
    }
    return {
      addresses: branchAddresses,
      complete: !(gap < options.gap || index <= knownUsed),
    };
  };
  const branchPromises = ([0, 1] as const).map((branch) =>
    scanBranch(branch).catch((error: unknown) => {
      scanController.abort();
      throw error;
    }),
  );
  let branchResults: Awaited<ReturnType<typeof scanBranch>>[];
  try {
    branchResults = await Promise.all(branchPromises);
  } catch (error) {
    scanController.abort();
    await Promise.allSettled(branchPromises);
    throw error;
  }
  const addresses = branchResults.flatMap((result) => result.addresses);
  const historyObservation = { source: 'electrum' as const, observedAt: new Date().toISOString() };
  const complete = branchResults.every((result) => result.complete);
  const historyIds = new Set<string>();
  const heights = new Map<string, number>();
  for (const address of addresses) {
    for (const h of address.history ?? []) {
      historyIds.add(h.tx_hash);
      heights.set(h.tx_hash, h.height);
    }
  }
  const oldHeights = new Map(
    wallet.addresses.flatMap((a) => (a.history ?? []).map((h) => [h.tx_hash, h.height] as const)),
  );
  const scannedSlots = new Set(addresses.map((a) => `${a.branch}/${a.index}`));
  const retainedAddresses = wallet.addresses.filter(
    (a) => !scannedSlots.has(`${a.branch}/${a.index}`),
  );
  // A smaller scan bound cannot establish that an older, unvisited address
  // lost its history. Preserve its queued lookups instead of dropping them.
  const relevantHistoryIds = new Set([
    ...historyIds,
    ...retainedAddresses.flatMap((a) => (a.history ?? []).map((h) => h.tx_hash)),
  ]);
  const allIds = [...historyIds];
  // Saved history heights advance even when the fetch budget is exhausted.
  // Carry that skipped work explicitly, and rotate it ahead of recurring
  // unconfirmed refreshes so a busy mempool cannot starve discovery forever.
  const pending = [
    ...new Set([
      ...(wallet.pendingTransactionIds ?? []).filter((id) => relevantHistoryIds.has(id)),
      ...allIds.filter((id) => !existing[id]),
      ...allIds.filter(
        (id) =>
          existing[id] &&
          ((existing[id].status?.blockHeight === undefined &&
            (existing[id].status?.confirmations ?? 0) <= 0) ||
            (existing[id].status?.blockHeight !== undefined &&
              existing[id].status?.blockHeight !== heights.get(id)) ||
            heights.get(id) !== oldHeights.get(id) ||
            (heights.get(id) ?? 0) <= 0),
      ),
    ]),
  ];
  if (pending.length - MAX_SCAN_TRANSACTIONS > 10000) {
    throw new Error(
      'Scan exceeds the 10,000 pending transaction limit. Reduce scan bounds or use separate workspaces.',
    );
  }
  const toLoad = pending.slice(0, MAX_SCAN_TRANSACTIONS);
  let loaded = 0;
  const transactions = await mapLimit(toLoad, TRANSACTION_BATCH_CONCURRENCY, async (id) => {
    const tx = await fetchTransaction(network, id, options.signal, heights.get(id), fetchHints);
    options.onProgress?.({
      done: checked,
      message: `${wallet.name}: loading transactions ${++loaded}/${toLoad.length}`,
    });
    return tx;
  });
  const pendingSet = new Set(pending);
  for (const id of allIds) {
    if (!existing[id] || pendingSet.has(id)) continue;
    const observed = fetchScope.markObservation(
      withHistoryHeight(existing[id], heights.get(id)!, historyObservation),
      fetchHints.observation!,
    );
    if (observed !== existing[id]) transactions.push(observed);
  }
  const truncated = pending.length > MAX_SCAN_TRANSACTIONS;
  options.signal?.throwIfAborted();
  const newTransactionIds = transactions.filter((tx) => !existing[tx.txid]).map((tx) => tx.txid);
  // Absence from a refreshed history is an observation, not authorization to
  // erase the user's graph or conclude that an output is unspent.
  const missingTransactionCount = [...oldHeights.keys()].filter(
    (id) => !relevantHistoryIds.has(id),
  ).length;
  return {
    wallet: {
      ...wallet,
      addresses: [...addresses, ...retainedAddresses],
      scannedAt: new Date().toISOString(),
      scanComplete: complete && !truncated,
      scanLimit: options.maxIndex,
      scanGap: options.gap,
      pendingTransactionIds: pending.slice(MAX_SCAN_TRANSACTIONS),
      lastActivity: {
        newTransactionIds,
        refreshedTransactionCount: transactions.length - newTransactionIds.length,
        missingTransactionCount,
      },
    },
    transactions,
    truncated,
  };
}
