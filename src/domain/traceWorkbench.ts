import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { TransactionFetchHints } from '../lib/transactionScheduler';
import { fetchHistory, fetchTransaction, fetchIndexedSpenders } from '../lib/api';
import { addressToScriptHash } from '../lib/wallet';
import { fetchCurrentUtxo, type UtxoObservation } from '../lib/utxoStatus';
import { outputAddress } from './workspace';
import { indexPreviousOutputs, resolvePreviousOutput } from './prevouts';
import { outputNodeId, sats, type GraphNode, type Transaction, type Workspace } from './types';

export const TRACE_CANDIDATE_LIMIT = 12;
export const TRACE_TIMEOUT_MS = 15_000;
export const TRACE_TRAIL_LIMIT = 40;
export interface TraceOutpoint {
  txid: string;
  vout: number;
}
export function selectedOutpoint(selected?: GraphNode): TraceOutpoint | undefined {
  return selected?.kind === 'output' && selected.txid !== undefined && selected.vout !== undefined
    ? { txid: selected.txid, vout: selected.vout }
    : undefined;
}
export const traceId = (point: TraceOutpoint) => outputNodeId(point.txid, point.vout);
export function loadedSpenders(workspace: Workspace, point: TraceOutpoint): Transaction[] {
  return Object.values(workspace.transactions).filter((tx) =>
    tx.vin.some((input) => input.txid === point.txid && input.vout === point.vout),
  );
}

/** Shape hints never assert a satoshi mapping, owner, or calibrated probability. */
export function continuationHint(tx: Transaction): {
  title: string;
  explanation: string;
  automatic: false;
} {
  const spendable = tx.vout.filter(
    (output) =>
      output.scriptPubKey.type !== 'nulldata' && !output.scriptPubKey.hex?.startsWith('6a'),
  );
  const equal = new Set(spendable.map((output) => sats(output.value))).size < spendable.length;
  if (equal && tx.vin.length > 1)
    return {
      title: 'Ambiguous continuation',
      explanation:
        'Multiple inputs and equal outputs can occur in CoinJoin. This pattern does not prove CoinJoin. Choose a branch explicitly; no automatic continuation.',
      automatic: false,
    };
  if (tx.vin.length > 1 && spendable.length === 1)
    return {
      title: 'Possible consolidation',
      explanation:
        'Multiple inputs feed one spendable output. This shape is consistent with consolidation, but collaborative funding is possible. It does not prove common ownership or map individual satoshis. Choose the output explicitly.',
      automatic: false,
    };
  if (tx.vin.length > 1)
    return {
      title: 'Ambiguous continuation',
      explanation:
        'Multiple inputs and outputs: PayJoin or another collaborative transaction cannot be ruled out. There is no authoritative input-to-output satoshi mapping. Choose a branch explicitly.',
      automatic: false,
    };
  if (spendable.length === 1)
    return {
      title: 'Sole-output continuation',
      explanation:
        'One spendable output remains after the transaction fee and any unspendable data outputs. This is a structural candidate, not evidence of the same owner. Confirm the output to continue.',
      automatic: false,
    };
  return {
    title: 'Choose a continuation',
    explanation:
      'Several outputs are possible. Amount alone does not identify payment or change, and Bitcoin records no authoritative input-to-output satoshi mapping.',
    automatic: false,
  };
}

export interface TraceSearchResult {
  transactions: Transaction[];
  observation?: UtxoObservation;
  inspected: number;
  remaining: number;
  failed: number;
  statusUnavailable: boolean;
}

/** Optional exact lookup, then one script history; at most 12 candidates in total. */
export async function searchTraceSpenders(
  workspace: Workspace,
  point: TraceOutpoint,
  signal: AbortSignal,
  hints: TransactionFetchHints = {},
): Promise<TraceSearchResult> {
  if (hints.scope) signal = AbortSignal.any([signal, hints.scope.signal]);
  signal.throwIfAborted();
  const fetchHints: TransactionFetchHints = {
    ...hints,
    priority: 'background',
    observation: hints.observation ?? {},
  };
  const indexed = await fetchIndexedSpenders(
    workspace.network,
    [point],
    workspace.transactions,
    signal,
    fetchHints,
  );
  if (indexed && !indexed.unresolved.length)
    return {
      transactions: indexed.transactions,
      inspected: indexed.inspected,
      remaining: 0,
      failed: 0,
      statusUnavailable: false,
    };
  const resolution = resolvePreviousOutput(workspace, point, indexPreviousOutputs(workspace));
  const output =
    resolution.status === 'loaded' || resolution.status === 'attached'
      ? resolution.output
      : undefined;
  if (!output)
    throw new Error(
      'Previous-output details are unavailable. Load the creating transaction first.',
    );
  const failedIds = new Set(indexed?.unavailableTxids ?? []);
  const result: TraceSearchResult = {
    transactions: indexed?.transactions ?? [],
    inspected: indexed?.inspected ?? 0,
    remaining: 0,
    failed: failedIds.size,
    statusUnavailable: false,
  };
  try {
    result.observation = await fetchCurrentUtxo(
      workspace.network,
      point.txid,
      point.vout,
      output,
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    result.statusUnavailable = true;
  }
  signal.throwIfAborted();
  if (result.observation?.status === 'unspent') return result;
  const hex = output.scriptPubKey.hex;
  const address = outputAddress(output);
  const hash =
    hex !== undefined
      ? bytesToHex(sha256(hexToBytes(hex)).reverse())
      : address
        ? addressToScriptHash(address, workspace.network)
        : undefined;
  if (hash === undefined)
    throw new Error('Output script data is missing. Reload its creating transaction in Graph.');
  let history;
  try {
    history = await fetchHistory(workspace.network, hash, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (!indexed) throw error;
    result.failed++;
    return result;
  }
  signal.throwIfAborted();
  const candidates = [
    ...new Map(
      history.filter((item) => item.tx_hash !== point.txid).map((item) => [item.tx_hash, item]),
    ).values(),
  ];
  const budget = TRACE_CANDIDATE_LIMIT - result.inspected;
  result.remaining = Math.max(0, candidates.length - budget);
  for (const candidate of candidates.slice(0, budget)) {
    signal.throwIfAborted();
    try {
      const candidateTx =
        workspace.transactions[candidate.tx_hash] ??
        (await fetchTransaction(
          workspace.network,
          candidate.tx_hash,
          signal,
          candidate.height,
          fetchHints,
        ));
      signal.throwIfAborted();
      if (candidateTx.vin.some((input) => input.txid === point.txid && input.vout === point.vout)) {
        result.transactions = [
          ...result.transactions.filter((tx) => tx.txid !== candidateTx.txid),
          candidateTx,
        ];
        if ((candidateTx.confirmations ?? 0) >= 0) failedIds.delete(candidateTx.txid);
      }
    } catch (error) {
      signal.throwIfAborted();
      failedIds.add(candidate.tx_hash);
    }
    result.inspected++;
  }
  signal.throwIfAborted();
  result.failed = failedIds.size;
  return result;
}
