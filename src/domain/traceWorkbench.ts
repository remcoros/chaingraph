import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { fetchHistory, fetchTransaction } from '../lib/api';
import { addressToScriptHash } from '../lib/wallet';
import { fetchCurrentUtxo, type UtxoObservation } from '../lib/utxoStatus';
import { outputAddress } from './workspace';
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

/** One script history, at most 12 candidate transactions, only exact spenders returned. */
export async function searchTraceSpenders(
  workspace: Workspace,
  point: TraceOutpoint,
  signal: AbortSignal,
): Promise<TraceSearchResult> {
  signal.throwIfAborted();
  const tx = workspace.transactions[point.txid];
  const output = tx?.vout.find((item) => item.n === point.vout);
  if (!output) throw new Error('Load the creating transaction before searching for a spender.');
  const result: TraceSearchResult = {
    transactions: [],
    inspected: 0,
    remaining: 0,
    failed: 0,
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
  const history = await fetchHistory(workspace.network, hash, signal);
  signal.throwIfAborted();
  const candidates = [
    ...new Map(
      history.filter((item) => item.tx_hash !== point.txid).map((item) => [item.tx_hash, item]),
    ).values(),
  ];
  result.remaining = Math.max(0, candidates.length - TRACE_CANDIDATE_LIMIT);
  for (const candidate of candidates.slice(0, TRACE_CANDIDATE_LIMIT)) {
    signal.throwIfAborted();
    try {
      const candidateTx =
        workspace.transactions[candidate.tx_hash] ??
        (await fetchTransaction(workspace.network, candidate.tx_hash, signal, candidate.height));
      signal.throwIfAborted();
      if (candidateTx.vin.some((input) => input.txid === point.txid && input.vout === point.vout))
        result.transactions.push(candidateTx);
    } catch (error) {
      signal.throwIfAborted();
      result.failed++;
    }
    result.inspected++;
  }
  signal.throwIfAborted();
  return result;
}
