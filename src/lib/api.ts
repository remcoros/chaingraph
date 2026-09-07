import type { Network, Transaction, Wallet, Workspace } from '../domain/types';
import { parseTransaction, outputAddress } from '../domain/workspace';
import { addressToScriptHash, deriveAddresses } from './wallet';
export interface BackendStatus {
  network: Network;
  connected: boolean;
  height?: number;
  error?: string;
}
export interface HistoryEntry {
  tx_hash: string;
  height: number;
}
export async function rpc<T>(
  target: 'core' | 'electrum',
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, method, params }),
    signal,
  });
  const payload = await response.json();
  if (!response.ok || payload.error)
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Upstream request failed.');
  return payload.result as T;
}
export async function backendStatus(signal?: AbortSignal): Promise<BackendStatus> {
  const r = await fetch('/api/status', { signal });
  if (!r.ok) throw new Error('Backend unavailable');
  return r.json();
}
export async function fetchTransaction(txid: string, signal?: AbortSignal): Promise<Transaction> {
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error('Enter a 64-character transaction ID.');
  let data: unknown;
  try {
    data = await rpc('core', 'getrawtransaction', [txid.toLowerCase(), 1], signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    data = await rpc('electrum', 'blockchain.transaction.get', [txid.toLowerCase(), true], signal);
  }
  const tx = parseTransaction(data);
  if (tx.txid !== txid.toLowerCase()) throw new Error('Upstream returned a different transaction.');
  return tx;
}
export async function fetchHistory(
  scripthash: string,
  signal?: AbortSignal,
): Promise<HistoryEntry[]> {
  const data = await rpc<HistoryEntry[]>(
    'electrum',
    'blockchain.scripthash.get_history',
    [scripthash],
    signal,
  );
  if (
    !Array.isArray(data) ||
    data.length > 10000 ||
    data.some((x) => !x || !/^[0-9a-f]{64}$/.test(x.tx_hash) || !Number.isInteger(x.height))
  )
    throw new Error('Invalid or oversized address history.');
  return data;
}
export async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  let stopped = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      for (;;) {
        const i = cursor++;
        if (stopped || i >= values.length) return;
        try {
          out[i] = await fn(values[i], i);
        } catch (e) {
          stopped = true;
          throw e;
        }
      }
    }),
  );
  return out;
}
export interface ScanProgress {
  done: number;
  message: string;
}
export const MAX_SCAN_TRANSACTIONS = 500;
export async function scanWallet(
  wallet: Wallet,
  network: Network,
  existing: Record<string, Transaction>,
  options: {
    gap: number;
    maxIndex: number;
    signal?: AbortSignal;
    onProgress?: (p: ScanProgress) => void;
  },
): Promise<{
  wallet: Wallet;
  transactions: Transaction[];
  truncated: boolean;
}> {
  const addresses: Wallet['addresses'] = [];
  const historyIds = new Set<string>();
  const heights = new Map<string, number>();
  let checked = 0;
  let complete = true;
  for (const branch of [0, 1] as const) {
    let gap = 0;
    let index = 0;
    const knownUsed = Math.max(
      -1,
      ...wallet.addresses
        .filter((a) => a.branch === branch && a.history?.length)
        .map((a) => a.index),
    );
    while (index < options.maxIndex && (gap < options.gap || index <= knownUsed)) {
      options.signal?.throwIfAborted();
      const size = Math.min(10, options.maxIndex - index);
      const derived = deriveAddresses(wallet.key, network, wallet.scriptType, branch, index, size);
      const histories = await mapLimit(derived, 4, (d) =>
        fetchHistory(d.scripthash, options.signal),
      );
      for (let i = 0; i < derived.length; i++) {
        const history = histories[i];
        addresses.push({ ...derived[i], history });
        gap = history.length ? 0 : gap + 1;
        for (const h of history) {
          historyIds.add(h.tx_hash);
          heights.set(h.tx_hash, h.height);
        }
        checked++;
      }
      index += size;
      options.onProgress?.({
        done: checked,
        message: `${wallet.name}: checked ${checked} addresses · ${historyIds.size} transactions`,
      });
    }
    if (gap < options.gap || index <= knownUsed) complete = false;
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
          ((existing[id].confirmations ?? 0) <= 0 ||
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
  const transactions = await mapLimit(toLoad, 4, async (id) => {
    const tx = await fetchTransaction(id, options.signal);
    options.onProgress?.({
      done: checked,
      message: `${wallet.name}: loading transactions ${++loaded}/${toLoad.length}`,
    });
    return tx;
  });
  const truncated = pending.length > MAX_SCAN_TRANSACTIONS;
  return {
    wallet: {
      ...wallet,
      addresses: [...addresses, ...retainedAddresses],
      scannedAt: new Date().toISOString(),
      scanComplete: complete && !truncated,
      scanLimit: options.maxIndex,
      pendingTransactionIds: pending.slice(MAX_SCAN_TRANSACTIONS),
    },
    transactions,
    truncated,
  };
}
export async function loadAddress(
  address: string,
  network: Network,
  existing: Record<string, Transaction>,
  signal?: AbortSignal,
  onProgress?: (p: ScanProgress) => void,
): Promise<{ transactions: Transaction[]; truncated: boolean }> {
  const history = await fetchHistory(addressToScriptHash(address, network), signal);
  const allIds = [...new Set(history.map((h) => h.tx_hash))];
  const heights = new Map(history.map((h) => [h.tx_hash, h.height]));
  const ids = [
    ...allIds.filter((id) => !existing[id]),
    ...allIds.filter(
      (id) =>
        existing[id] && ((existing[id].confirmations ?? 0) <= 0 || (heights.get(id) ?? 0) <= 0),
    ),
  ];
  let loaded = 0;
  const transactions = await mapLimit(ids.slice(0, MAX_SCAN_TRANSACTIONS), 4, async (id) => {
    onProgress?.({
      done: loaded,
      message: `Loading address history ${++loaded}/${Math.min(ids.length, MAX_SCAN_TRANSACTIONS)}`,
    });
    return fetchTransaction(id, signal);
  });
  return { transactions, truncated: ids.length > MAX_SCAN_TRANSACTIONS };
}
export async function loadFunding(
  tx: Transaction,
  existing: Record<string, Transaction>,
  signal?: AbortSignal,
): Promise<Transaction[]> {
  const ids = [...new Set(tx.vin.flatMap((i) => (i.txid && !existing[i.txid] ? [i.txid] : [])))];
  if (ids.length > 500)
    throw new Error('Funding expansion is limited to 500 transactions at a time.');
  return mapLimit(ids, 4, (id) => fetchTransaction(id, signal));
}
export async function loadSpending(
  tx: Transaction,
  w: Workspace,
  vout: number | undefined,
  signal?: AbortSignal,
): Promise<{ transactions: Transaction[]; truncated: boolean }> {
  const outputs = tx.vout.filter((o) => vout === undefined || o.n === vout);
  const addresses = [...new Set(outputs.map(outputAddress).filter((x): x is string => !!x))];
  if (addresses.length === 0)
    throw new Error('No standard address is available for these outputs.');
  const histories = await mapLimit(addresses, 4, (a) =>
    fetchHistory(addressToScriptHash(a, w.network), signal),
  );
  const ids = [...new Set(histories.flatMap((h) => h.map((e) => e.tx_hash)))].filter(
    (id) => id !== tx.txid,
  );
  const wanted = new Set(outputs.map((o) => o.n));
  const candidates = await mapLimit(ids.slice(0, 500), 4, (id) =>
    w.transactions[id] ? Promise.resolve(w.transactions[id]) : fetchTransaction(id, signal),
  );
  return {
    transactions: candidates.filter((t) =>
      t.vin.some((i) => i.txid === tx.txid && i.vout !== undefined && wanted.has(i.vout)),
    ),
    truncated: ids.length > 500 || outputs.some((o) => !outputAddress(o)),
  };
}
