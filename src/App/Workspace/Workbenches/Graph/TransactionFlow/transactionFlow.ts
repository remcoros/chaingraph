import { outputNodeId } from '../../../../../Domain/Metadata/entityReferences';
import type { Transaction } from '../../../../../Domain/Chain/transaction';

/** Exact outpoints only. Several loaded spends remain alternatives, not a chain verdict. */
export function indexLoadedSpends(transactions: Record<string, Transaction>) {
  const result = new Map<string, Transaction[]>();
  for (const tx of Object.values(transactions)) {
    const seen = new Set<string>();
    for (const input of tx.vin) {
      if (input.coinbase !== undefined || input.txid === undefined || input.vout === undefined)
        continue;
      const id = outputNodeId(input.txid, input.vout);
      if (seen.has(id)) continue;
      seen.add(id);
      const spends = result.get(id) ?? [];
      spends.push(tx);
      result.set(id, spends);
    }
  }
  return result;
}

/** The same output is a destination in its creator and a source in its spender. */
export function selectedFlowLeg(tx: Transaction, outputId?: string) {
  if (!outputId) return undefined;
  const inputIndex = tx.vin.findIndex(
    (input) =>
      input.coinbase === undefined &&
      input.txid !== undefined &&
      input.vout !== undefined &&
      outputNodeId(input.txid, input.vout) === outputId,
  );
  if (inputIndex >= 0) return { direction: 'previous' as const, index: inputIndex };
  const output = tx.vout.find((output) => outputNodeId(tx.txid, output.n) === outputId);
  return output ? { direction: 'next' as const, index: output.n } : undefined;
}
