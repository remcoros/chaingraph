import type { Transaction } from '../../../Core/ChainData';
/** A hidden entity is still a valid trace source; a removed branch is not. */
export function traceSourceExists(
  workspace: { transactions: Record<string, Transaction> },
  nodeId: string,
): boolean {
  const [kind, txid, index] = nodeId.split(':');
  if (kind === 'tx') return !!workspace.transactions[txid];
  if (kind !== 'out') return false;
  const n = Number(index);
  return (
    !!workspace.transactions[txid]?.vout.some((output) => output.n === n) ||
    Object.values(workspace.transactions).some((tx) =>
      tx.vin.some((input) => input.txid === txid && input.vout === n),
    )
  );
}
