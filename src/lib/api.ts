import { z } from 'zod';
import {
  transactionScheduler,
  TRANSACTION_BATCH_CONCURRENCY,
  type TransactionFetchHints,
} from './transactionScheduler';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type {
  AddressBalanceObservation,
  AddressUtxoObservation,
  Network,
  Transaction,
  Wallet,
  Workspace,
} from '../domain/types';
import { parseTransaction, outputAddress, validateTransactionAddresses } from '../domain/workspace';
import { addressToScriptHash, deriveAddresses } from './wallet';
import { withHistoryHeight } from '../domain/transactionStatus';
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
const MAX_MONEY_SATS = 2_100_000_000_000_000;
const addressBalanceResponseSchema = z.object({
  confirmed: z.number().int().min(0).max(MAX_MONEY_SATS),
  unconfirmed: z.number().int().min(-MAX_MONEY_SATS).max(MAX_MONEY_SATS),
});
const addressUtxoResponseSchema = z
  .array(
    z.object({
      tx_hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/i)
        .transform((id) => id.toLowerCase()),
      tx_pos: z.number().int().min(0).max(0xffffffff),
      height: z.number().int().min(0).max(0x7fffffff),
      value: z.number().int().min(0).max(MAX_MONEY_SATS),
    }),
  )
  .max(10000);
class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
    readonly failure?: RpcFailureKind,
  ) {
    super(message);
  }
}
export type RpcFailureKind =
  | 'backend-unavailable'
  | 'rate-limited'
  | 'timeout'
  | 'invalid-response'
  | 'lookup-failed'
  | 'conflicting-evidence';
/** Stable categories only. Never infer status from or return upstream message text. */
export function classifyRpcFailure(error: unknown): RpcFailureKind {
  if (error instanceof RpcError) {
    if (error.code === 'network_not_configured') return 'backend-unavailable';
    if (error.status === 429) return 'rate-limited';
    // Optional spending-index capability loss still permits the existing history fallback.
    if (error.code === 'core_spender_unavailable') return 'lookup-failed';
    if (error.status === 503) return 'backend-unavailable';
    if (error.status === 408 || error.status === 504) return 'timeout';
    return error.failure ?? 'lookup-failed';
  }
  return error instanceof z.ZodError ? 'invalid-response' : 'lookup-failed';
}
export async function rpc<T>(
  network: Network,
  target: 'core' | 'electrum',
  method: string,
  params: unknown[],
  signal?: AbortSignal,
): Promise<T> {
  assertNetwork(network);
  const response = await fetch('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ network, target, method, params }),
    signal,
  }).catch((error: unknown) => {
    signal?.throwIfAborted();
    throw new RpcError('Backend request unavailable.', undefined, undefined, 'backend-unavailable');
  });
  const payload = await response.json().catch(() => {
    signal?.throwIfAborted();
    throw new RpcError(
      'Invalid upstream response.',
      undefined,
      response.status,
      'invalid-response',
    );
  });
  signal?.throwIfAborted();
  if (!payload || typeof payload !== 'object')
    throw new RpcError(
      'Invalid upstream response.',
      undefined,
      response.status,
      'invalid-response',
    );
  if (!response.ok || payload.error)
    throw new RpcError(
      typeof payload.error === 'string' ? payload.error : 'Upstream request failed.',
      typeof payload.code === 'string' ? payload.code : undefined,
      response.status,
    );
  if (!Object.hasOwn(payload, 'result'))
    throw new RpcError(
      'Invalid upstream response.',
      undefined,
      response.status,
      'invalid-response',
    );
  return payload.result as T;
}
const networkSchema = z.enum(['mainnet', 'testnet4']);
let spenderIndexNetworks = new Set<Network>();
const capabilitiesSchema = z.object({
  spenderIndexNetworks: z.array(networkSchema).max(2).optional(),
  networks: z
    .array(networkSchema)
    .max(2)
    .refine((networks) => new Set(networks).size === networks.length),
});
const statusSchema = z.object({
  network: networkSchema,
  connected: z.boolean(),
  height: z.number().int().min(0).max(0x7fffffff).optional(),
  error: z.string().max(1000).optional(),
});
function assertNetwork(network: Network): void {
  if (!networkSchema.safeParse(network).success)
    throw new Error('Choose mainnet or testnet4 for this request.');
}

