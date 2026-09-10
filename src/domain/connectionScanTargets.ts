import { isScanNodeId, SCAN_LIMITS } from './connectionScan';
import type { Transaction } from './types';
import { outputNodeId } from './types';

/**
 * Freeze explicit picks and the immediate I/O of picked transactions. Evidence
 * comes from the validated workspace network; this helper performs no lookups.
 * Missing observations and excess targets reject the entire set, never a subset.
 */
export function prepareCustomScanTargets({
  pickedNodeIds,
  transactions,
  source,
}: {
  pickedNodeIds: readonly string[];
  transactions: Readonly<Record<string, Transaction>>;
  source: string;
}): string[] {
  if (!isScanNodeId(source)) throw new Error('Choose a transaction or output as the scan source.');
  const targets = new Set<string>();
  const add = (id: string) => {
    if (!isScanNodeId(id)) throw new Error('Scan targets must be valid transactions or outputs.');
    if (id === source) return;
    targets.add(id);
    if (targets.size > SCAN_LIMITS.maxTargets)
      throw new Error(
        'Picked targets and their inputs/outputs exceed 1,000 targets. Remove a pick.',
      );
  };
  for (const id of new Set(pickedNodeIds)) {
    add(id);
    if (!id.startsWith('tx:')) continue;
    const txid = id.slice(3);
    const transaction = transactions[txid];
    if (!transaction)
      throw new Error(
        'Load the picked transaction to include its inputs and outputs, or remove it.',
      );
    if (transaction.txid !== txid)
      throw new Error('Picked transaction evidence does not match its ID.');
    for (const input of transaction.vin) {
      if (input.coinbase !== undefined && input.txid === undefined && input.vout === undefined)
        continue;
      if (input.coinbase !== undefined || input.txid === undefined || input.vout === undefined)
        throw new Error('Picked transaction input references are incomplete.');
      add(outputNodeId(input.txid, input.vout));
    }
    for (const output of transaction.vout) add(outputNodeId(txid, output.n));
  }
  return [...targets].sort();
}
