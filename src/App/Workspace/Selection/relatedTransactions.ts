import { outpointReference } from '../../../Core/Workspace/entityReferences';
import type { GraphNode } from '../GraphState/types';
import type { Transaction } from '../../../Core/ChainData';

export function relatedTransactions(
  transactions: Record<string, Transaction>,
  selected: GraphNode,
  loadedSpends?: ReadonlyMap<string, readonly Transaction[]>,
): { tx: Transaction; role: 'Selected' | 'Creating' | 'Spending' | 'Related' }[] {
  if (selected.kind === 'transaction') {
    const tx = transactions[selected.txid ?? ''];
    return tx ? [{ tx, role: 'Selected' }] : [];
  }
  const result: ReturnType<typeof relatedTransactions> = [];
  if (selected.kind === 'output') {
    const creating = transactions[selected.txid ?? ''];
    if (creating) result.push({ tx: creating, role: 'Creating' });
    if (loadedSpends) {
      for (const tx of loadedSpends.get(outpointReference(selected.txid ?? '', selected.vout!)) ??
        [])
        result.push({ tx, role: 'Spending' });
      return result;
    }
    for (const tx of Object.values(transactions)) {
      if (tx.vin.some((input) => input.txid === selected.txid && input.vout === selected.vout))
        result.push({ tx, role: 'Spending' });
    }
  } else {
    const outputs = new Set<string>();
    for (const tx of Object.values(transactions)) {
      for (const output of tx.vout) {
        if (
          output.scriptPubKey.address === selected.address ||
          output.scriptPubKey.addresses?.includes(selected.address ?? '')
        )
          outputs.add(outpointReference(tx.txid, output.n));
      }
    }
    for (const tx of Object.values(transactions)) {
      if (
        tx.vout.some((output) => outputs.has(outpointReference(tx.txid, output.n))) ||
        tx.vin.some(
          (input) =>
            input.txid !== undefined && outputs.has(outpointReference(input.txid, input.vout!)),
        )
      )
        result.push({ tx, role: 'Related' });
    }
  }
  return result;
}
