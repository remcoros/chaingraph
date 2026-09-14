import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Network, Transaction } from '../../../../../Domain/types';
import type {
  ScanBudget,
  ScanDirection,
  ScanNeighbors,
  ScanObservation,
} from '../../../../../Domain/ConnectionScan/connectionScan';
import {
  SCAN_LIMITS,
  ScanBudgetExceeded,
  isScanNodeId,
} from '../../../../../Domain/ConnectionScan/connectionScan';
import { outputAddress } from '../../../../../Domain/Workspace/workspace';
import { addressToScriptHash } from '../../../../../Domain/Wallet/wallet';
import {
  fetchHistory,
  fetchIndexedSpenders,
  fetchTransaction,
  type IndexedSpenders,
  type SpendingOutpoint,
} from '../../../../../Infra/Bitcoin/api';
import type { TransactionFetchScope } from '../../../../../Infra/Bitcoin/transactionScheduler';
import {
  fetchScanUtxo,
  isProvablyUnspendable,
  isVerifiedCoinbase,
  scanLookupFailure,
  ScanEvidenceConflict,
  validateScanTransaction,
} from './connectionScanEvidence';

export interface ConnectionScanFetchOptions {
  network: Network;
  transactions: Record<string, Transaction>;
  scope: TransactionFetchScope;
  signal: AbortSignal;
  allowNetwork?: boolean;
  fanOut?: number;
  /** Explicit retry: refresh each needed transaction once within this run's budget. */
  refresh?: boolean;
  /** Existing graph/result evidence index; values are transaction IDs, verified before use. */
  loadedSpenders?: (nodeId: string) => readonly string[];
}
export const connectionScanTransport = {
  fetchHistory,
  fetchIndexedSpenders,
  fetchTransaction,
  fetchUtxo: fetchScanUtxo,
};
export type ConnectionScanTransport = Omit<typeof connectionScanTransport, 'fetchUtxo'> & {
  /** Injection may omit the new leaf lookup; never fall through to real network in tests. */
  fetchUtxo?: typeof fetchScanUtxo;
};
const unknownSpend = (): ScanNeighbors => ({
  nodeIds: [],
  stopReason: 'unknown',
  observation: { finding: 'spend-unknown' },
});
const conflict = (): ScanNeighbors => ({
  nodeIds: [],
  stopReason: 'failure',
  observation: { finding: 'conflicting-evidence' },
});

