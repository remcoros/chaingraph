import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Network, Transaction } from '../domain/types';
import type {
  ScanBudget,
  ScanDirection,
  ScanNeighbors,
  ScanObservation,
} from '../domain/connectionScan';
import { ScanBudgetExceeded, isScanNodeId } from '../domain/connectionScan';
import { outputAddress } from '../domain/workspace';
import { addressToScriptHash } from './wallet';
import { fetchHistory, fetchIndexedSpenders, fetchTransaction } from './api';
import type { TransactionFetchScope } from './transactionScheduler';
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
  const utxoChecks = new Map<string, ScanObservation | undefined>();
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
  const load = async (txid: string, budget: ScanBudget, height?: number) => {
    checkpoint(budget);
    budget.examine(txid);
    if (evidence[txid] && (!options.refresh || refreshed.has(txid))) return evidence[txid];
    if (options.allowNetwork === false) return undefined;
    const value = await transport.fetchTransaction(options.network, txid, signal, height, hints);
    checkpoint(budget);
    const tx = validateScanTransaction(value, txid, options.network);
    evidence[txid] = tx;
    refreshed.add(txid);
    await index(tx, budget);
    return tx;
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
        if (branches >= (options.fanOut ?? 200))
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
          const observation = await transport.fetchUtxo(
            options.network,
            point.txid,
            point.vout,
            expected,
            signal,
          );
          checkpoint(budget);
          utxoChecks.set(nodeId, observation);
        }
        return utxoChecks.get(nodeId);
      };
      if (output) {
        const observation = await currentUtxo(output);
        if (observation) return { nodeIds: [], observation };
      }
      const indexed = await transport.fetchIndexedSpenders(
        options.network,
        [point],
        {},
        signal,
        hints,
        (id) => {
          checkpoint(budget);
          budget.examine(id);
        },
      );
      checkpoint(budget);
      const validIndexed: Transaction[] = [];
      for (const value of indexed?.transactions ?? []) {
        budget.examine(value.txid);
        const tx = validateScanTransaction(value, value.txid, options.network);
        if (!tx.vin.some((input) => input.txid === point.txid && input.vout === point.vout))
          throw new ScanEvidenceConflict();
        validIndexed.push(tx);
      }
      if (validIndexed.length > 1) return conflict();
      for (const tx of validIndexed) {
        evidence[tx.txid] = tx;
        await index(tx, budget);
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
      const history = await transport.fetchHistory(options.network, hash, signal);
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
