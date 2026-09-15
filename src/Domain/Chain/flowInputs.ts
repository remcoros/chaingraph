import type { GraphNode, Transaction, Workspace } from '../types';
import { relatedTransactions } from './transactionInspection';
import { indexPreviousOutputs, resolvePreviousOutput, type PreviousOutputIndex } from './prevouts';
import { mergeTransactionObservations } from './prevouts';

export type FlowPlanWorkspace = Pick<Workspace, 'network' | 'transactions'> & {
  view: Pick<Workspace['view'], 'panels'>;
};

/** A selected unknown outpoint still hydrates its creator when the flow UI is collapsed. */
export function shouldLoadFlowInputs(
  workspace: Pick<Workspace, 'transactions' | 'view'>,
  selected?: GraphNode,
): boolean {
  return (
    workspace.view.panels?.flow?.height !== 'collapsed' ||
    (selected?.kind === 'output' && !!selected.txid && !workspace.transactions[selected.txid])
  );
}

export function flowInputPlan(
  workspace: FlowPlanWorkspace,
  selected?: GraphNode,
  allInputs = false,
  prepared?: {
    related: ReturnType<typeof relatedTransactions>;
    prevouts: PreviousOutputIndex;
  },
) {
  const related =
    prepared?.related ?? (selected ? relatedTransactions(workspace.transactions, selected) : []);
  const current =
    related.find(({ tx }) => tx.txid === workspace.view.panels?.flow?.transactionId) ?? related[0];
  const prevouts = allInputs ? (prepared?.prevouts ?? indexPreviousOutputs(workspace)) : undefined;
  const missing = new Set(
    allInputs
      ? (current?.tx.vin.flatMap((input) => {
          if (!input.txid || workspace.transactions[input.txid]) return [];
          const resolution = resolvePreviousOutput(workspace, input, prevouts);
          return resolution.status === 'missing' || resolution.status === 'conflict'
            ? [input.txid]
            : [];
        }) ?? [])
      : [],
  );
  if (selected?.kind === 'output' && selected.txid && !workspace.transactions[selected.txid])
    missing.add(selected.txid);
  return { transactionId: current?.tx.txid, missing: [...missing] };
}

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