/** One run owns this transient evidence. Nothing enters workspace observations here. */
export function createConnectionScanFetch(
  options: ConnectionScanFetchOptions,
  transport: ConnectionScanTransport = connectionScanTransport,
) {
  if (options.scope.network && options.scope.network !== options.network)
    throw new Error('Scan belongs to a different Bitcoin network.');
  if (options.network !== 'mainnet' && options.network !== 'testnet4')
    throw new Error('Choose mainnet or testnet4 for this scan.');
  const signal = AbortSignal.any([options.signal, options.scope.signal]);
  const evidence = { ...options.transactions };
  const spenders = new Map<string, Set<string>>();
  const refreshed = new Set<string>();
  const transactionLoads = new Map<string, Promise<Transaction>>();
  const utxoChecks = new Map<string, Promise<ScanObservation | undefined>>();
  const histories = new Map<string, ReturnType<typeof fetchHistory>>();
  let indexedInputs = 0;
  const index = async (tx: Transaction, budget: ScanBudget) => {
    for (const input of tx.vin) {
      if (++indexedInputs % 512 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
        budget.checkpoint();
      }
      if (!input.txid || input.vout === undefined) continue;
      const key = `out:${input.txid}:${input.vout}`;
      const ids = spenders.get(key) ?? new Set<string>();
      ids.add(tx.txid);
      spenders.set(key, ids);
    }
  };
  let initialIndex: Promise<void> | undefined;
  const ensureIndexed = (budget: ScanBudget) =>
    (initialIndex ??= (async () => {
      for (const txid in options.transactions) {
        budget.examine(txid);
        await index(options.transactions[txid]!, budget);
      }
    })());
  const hints = { scope: options.scope, priority: 'background' as const, observation: {} };
  const checkpoint = (budget: ScanBudget) => {
    signal.throwIfAborted();
    budget.checkpoint();
  };
  type IndexedLookup = Pick<IndexedSpenders, 'transactions' | 'unresolved'> | undefined;
  type IndexedRequest = {
    point: SpendingOutpoint;
    budget: ScanBudget;
    resolve: (value: IndexedLookup) => void;
    reject: (error: unknown) => void;
  };
  let indexedQueue: IndexedRequest[] = [];
  let indexedTimer: ReturnType<typeof setTimeout> | undefined;
  const takeIndexedQueue = () => {
    clearTimeout(indexedTimer);
    indexedTimer = undefined;
    signal.removeEventListener('abort', cancelIndexedQueue);
    const requests = indexedQueue;
    indexedQueue = [];
    return requests;
  };
  const cancelIndexedQueue = () => {
    for (const request of takeIndexedQueue()) request.reject(signal.reason);
  };
  const flushIndexedQueue = async () => {
    const requests = takeIndexedQueue();
    if (!requests.length) return;
    try {
      for (const request of requests) checkpoint(request.budget);
      // Resolver budgets share the run-wide allowance, including concurrent downloads.
      const budget = requests[0].budget;
      const points = [
        ...new Map(requests.map(({ point }) => [`${point.txid}:${point.vout}`, point])).values(),
      ];
      let transactionLimit = false;
      const indexed = await transport.fetchIndexedSpenders(
        options.network,
        points,
        {},
        signal,
        hints,
        (id) => {
          checkpoint(budget);
          try {
            budget.examine(id);
          } catch (error) {
            if (!(error instanceof ScanBudgetExceeded) || error.reason !== 'transactions')
              throw error;
            transactionLimit = true;
            return false;
          }
        },
      );
      checkpoint(budget);
      const transactions: Transaction[] = [];
      for (const value of indexed?.transactions ?? []) {
        budget.examine(value.txid);
        const tx = validateScanTransaction(value, value.txid, options.network);
        if (
          !points.some((point) =>
            tx.vin.some((input) => input.txid === point.txid && input.vout === point.vout),
          )
        )
          throw new ScanEvidenceConflict();
        transactions.push(tx);
      }
      // Validate the whole union before accepting any path; a spender may cover several points.
      for (const { point, resolve, reject } of requests) {
        const result = indexed
          ? {
              transactions: transactions.filter((tx) =>
                tx.vin.some((input) => input.txid === point.txid && input.vout === point.vout),
              ),
              unresolved: indexed.unresolved.filter(
                (item) => item.txid === point.txid && item.vout === point.vout,
              ),
            }
          : undefined;
        if (transactionLimit && !result?.transactions.length && result?.unresolved.length)
          reject(new ScanBudgetExceeded('transactions'));
        else resolve(result);
      }
    } catch (error) {
      for (const request of requests) request.reject(error);
    }
  };
  const indexedSpenders = (point: SpendingOutpoint, budget: ScanBudget) => {
    checkpoint(budget);
    return new Promise<IndexedLookup>((resolve, reject) => {
      indexedQueue.push({ point, budget, resolve, reject });
      if (indexedQueue.length >= 4) {
        void flushIndexedQueue();
      } else if (indexedTimer === undefined) {
        // Worker messages arrive in separate tasks, so a microtask would rarely batch them.
        indexedTimer = setTimeout(() => void flushIndexedQueue(), 2);
        signal.addEventListener('abort', cancelIndexedQueue, { once: true });
      }
    });
  };
  const historyFor = (hash: string, budget: ScanBudget) => {
    checkpoint(budget);
    let history = histories.get(hash);
    if (!history) {
      history = transport.fetchHistory(options.network, hash, signal).catch((error: unknown) => {
        histories.delete(hash);
        throw error;
      });
      histories.set(hash, history);
    }
    return history;
  };
  const load = async (txid: string, budget: ScanBudget, height?: number) => {
    checkpoint(budget);
    budget.examine(txid);
    const pending = transactionLoads.get(txid);
    if (pending) return pending;
    if (evidence[txid] && (!options.refresh || refreshed.has(txid))) return evidence[txid];
    if (options.allowNetwork === false) return undefined;
    const loading = (async () => {
      const value = await transport.fetchTransaction(options.network, txid, signal, height, hints);
      checkpoint(budget);
      const tx = validateScanTransaction(value, txid, options.network);
      await index(tx, budget);
      checkpoint(budget);
      evidence[txid] = tx;
      refreshed.add(txid);
      return tx;
    })();
    transactionLoads.set(txid, loading);
    try {
      return await loading;
    } finally {
      transactionLoads.delete(txid);
    }
  };
  const unavailable = (): ScanNeighbors =>
    options.allowNetwork === false
      ? { nodeIds: [], stopReason: 'offline' }
      : { nodeIds: [], stopReason: 'unknown', observation: { finding: 'transaction-unavailable' } };
  const resolveNeighbors = async (
    nodeId: string,
    direction: ScanDirection,
    budget: ScanBudget,
  ): Promise<ScanNeighbors> => {
    let failureContext: 'transaction' | 'spend' = 'transaction';
    try {
      checkpoint(budget);
      if (!isScanNodeId(nodeId)) return conflict();
      const [kind, txid, voutText] = nodeId.split(':');
      if (kind === 'tx') {
        const tx = await load(txid!, budget);
        if (!tx) return unavailable();
        if (direction === 'upstream' && isVerifiedCoinbase(tx))
          return { nodeIds: [], observation: { finding: 'coinbase' } };
        const branches =
          direction === 'downstream'
            ? tx.vout.length
            : tx.vin.filter((input) => input.txid && input.vout !== undefined).length;
        if (branches >= (options.fanOut ?? SCAN_LIMITS.fanOut))
          return {
            nodeIds: [],
            stopReason: 'fan-out',
            observation: {
              finding: direction === 'downstream' ? 'many-outputs' : 'many-inputs',
              branchCount: branches,
            },
          };
        if (direction === 'upstream' && !branches) return conflict();
        return {
          nodeIds:
            direction === 'downstream'
              ? tx.vout.map((output) => `out:${txid}:${output.n}`)
              : tx.vin.flatMap((input) =>
                  input.txid && input.vout !== undefined ? [`out:${input.txid}:${input.vout}`] : [],
                ),
        };
      }
      const point = { txid: txid!, vout: Number(voutText) };
      if (direction === 'upstream') {
        const creator = await load(point.txid, budget);
        if (!creator) return unavailable();
        if (!creator.vout.some((output) => output.n === point.vout)) {
          delete evidence[point.txid];
          return conflict();
        }
        return { nodeIds: [`tx:${txid}`] };
      }
      if (!options.loadedSpenders) await ensureIndexed(budget);
      checkpoint(budget);
      const known = [
        ...new Set([...(options.loadedSpenders?.(nodeId) ?? []), ...(spenders.get(nodeId) ?? [])]),
      ].sort();
      if (known.length) {
        const nodeIds: string[] = [];
        for (const id of known) {
          const spender = await load(id, budget);
          if (!spender) return unavailable();
          if (
            !spender.vin.some((input) => input.txid === point.txid && input.vout === point.vout)
          ) {
            delete evidence[id];
            return conflict();
          }
          const attached = spender.vin.find(
            (input) => input.txid === point.txid && input.vout === point.vout,
          )?.prevout;
          if (attached && isProvablyUnspendable(attached)) return conflict();
          nodeIds.push(`tx:${id}`);
        }
        if (evidence[point.txid]) {
          const creator = await load(point.txid, budget);
          const output = creator?.vout.find((item) => item.n === point.vout);
          if (!output || isProvablyUnspendable(output)) return conflict();
        }
        return nodeIds.length > 1 ? conflict() : { nodeIds };
      }
      // Reuse a loaded creator, but do not fetch a missing parent before exact spender lookup.
      let creator = options.refresh ? undefined : evidence[point.txid];
      if (creator) budget.examine(point.txid);
      let output = creator?.vout.find((item) => item.n === point.vout);
      if (creator && !output) {
        delete evidence[point.txid];
        return conflict();
      }
      if (output && isProvablyUnspendable(output))
        return { nodeIds: [], observation: { finding: 'unspendable' } };
      if (options.allowNetwork === false) return { nodeIds: [], stopReason: 'offline' };
      failureContext = 'spend';
      const currentUtxo = async (expected: NonNullable<typeof output>) => {
        if (!transport.fetchUtxo) return undefined;
        if (!utxoChecks.has(nodeId)) {
          checkpoint(budget);
          utxoChecks.set(
            nodeId,
            transport.fetchUtxo(options.network, point.txid, point.vout, expected, signal),
          );
        }
        const observation = await utxoChecks.get(nodeId);
        checkpoint(budget);
        return observation;
      };
      if (output) {
        const observation = await currentUtxo(output);
        if (observation) return { nodeIds: [], observation };
      }
      const indexed = await indexedSpenders(point, budget);
      checkpoint(budget);
      const validIndexed = indexed?.transactions ?? [];
      if (validIndexed.length > 1) return conflict();
      for (const tx of validIndexed) {
        budget.examine(tx.txid);
        await index(tx, budget);
        checkpoint(budget);
        evidence[tx.txid] = tx;
      }
      if (validIndexed.length) return { nodeIds: validIndexed.map((tx) => `tx:${tx.txid}`) };
      if (!output) {
        failureContext = 'transaction';
        creator = await load(point.txid, budget);
        if (!creator) return unavailable();
        output = creator.vout.find((item) => item.n === point.vout);
        if (!output) {
          delete evidence[point.txid];
          return conflict();
        }
        if (isProvablyUnspendable(output))
          return { nodeIds: [], observation: { finding: 'unspendable' } };
        failureContext = 'spend';
        const observation = await currentUtxo(output);
        if (observation) return { nodeIds: [], observation };
      }
      if (indexed && !indexed.unresolved.length) return unknownSpend();
      const hex = output.scriptPubKey.hex;
      const address = outputAddress(output);
      const hash =
        hex !== undefined
          ? bytesToHex(sha256(hexToBytes(hex)).reverse())
          : address
            ? addressToScriptHash(address, options.network)
            : undefined;
      if (!hash) return unknownSpend();
      const history = await historyFor(hash, budget);
      checkpoint(budget);
      const candidates = new Map(history.map((row) => [row.tx_hash, row.height]));
      for (const id of [...candidates.keys()].sort()) {
        if (id === point.txid) continue;
        failureContext = 'transaction';
        const tx = await load(id, budget, candidates.get(id));
        if (tx?.vin.some((input) => input.txid === point.txid && input.vout === point.vout))
          return { nodeIds: [`tx:${id}`] };
      }
      return unknownSpend();
    } catch (error) {
      if (error instanceof ScanBudgetExceeded) throw error;
      signal.throwIfAborted();
      return scanLookupFailure(error, failureContext);
    }
  };
  return { resolveNeighbors, evidence };
}