/** Configured capabilities remain available when one upstream pair is offline. */
export async function backendNetworks(signal?: AbortSignal): Promise<Network[]> {
  const response = await fetch('/api/networks', { signal });
  if (!response.ok) throw new Error('Could not discover configured Bitcoin networks.');
  const parsed = capabilitiesSchema.safeParse(await response.json());
  signal?.throwIfAborted();
  if (!parsed.success) throw new Error('Backend returned invalid network capabilities.');
  const enabled = parsed.data.spenderIndexNetworks ?? [];
  if (
    new Set(enabled).size !== enabled.length ||
    enabled.some((n) => !parsed.data.networks.includes(n))
  )
    throw new Error('Backend returned invalid network capabilities.');
  spenderIndexNetworks = new Set(enabled);
  return parsed.data.networks;
}
export async function backendStatus(
  network: Network,
  signal?: AbortSignal,
): Promise<BackendStatus> {
  assertNetwork(network);
  const response = await fetch(`/api/status?network=${network}`, { signal });
  if (!response.ok) throw new Error('Backend unavailable');
  const parsed = statusSchema.safeParse(await response.json());
  signal?.throwIfAborted();
  if (!parsed.success) throw new Error('Backend returned invalid network status.');
  if (parsed.data.network !== network)
    throw new Error('Backend status belongs to a different Bitcoin network.');
  return parsed.data;
}
// A block hash fixes its height. Keep only bounded immutable coordinates in
// browser memory, never cached active-chain status or backend workspace state.
const blockHeights = new Map<string, number>();
type HeaderObservation = { height: number; active: boolean };
type HeaderRequest = {
  controller: AbortController;
  promise: Promise<HeaderObservation | undefined>;
  consumers: number;
};
// Leaf metadata requests do not acquire another scheduler slot. Keep same-block
// reuse within a session/refresh even though transactions have independent signals.
const headerRequests = new WeakMap<object, Map<string, HeaderRequest>>();
const headerSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  height: z.number().int().min(0).max(0x7fffffff),
  confirmations: z.number().int().min(-1).max(0x7fffffff),
});
async function fetchBlockHeight(
  network: Network,
  hash: string,
  signal: AbortSignal,
  owner: object,
  fresh = false,
): Promise<HeaderObservation | undefined> {
  signal.throwIfAborted();
  const key = `${network}:${hash}`;
  const cached = blockHeights.get(key);
  // A spender block hint requires a fresh active-chain observation even when
  // its immutable height is known. Other callers retain main's verbose guard.
  if (!fresh && cached !== undefined) return { height: cached, active: true };
  let requests = headerRequests.get(owner);
  if (!requests) {
    requests = new Map();
    headerRequests.set(owner, requests);
  }
  let pending = requests.get(key);
  if (!pending) {
    const controller = new AbortController();
    const request: HeaderRequest = {
      controller,
      consumers: 0,
      promise: Promise.resolve().then(async () => {
        try {
          controller.signal.throwIfAborted();
          const data = await rpc(
            network,
            'core',
            'getblockheader',
            [hash, true],
            controller.signal,
          );
          const parsed = headerSchema.safeParse(data);
          if (!parsed.success || parsed.data.hash !== hash) return undefined;
          blockHeights.set(key, parsed.data.height);
          if (blockHeights.size > 512) blockHeights.delete(blockHeights.keys().next().value!);
          return { height: parsed.data.height, active: parsed.data.confirmations > 0 };
        } catch (error) {
          if (controller.signal.aborted) throw error;
          return undefined; // Optional metadata must not discard a loaded transaction.
        } finally {
          if (requests.get(key) === request) requests.delete(key);
        }
      }),
    };
    pending = request;
    requests.set(key, request);
  }
  const request = pending;
  request.consumers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: HeaderObservation, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      if (--request.consumers === 0) {
        if (requests.get(key) === request) requests.delete(key);
        request.controller.abort();
      }
      if (signal.aborted) reject(signal.reason);
      else if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => finish();
    signal.addEventListener('abort', cancel, { once: true });
    void request.promise.then(
      (value) => finish(value),
      (error: unknown) => finish(undefined, error),
    );
  });
}

