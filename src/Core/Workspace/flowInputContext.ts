import { type Transaction, mergeTransactionObservations } from '../ChainData';
import type { Workspace } from './workspace';

export interface FlowInputTarget {
  txid: string;
  vout: number;
}

/** Keep automatically fetched parents as focused input context until explicitly inspected. */
export function mergeFlowInputs(
  workspace: Workspace,
  transactionId: string | undefined,
  selected: FlowInputTarget | undefined,
  loaded: Transaction[],
  allInputs = false,
) {
  // A removal may complete while its input requests are in flight. Never restore
  // the removed investigation branch when those requests finally arrive.
  if (transactionId && !workspace.chainData.transactions[transactionId]) return workspace;
  const context = { ...workspace.view.inputContext };
  const provenance = new Set([
    ...(workspace.chainData.contextTransactionIds ?? []),
    ...Object.keys(context),
  ]);
  const current = transactionId ? workspace.chainData.transactions[transactionId] : undefined;
  const references = allInputs
    ? (current?.vin.flatMap((input) =>
        input.txid && input.vout !== undefined ? [{ txid: input.txid, vout: input.vout }] : [],
      ) ?? [])
    : [];
  if (selected && selected.txid && selected.vout !== undefined)
    references.push({ txid: selected.txid, vout: selected.vout });
  const added = new Set(loaded.map((tx) => tx.txid));
  for (const ref of references) {
    if (ref.txid === transactionId) continue;
    if (context[ref.txid] || (added.has(ref.txid) && !workspace.chainData.transactions[ref.txid]))
      context[ref.txid] = [...new Set([...(context[ref.txid] ?? []), ref.vout])].sort(
        (a, b) => a - b,
      );
  }
  for (const tx of loaded) if (!workspace.chainData.transactions[tx.txid]) provenance.add(tx.txid);
  if (transactionId && (allInputs || !selected)) delete context[transactionId];
  const inputContext = Object.keys(context).length ? context : undefined;
  if (
    !loaded.length &&
    JSON.stringify(inputContext) === JSON.stringify(workspace.view.inputContext)
  )
    return workspace;
  return {
    ...workspace,
    chainData: {
      ...workspace.chainData,
      contextTransactionIds: provenance.size ? [...provenance] : undefined,
      transactions: loaded.length
        ? {
            ...workspace.chainData.transactions,
            ...Object.fromEntries(
              loaded.map((tx) => [
                tx.txid,
                mergeTransactionObservations(
                  workspace.chainData.transactions[tx.txid],
                  tx,
                  workspace.network,
                ),
              ]),
            ),
          }
        : workspace.chainData.transactions,
    },
    view: { ...workspace.view, inputContext: inputContext },
  };
}
