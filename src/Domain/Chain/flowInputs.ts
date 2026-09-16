import type { GraphNode, Transaction, Workspace } from '../types';
import { mergeTransactionObservations } from './prevouts';

/** Keep automatically fetched parents as focused input context until explicitly inspected. */
export function mergeFlowInputs(
  workspace: Workspace,
  transactionId: string | undefined,
  selected: GraphNode | undefined,
  loaded: Transaction[],
  allInputs = false,
) {
  // A removal may complete while its input requests are in flight. Never restore
  // the removed investigation branch when those requests finally arrive.
  if (transactionId && !workspace.transactions[transactionId]) return workspace;
  const context = { ...workspace.inputContext };
  const provenance = new Set([...(workspace.contextTransactionIds ?? []), ...Object.keys(context)]);
  const current = transactionId ? workspace.transactions[transactionId] : undefined;
  const references = allInputs
    ? (current?.vin.flatMap((input) =>
        input.txid && input.vout !== undefined ? [{ txid: input.txid, vout: input.vout }] : [],
      ) ?? [])
    : [];
  if (selected?.kind === 'output' && selected.txid && selected.vout !== undefined)
    references.push({ txid: selected.txid, vout: selected.vout });
  const added = new Set(loaded.map((tx) => tx.txid));
  for (const ref of references) {
    if (ref.txid === transactionId) continue;
    if (context[ref.txid] || (added.has(ref.txid) && !workspace.transactions[ref.txid]))
      context[ref.txid] = [...new Set([...(context[ref.txid] ?? []), ref.vout])].sort(
        (a, b) => a - b,
      );
  }
  for (const tx of loaded) if (!workspace.transactions[tx.txid]) provenance.add(tx.txid);
  if (transactionId && (allInputs || selected?.kind !== 'output')) delete context[transactionId];
  const inputContext = Object.keys(context).length ? context : undefined;
  if (!loaded.length && JSON.stringify(inputContext) === JSON.stringify(workspace.inputContext))
    return workspace;
  return {
    ...workspace,
    inputContext,
    contextTransactionIds: provenance.size ? [...provenance] : undefined,
    transactions: loaded.length
      ? {
          ...workspace.transactions,
          ...Object.fromEntries(
            loaded.map((tx) => [
              tx.txid,
              mergeTransactionObservations(workspace.transactions[tx.txid], tx, workspace.network),
            ]),
          ),
        }
      : workspace.transactions,
  };
}