async function fetchTransactionRequest(
  network: Network,
  txid: string,
  signal: AbortSignal,
  historyHeight: number | undefined,
  headerOwner: object,
  blockhash?: string,
): Promise<Transaction> {
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error('Enter a 64-character transaction ID.');
  let data: unknown;
  let fromCore = true;
  try {
    data = await rpc(
      network,
      'core',
      'getrawtransaction',
      [txid.toLowerCase(), 2, ...(blockhash ? [blockhash] : [])],
      signal,
    );
  } catch (e) {
    if (signal?.aborted) throw e;
    if (classifyRpcFailure(e) === 'rate-limited') throw e;
    if (e instanceof RpcError && e.code === 'core_prevout_unavailable') {
      try {
        data = await rpc(
          network,
          'core',
          'getrawtransaction',
          [txid.toLowerCase(), 1, ...(blockhash ? [blockhash] : [])],
          signal,
        );
      } catch (fallbackError) {
        if (signal?.aborted) throw fallbackError;
        if (classifyRpcFailure(fallbackError) === 'rate-limited') throw fallbackError;
        fromCore = false;
        data = await rpc(
          network,
          'electrum',
          'blockchain.transaction.get',
          [txid.toLowerCase(), true],
          signal,
        );
      }
    } else {
      fromCore = false;
      data = await rpc(
        network,
        'electrum',
        'blockchain.transaction.get',
        [txid.toLowerCase(), true],
        signal,
      );
    }
  }
  const tx = parseTransaction(data);
  if (tx.txid !== txid.toLowerCase())
    throw new RpcError(
      'Upstream returned a different transaction.',
      undefined,
      undefined,
      'conflicting-evidence',
    );
  try {
    validateTransactionAddresses(tx, network);
  } catch (error) {
    // These messages originate in our network/script validator, not upstream exception text.
    throw new RpcError(
      error instanceof Error ? error.message : 'Invalid transaction network.',
      undefined,
      undefined,
      'conflicting-evidence',
    );
  }
  // These are application observations, not fields supplied by verbose RPC.
  delete tx.blockHeight;
  delete tx.mempool;
  if (fromCore && blockhash) {
    const active = (data as { in_active_chain?: unknown }).in_active_chain;
    if (tx.blockhash !== blockhash || typeof active !== 'boolean')
      throw new Error('Invalid containing-block observation.');
    if (!active) return { ...tx, confirmations: -1 };
  }
  if ((tx.confirmations ?? 0) < 0) return tx;
  // Core's no-blockhash lookup returns mempool transactions without a blockhash.
  // A bare zero confirmation count from imported or Electrum verbose data is
  // insufficient evidence. Coinbase transactions can never enter the mempool.
  if (
    fromCore &&
    !blockhash &&
    !tx.blockhash &&
    (tx.confirmations === undefined || tx.confirmations === 0) &&
    !tx.vin.some((input) => input.coinbase !== undefined)
  )
    return { ...tx, confirmations: 0, mempool: true };
  if (tx.blockhash && (tx.confirmations ?? 0) > 0 && (fromCore || historyHeight === undefined)) {
    const header = await fetchBlockHeight(
      network,
      tx.blockhash,
      signal,
      headerOwner,
      blockhash !== undefined,
    );
    signal?.throwIfAborted();
    if (header)
      return header.active ? { ...tx, blockHeight: header.height } : { ...tx, confirmations: -1 };
  }
  if (historyHeight !== undefined && !(historyHeight <= 0 && (tx.confirmations ?? 0) > 0)) {
    // History and a later verbose fetch can straddle a reorganization. History
    // gives an actual height but cannot bind it to the verbose blockhash.
    return withHistoryHeight(
      {
        ...tx,
        blockhash: undefined,
        blocktime: undefined,
        time: undefined,
        confirmations: undefined,
      },
      historyHeight,
    );
  }
  return tx;
}

