import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { Network, Transaction, TxOutputDetails } from '../domain/types';
import type { ScanBudget, ScanDirection, ScanNeighbors } from '../domain/connectionScan';
import { ScanBudgetExceeded } from '../domain/connectionScan';
import { outputAddress } from '../domain/workspace';
import { addressToScriptHash } from './wallet';
import { fetchHistory, fetchIndexedSpenders, fetchTransaction } from './api';
import type { TransactionFetchScope } from './transactionScheduler';

export interface ConnectionScanFetchOptions {
  network: Network;
  transactions: Record<string, Transaction>;
  scope: TransactionFetchScope;
  signal: AbortSignal;
  allowNetwork?: boolean;
  fanOut?: number;
  /** Existing graph/result evidence index; values are transaction IDs, verified before use. */
  loadedSpenders?: (nodeId: string) => readonly string[];
}
export const connectionScanTransport = { fetchHistory, fetchIndexedSpenders, fetchTransaction };

/** One run owns this transient evidence. Nothing enters workspace observations here. */
export function createConnectionScanFetch(
  options: ConnectionScanFetchOptions,
  transport = connectionScanTransport,
) {
  if (options.scope.network && options.scope.network !== options.network)
    throw new Error('Scan belongs to a different Bitcoin network.');
  if (options.network !== 'mainnet' && options.network !== 'testnet4')
    throw new Error('Choose mainnet or testnet4 for this scan.');
  const signal = AbortSignal.any([options.signal, options.scope.signal]);
  const evidence = { ...options.transactions };
  const spenders = new Map<string, Set<string>>();
  const prevouts = new Map<string, TxOutputDetails>();
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
      if (input.prevout) prevouts.set(key, input.prevout);
    }
  };
  let initialIndex: Promise<void> | undefined;
  const ensureIndexed = (budget: ScanBudget) =>
    (initialIndex ??= (async () => {
      // Yield while preparing loaded relationships, including inside large inputs.
      for (const txid in options.transactions) {
        budget.examine(txid);
        await index(options.transactions[txid]!, budget);
      }
    })());
  const hints = { scope: options.scope, priority: 'background' as const, observation: {} };
  const load = async (txid: string, budget: ScanBudget, height?: number) => {
    budget.checkpoint();
    signal.throwIfAborted();
    budget.examine(txid);
    if (evidence[txid]) return evidence[txid];
    if (options.allowNetwork === false) return undefined;
    const tx = await transport.fetchTransaction(options.network, txid, signal, height, hints);
    signal.throwIfAborted();
    budget.checkpoint();
    evidence[txid] = tx;
    await index(tx, budget);
    return tx;
  };
  const resolveNeighbors = async (
    nodeId: string,
    direction: Exclude<ScanDirection, 'both'>,
    budget: ScanBudget,
  ): Promise<ScanNeighbors> => {
    try {
      signal.throwIfAborted();
      budget.checkpoint();
      const match = /^(tx|out):([0-9a-f]{64})(?::([0-9]+))?$/.exec(nodeId);
      if (!match || (match[1] === 'out') !== (match[3] !== undefined))
        return { nodeIds: [], stopReason: 'failure' };
      const [, kind, txid, voutText] = match;
      if (kind === 'tx') {
        const tx = await load(txid, budget);
        if (!tx) return { nodeIds: [], stopReason: 'unknown' };
        const branchLimit = options.fanOut ?? 200;
        let branches = direction === 'downstream' ? tx.vout.length : 0;
        if (direction === 'upstream')
          for (const input of tx.vin) {
            if (input.txid && input.vout !== undefined && ++branches >= branchLimit) break;
          }
        if (branches >= branchLimit) return { nodeIds: [], stopReason: 'fan-out' };
        return {
          nodeIds:
            direction === 'downstream'
              ? tx.vout.map((output) => `out:${txid}:${output.n}`)
              : tx.vin.flatMap((input) =>
                  input.txid && input.vout !== undefined ? [`out:${input.txid}:${input.vout}`] : [],
                ),
        };
      }
      const point = { txid, vout: Number(voutText) };
      if (direction === 'upstream') {
        const creator = await load(txid, budget);
        if (!creator) return { nodeIds: [], stopReason: 'unknown' };
        return creator.vout.some((output) => output.n === point.vout)
          ? { nodeIds: [`tx:${txid}`] }
          : { nodeIds: [], stopReason: 'failure' };
      }
      if (!options.loadedSpenders) await ensureIndexed(budget);
      signal.throwIfAborted();
      budget.checkpoint();
      const known = [
        ...new Set([...(options.loadedSpenders?.(nodeId) ?? []), ...(spenders.get(nodeId) ?? [])]),
      ].sort();
      if (known.length) {
        const nodeIds: string[] = [];
        let stopReason: ScanNeighbors['stopReason'];
        for (const id of known) {
          const spender = await load(id, budget);
          if (!spender) {
            stopReason ??= 'unknown';
            continue;
          }
          if (spender.vin.some((input) => input.txid === txid && input.vout === point.vout))
            nodeIds.push(`tx:${id}`);
          else stopReason = 'failure';
        }
        return { nodeIds, ...(stopReason ? { stopReason } : {}) };
      }
      if (options.allowNetwork === false) return { nodeIds: [], stopReason: 'unknown' };
      // A single exact outpoint keeps optional-index candidates tightly bounded.
      const indexed = await transport.fetchIndexedSpenders(
        options.network,
        [point],
        {},
        signal,
        hints,
        (id) => {
          signal.throwIfAborted();
          budget.checkpoint();
          budget.examine(id);
        },
      );
      signal.throwIfAborted();
      budget.checkpoint();
      for (const tx of indexed?.transactions ?? []) {
        evidence[tx.txid] = tx;
        await index(tx, budget);
      }
      if (indexed && !indexed.unresolved.length)
        return indexed.transactions.length
          ? { nodeIds: indexed.transactions.map((tx) => `tx:${tx.txid}`) }
          : { nodeIds: [], stopReason: 'unknown' };
      // Attached prevouts often avoid loading a creator merely for its script.
      budget.examine(txid);
      let output: TxOutputDetails | undefined =
        evidence[txid]?.vout.find((value) => value.n === point.vout) ?? prevouts.get(nodeId);
      if (!output)
        output = (await load(txid, budget))?.vout.find((value) => value.n === point.vout);
      if (!output) return { nodeIds: [], stopReason: 'unknown' };
      const hex = output.scriptPubKey.hex;
      const address = outputAddress({ ...output, n: point.vout });
      const hash =
        hex !== undefined
          ? bytesToHex(sha256(hexToBytes(hex)).reverse())
          : address
            ? addressToScriptHash(address, options.network)
            : undefined;
      if (!hash) return { nodeIds: [], stopReason: 'unknown' };
      const history = await transport.fetchHistory(options.network, hash, signal);
      signal.throwIfAborted();
      budget.checkpoint();
      const candidates = new Map(history.map((row) => [row.tx_hash, row.height]));
      for (const id of [...candidates.keys()].sort()) {
        if (id === txid) continue;
        // This gate charges every history candidate, including unrelated cached ones.
        const tx = await load(id, budget, candidates.get(id));
        if (tx?.vin.some((input) => input.txid === txid && input.vout === point.vout))
          return { nodeIds: [`tx:${tx.txid}`] };
      }
      const retained = [...(spenders.get(nodeId) ?? [])].sort();
      return { nodeIds: retained.map((id) => `tx:${id}`), stopReason: 'unknown' };
    } catch (error) {
      if (error instanceof ScanBudgetExceeded) throw error;
      signal.throwIfAborted();
      return { nodeIds: [], stopReason: 'failure' };
    }
  };
  return { resolveNeighbors, evidence };
}
