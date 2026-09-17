import type { Network, TxOutputDetails } from '../../Bitcoin';
import { type Transaction, parseTransaction, validateTransactionAddresses } from '../../ChainData';

import type { ScanNeighbors } from './connectionScan';
import type { ScanObservation } from './connectionScans';

import { classifyRpcFailure } from '../../ChainData/api';
import { fetchCurrentUtxo, UtxoObservationError } from '../../ChainData/utxoStatus';

export class ScanEvidenceConflict extends Error {
  constructor() {
    super('Observed transaction evidence conflicts.');
  }
}
export function validateScanTransaction(
  value: unknown,
  txid: string,
  network: Network,
): Transaction {
  const tx = parseTransaction(value);
  if (tx.txid !== txid) throw new ScanEvidenceConflict();
  try {
    validateTransactionAddresses(tx, network);
  } catch {
    throw new ScanEvidenceConflict();
  }
  return tx;
}
export function scanLookupFailure(error: unknown, context: 'transaction' | 'spend'): ScanNeighbors {
  if (
    error instanceof ScanEvidenceConflict ||
    (error instanceof UtxoObservationError && error.code === 'conflicting-evidence')
  )
    return { nodeIds: [], stopReason: 'failure', observation: { finding: 'conflicting-evidence' } };
  const failure =
    error instanceof UtxoObservationError ? 'invalid-response' : classifyRpcFailure(error);
  if (failure === 'conflicting-evidence')
    return { nodeIds: [], stopReason: 'failure', observation: { finding: 'conflicting-evidence' } };
  if (failure === 'backend-unavailable' || failure === 'rate-limited')
    return { nodeIds: [], stopReason: failure };
  if (context === 'transaction' && failure === 'lookup-failed')
    return {
      nodeIds: [],
      stopReason: 'unknown',
      observation: { finding: 'transaction-unavailable' },
    };
  return {
    nodeIds: [],
    stopReason: 'failure',
    observation: { finding: 'lookup-failed', issueCode: failure },
  };
}
export function isVerifiedCoinbase(tx: Transaction): boolean {
  const input = tx.vin[0];
  return (
    tx.vin.length === 1 &&
    !!input &&
    typeof input.coinbase === 'string' &&
    /^(?:[0-9a-f]{2})+$/i.test(input.coinbase) &&
    input.txid === undefined &&
    input.vout === undefined &&
    input.prevout === undefined
  );
}
export function isProvablyUnspendable(output: TxOutputDetails): boolean {
  return /^(?:6a)(?:[0-9a-f]{2})*$/i.test(output.scriptPubKey.hex ?? '');
}
/** Positive current observation only, tied to exact known script/value and selected network. */
export async function fetchScanUtxo(
  network: Network,
  txid: string,
  vout: number,
  expected: TxOutputDetails,
  signal: AbortSignal,
): Promise<ScanObservation | undefined> {
  if (expected.scriptPubKey.hex === undefined) return undefined;
  try {
    validateTransactionAddresses({ txid, vin: [], vout: [{ ...expected, n: vout }] }, network);
  } catch {
    throw new ScanEvidenceConflict();
  }
  const observation = await fetchCurrentUtxo(network, txid, vout, expected, signal);
  signal.throwIfAborted();
  if (observation.status !== 'unspent') return undefined;
  return {
    finding: 'unspent',
    checkedAt: observation.checkedAt,
    bestBlock: observation.bestblock!,
    includesMempool: true,
  };
}