export function fetchTransaction(
  network: Network,
  txid: string,
  signal?: AbortSignal,
  historyHeight?: number,
  hints: TransactionFetchHints = {},
  blockhash?: string,
): Promise<Transaction> {
  const key = JSON.stringify([txid.toLowerCase(), historyHeight ?? null, blockhash ?? null]);
  return transactionScheduler.request(
    network,
    key,
    (physicalSignal) =>
      fetchTransactionRequest(
        network,
        txid,
        physicalSignal,
        historyHeight,
        hints.observation ?? hints.scope ?? transactionScheduler.standalone,
        blockhash,
      ),
    signal,
    hints,
  );
}
export async function fetchHistory(
  network: Network,
  scripthash: string,
  signal?: AbortSignal,
): Promise<HistoryEntry[]> {
  const data = await rpc<HistoryEntry[]>(
    network,
    'electrum',
    'blockchain.scripthash.get_history',
    [scripthash],
    signal,
  );
  if (
    !Array.isArray(data) ||
    data.length > 10000 ||
    data.some(
      (x) =>
        !x ||
        !/^[0-9a-f]{64}$/.test(x.tx_hash) ||
        !Number.isInteger(x.height) ||
        x.height < -1 ||
        x.height > 0x7fffffff,
    )
  )
    throw new Error('Invalid or oversized address history.');
  return data;
}
export async function fetchAddressBalance(
  network: Network,
  address: string,
  signal?: AbortSignal,
): Promise<AddressBalanceObservation> {
  const data = await rpc<unknown>(
    network,
    'electrum',
    'blockchain.scripthash.get_balance',
    [addressToScriptHash(address, network)],
    signal,
  );
  const parsed = addressBalanceResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error('Invalid address balance response.');
  return {
    network,
    confirmedSats: parsed.data.confirmed,
    unconfirmedSats: parsed.data.unconfirmed,
    checkedAt: new Date().toISOString(),
  };
}
export async function fetchAddressUtxos(
  network: Network,
  address: string,
  signal?: AbortSignal,
): Promise<AddressUtxoObservation> {
  const data = await rpc<unknown>(
    network,
    'electrum',
    'blockchain.scripthash.listunspent',
    [addressToScriptHash(address, network)],
    signal,
  );
  const parsed = addressUtxoResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error('Invalid address UTXO response.');
  return {
    network,
    utxos: parsed.data.map((entry) => ({
      txid: entry.tx_hash,
      vout: entry.tx_pos,
      valueSats: entry.value,
      height: entry.height,
    })),
    checkedAt: new Date().toISOString(),
  };
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
export interface ScanProgress {
  done: number;
  total?: number;
  message: string;
}
export interface AddressHistoryLoadCallbacks {
  onHistory?: (history: HistoryEntry[], detailTotal: number, truncated: boolean) => void;
  onTransaction?: (transaction: Transaction) => void;
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
  const scanSignal = options.signal
    ? AbortSignal.any([options.signal, scanController.signal])
    : scanController.signal;
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
          ((existing[id].blockHeight === undefined && (existing[id].confirmations ?? 0) <= 0) ||
            (existing[id].blockHeight !== undefined &&
              existing[id].blockHeight !== heights.get(id)) ||
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
    const observed = withHistoryHeight(existing[id], heights.get(id)!);
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
export async function loadAddress(
  address: string,
  network: Network,
  existing: Record<string, Transaction>,
  signal?: AbortSignal,
  onProgress?: (p: ScanProgress) => void,
  hints: TransactionFetchHints = {},
  callbacks: AddressHistoryLoadCallbacks = {},
): Promise<{
  transactions: Transaction[];
  truncated: boolean;
  observedTransactionIds: string[];
  history: HistoryEntry[];
}> {
  const fetchHints: TransactionFetchHints = {
    ...hints,
    priority: 'background',
    observation: {},
  };
  const history = await fetchHistory(network, addressToScriptHash(address, network), signal);
  const allIds = [...new Set(history.map((h) => h.tx_hash))];
  const heights = new Map(history.map((h) => [h.tx_hash, h.height]));
  const ids = [
    ...allIds.filter((id) => !existing[id]),
    ...allIds.filter(
      (id) =>
        existing[id] &&
        ((existing[id].blockHeight === undefined && (existing[id].confirmations ?? 0) <= 0) ||
          (existing[id].blockHeight !== undefined &&
            existing[id].blockHeight !== heights.get(id)) ||
          (heights.get(id) ?? 0) <= 0),
    ),
  ];
  const detailTotal = Math.min(ids.length, MAX_SCAN_TRANSACTIONS);
  callbacks.onHistory?.(history, detailTotal, ids.length > MAX_SCAN_TRANSACTIONS);
  let loaded = 0;
  const transactions = await mapLimit(
    ids.slice(0, detailTotal),
    TRANSACTION_BATCH_CONCURRENCY,
    async (id) => {
      const transaction = await fetchTransaction(network, id, signal, heights.get(id), fetchHints);
      callbacks.onTransaction?.(transaction);
      onProgress?.({
        done: ++loaded,
        total: detailTotal,
        message: `Loading address history ${loaded}/${detailTotal}`,
      });
      return transaction;
    },
  );
  const requested = new Set(ids);
  for (const id of allIds) {
    if (!existing[id] || requested.has(id)) continue;
    const observed = withHistoryHeight(existing[id], heights.get(id)!);
    if (observed !== existing[id]) {
      transactions.push(observed);
      callbacks.onTransaction?.(observed);
    }
  }
  return {
    transactions,
    truncated: ids.length > MAX_SCAN_TRANSACTIONS,
    observedTransactionIds: allIds,
    history,
  };
}
export async function loadFunding(
  network: Network,
  tx: Transaction,
  existing: Record<string, Transaction>,
  signal?: AbortSignal,
  hints: TransactionFetchHints = {},
): Promise<Transaction[]> {
  const ids = [...new Set(tx.vin.flatMap((i) => (i.txid && !existing[i.txid] ? [i.txid] : [])))];
  if (ids.length > 500)
    throw new Error('Funding expansion is limited to 500 transactions at a time.');
  return mapLimit(ids, TRANSACTION_BATCH_CONCURRENCY, (id) =>
    fetchTransaction(network, id, signal, undefined, hints),
  );
}
function spendingSignal(
  network: Network,
  hints: TransactionFetchHints,
  signal?: AbortSignal,
): AbortSignal {
  assertNetwork(network);
  const scope = hints.scope ?? transactionScheduler.standalone;
  if (scope.closed) throw new DOMException('Transaction request cancelled.', 'AbortError');
  if (scope.network && scope.network !== network)
    throw new Error('Transaction request belongs to a different network.');
  const owned = signal ? AbortSignal.any([signal, scope.signal]) : scope.signal;
  owned.throwIfAborted();
  return owned;
}

export interface SpendingOutpoint {
  txid: string;
  vout: number;
}
const pointKey = (point: SpendingOutpoint) => `${point.txid}:${point.vout}`;
const spenderHash = z.string().regex(/^[0-9a-f]{64}$/);
const spenderPoint = z.strictObject({
  txid: spenderHash,
  vout: z.number().int().min(0).max(0x7fffffff),
});
const spenderReply = z
  .array(
    z.strictObject({
      txid: spenderHash,
      vout: z.number().int().min(0).max(0x7fffffff),
      spendingtxid: spenderHash.optional(),
      blockhash: spenderHash.optional(),
    }),
  )
  .max(500);
export interface IndexedSpenders {
  transactions: Transaction[];
  unresolved: SpendingOutpoint[];
  inspected: number;
  unavailableTxids: string[];
}
/** Optional exact lookup. An empty resolved row is a node observation, never UTXO proof.
 * Results live only in this action. Saved conflicting spends are never erased. */
export async function fetchIndexedSpenders(
  network: Network,
  points: SpendingOutpoint[],
  existing: Record<string, Transaction>,
  signal?: AbortSignal,
  hints: TransactionFetchHints = {},
  beforeInspect?: (txid: string) => void | boolean,
): Promise<IndexedSpenders | undefined> {
  signal = spendingSignal(network, hints, signal);
  const fetchHints: TransactionFetchHints = {
    ...hints,
    priority: 'background',
    observation: hints.observation ?? {},
  };
  if (!spenderIndexNetworks.has(network)) return undefined;
  const unique = [...new Map(points.map((point) => [pointKey(point), point])).values()];
  if (
    !unique.length ||
    unique.length > 500 ||
    unique.some((p) => !spenderPoint.safeParse(p).success)
  )
    return undefined;
  const wanted = new Set(unique.map(pointKey));
  const transactions = new Map(
    Object.values(existing)
      .filter((tx) =>
        tx.vin.some(
          (input) =>
            input.txid !== undefined &&
            input.vout !== undefined &&
            wanted.has(pointKey({ txid: input.txid, vout: input.vout })),
        ),
      )
      .map((tx) => [tx.txid, tx]),
  );
  let rows: z.infer<typeof spenderReply>;
  try {
    rows = spenderReply.parse(
      await rpc(
        network,
        'core',
        'gettxspendingprevout',
        [unique, { mempool_only: false, return_spending_tx: false }],
        signal,
      ),
    );
    if (
      rows.length !== unique.length ||
      new Set(rows.map(pointKey)).size !== unique.length ||
      rows.some(
        (row) =>
          !wanted.has(pointKey(row)) ||
          (row.blockhash !== undefined && row.spendingtxid === undefined),
      )
    )
      throw new Error('Invalid spender coverage.');
    // One transaction cannot simultaneously have inconsistent block observations.
    const blocks = new Map<string, string | undefined>();
    for (const row of rows)
      if (row.spendingtxid) {
        if (blocks.has(row.spendingtxid) && blocks.get(row.spendingtxid) !== row.blockhash)
          throw new Error('Conflicting spender observations.');
        blocks.set(row.spendingtxid, row.blockhash);
      }
  } catch (error) {
    signal?.throwIfAborted();
    if (
      beforeInspect &&
      ['backend-unavailable', 'rate-limited'].includes(classifyRpcFailure(error))
    )
      throw error;
    return {
      transactions: [...transactions.values()],
      unresolved: unique,
      inspected: 0,
      unavailableTxids: [],
    };
  }
  const groups = new Map<string, typeof rows>();
  for (const row of rows)
    if (row.spendingtxid) {
      const group = groups.get(row.spendingtxid) ?? [];
      group.push(row);
      groups.set(row.spendingtxid, group);
    }
  const unresolved: SpendingOutpoint[] = [];
  const boundedGroups = [...groups].slice(0, 250);
  let inspected = 0;
  for (const [, group] of [...groups].slice(250))
    unresolved.push(...group.map(({ txid, vout }) => ({ txid, vout })));
  await mapLimit(boundedGroups, TRANSACTION_BATCH_CONCURRENCY, async ([txid, group]) => {
    // Connection scans share this allowance with traversal and history fallback.
    // A declined candidate stays unresolved; thrown cancellation/deadline errors propagate.
    if (beforeInspect?.(txid) === false) {
      unresolved.push(...group.map(({ txid, vout }) => ({ txid, vout })));
      return;
    }
    inspected++;
    try {
      const blockhash = group[0].blockhash;
      let tx = existing[txid];
      if (tx) {
        validateTransactionAddresses(tx, network);
        if (blockhash) {
          const header = await fetchBlockHeight(
            network,
            blockhash,
            signal!,
            fetchHints.observation!,
            true,
          );
          if (!header) throw new Error('Containing block unavailable.');
          tx = {
            ...tx,
            blockhash,
            mempool: undefined,
            blockHeight: header.active ? header.height : undefined,
            confirmations: header.active ? undefined : -1,
            blocktime: undefined,
            time: undefined,
          };
        } else {
          tx = {
            ...tx,
            blockhash: undefined,
            blockHeight: undefined,
            blocktime: undefined,
            time: undefined,
            confirmations: 0,
            mempool: true,
          };
        }
      } else {
        tx = await fetchTransaction(network, txid, signal, undefined, fetchHints, blockhash);
      }
      signal?.throwIfAborted();
      if (
        group.some(
          (row) => !tx.vin.some((input) => input.txid === row.txid && input.vout === row.vout),
        )
      )
        throw new Error('Transaction does not spend the requested outpoint.');
      transactions.set(txid, tx);
      // A disconnected block, changed block, or uncertain fallback is not current coverage.
      if (
        (tx.confirmations ?? 0) < 0 ||
        (blockhash ? tx.blockhash !== blockhash || tx.blockHeight === undefined : !tx.mempool)
      )
        unresolved.push(...group.map(({ txid, vout }) => ({ txid, vout })));
    } catch (error) {
      signal?.throwIfAborted();
      if (
        beforeInspect &&
        ['backend-unavailable', 'rate-limited'].includes(classifyRpcFailure(error))
      )
        throw error;
      unresolved.push(...group.map(({ txid, vout }) => ({ txid, vout })));
    }
  });
  signal?.throwIfAborted();
  const unresolvedKeys = new Set(unresolved.map(pointKey));
  return {
    transactions: [...transactions.values()],
    unresolved,
    inspected,
    unavailableTxids: [...groups]
      .filter(([, group]) => group.some((row) => unresolvedKeys.has(pointKey(row))))
      .map(([id]) => id),
  };
}

export async function loadSpending(
  tx: Transaction,
  w: Workspace,
  vout: number | undefined,
  signal?: AbortSignal,
  offset = 0,
  hints: TransactionFetchHints = {},
  previousUnavailableTxids: readonly string[] = [],
): Promise<{
  transactions: Transaction[];
  truncated: boolean;
  nextOffset?: number;
  lookup?: 'index' | 'electrum-fallback';
  failed?: number;
  unavailableTxids?: string[];
}> {
  if (!z.array(spenderHash).max(500).safeParse(previousUnavailableTxids).success)
    throw new Error('Invalid spending continuation.');
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('Spending search offset must be a nonnegative safe integer.');
  signal = spendingSignal(w.network, hints, signal);
  const fetchHints: TransactionFetchHints = {
    ...hints,
    priority: 'background',
    observation: hints.observation ?? {},
  };
  const selected = tx.vout.filter((o) => vout === undefined || o.n === vout);
  // Continuations use the same complete script selection as the first fallback
  // page. Capability recovery must not change the list an offset addresses.
  const indexed =
    offset === 0
      ? await fetchIndexedSpenders(
          w.network,
          selected.map((o) => ({ txid: tx.txid, vout: o.n })),
          w.transactions,
          signal,
          fetchHints,
        )
      : undefined;
  if (indexed && !indexed.unresolved.length)
    return { transactions: indexed.transactions, truncated: false, lookup: 'index' };
  const outputs = selected;
  const hashes = outputs.map((output) => {
    const hex = output.scriptPubKey.hex;
    if (hex !== undefined) return bytesToHex(sha256(hexToBytes(hex)).reverse());
    const address = outputAddress(output);
    return address ? addressToScriptHash(address, w.network) : undefined;
  });
  const scripts = [...new Set(hashes.filter((h): h is string => h !== undefined))];
  if (!scripts.length && indexed)
    return { transactions: indexed.transactions, truncated: true, lookup: 'electrum-fallback' };
  if (!scripts.length)
    throw new Error(
      'Load the creating transaction first: these outputs have no script data to search.',
    );
  let failed = 0;
  const histories = await mapLimit(scripts, 4, async (hash) => {
    try {
      return await fetchHistory(w.network, hash, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!indexed && !previousUnavailableTxids.length) throw error;
      failed++;
      return [];
    }
  });
  const heights = new Map(
    histories.flatMap((history) => history.map((entry) => [entry.tx_hash, entry.height] as const)),
  );
  const ids = [...new Set(histories.flatMap((h) => h.map((e) => e.tx_hash)))]
    .filter((id) => id !== tx.txid)
    .sort();
  const wanted = new Set(outputs.map((o) => o.n));
  const budget = Math.max(0, 500 - (indexed?.inspected ?? 0));
  const nextOffset = offset + budget < ids.length ? offset + budget : undefined;
  const indexedTransactions = indexed
    ? new Map(indexed.transactions.map((transaction) => [transaction.txid, transaction]))
    : undefined;
  const candidates = await mapLimit(
    ids.slice(offset, offset + budget),
    TRANSACTION_BATCH_CONCURRENCY,
    async (id) => {
      try {
        const cached = indexedTransactions?.get(id) ?? w.transactions[id];
        return cached
          ? withHistoryHeight(cached, heights.get(id)!)
          : await fetchTransaction(w.network, id, signal, heights.get(id), fetchHints);
      } catch (error) {
        signal?.throwIfAborted();
        if (!indexed && !previousUnavailableTxids.length) throw error;
        failed++;
        return undefined;
      }
    },
  );
  signal?.throwIfAborted();
  const matches = candidates.filter(
    (t): t is Transaction =>
      !!t && t.vin.some((i) => i.txid === tx.txid && i.vout !== undefined && wanted.has(i.vout)),
  );
  // An offset cannot advance over failed transaction bytes or a history union
  // missing one script. Retrying reuses successful downloads from the workspace.
  const fallbackFailed = failed > 0;
  const resolvedIds = new Set(
    matches.filter((t) => (t.confirmations ?? 0) >= 0).map((t) => t.txid),
  );
  const unavailableTxids = [
    ...new Set([...previousUnavailableTxids, ...(indexed?.unavailableTxids ?? [])]),
  ].filter((id) => !resolvedIds.has(id));
  failed += unavailableTxids.length;
  return {
    transactions: [
      ...new Map([...(indexed?.transactions ?? []), ...matches].map((t) => [t.txid, t])).values(),
    ],
    truncated: nextOffset !== undefined || hashes.some((h) => h === undefined) || failed > 0,
    ...(indexed || previousUnavailableTxids.length
      ? { lookup: 'electrum-fallback' as const, ...(failed ? { failed } : {}) }
      : {}),
    ...(unavailableTxids.length ? { unavailableTxids } : {}),
    ...(!fallbackFailed && nextOffset !== undefined ? { nextOffset } : {}),
  };
}
