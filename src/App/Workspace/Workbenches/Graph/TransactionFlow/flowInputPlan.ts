import type { GraphNode } from '../../../GraphState/types';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import { relatedTransactions } from '../../../Selection/relatedTransactions';
import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
} from '../../../../../Core/ChainData';

export type FlowPlanWorkspace = Pick<Workspace, 'network'> & {
  chainData: Pick<Workspace['chainData'], 'transactions'>;
} & {
  view: Pick<Workspace['view'], 'panels'>;
};

/** A selected unknown outpoint still hydrates its creator when the flow UI is collapsed. */
export function shouldLoadFlowInputs(
  workspace: Pick<Workspace, 'view'> & { chainData: Pick<Workspace['chainData'], 'transactions'> },
  selected?: GraphNode,
): boolean {
  return (
    workspace.view.panels?.flow?.height !== 'collapsed' ||
    (selected?.kind === 'output' &&
      !!selected.txid &&
      !workspace.chainData.transactions[selected.txid])
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
    prepared?.related ??
    (selected ? relatedTransactions(workspace.chainData.transactions, selected) : []);
  const current =
    related.find(({ tx }) => tx.txid === workspace.view.panels?.flow?.transactionId) ?? related[0];
  const prevouts = allInputs
    ? (prepared?.prevouts ??
      indexPreviousOutputs({
        network: workspace.network,
        transactions: workspace.chainData.transactions,
      }))
    : undefined;
  const missing = new Set(
    allInputs
      ? (current?.tx.vin.flatMap((input) => {
          if (!input.txid || workspace.chainData.transactions[input.txid]) return [];
          const resolution = resolvePreviousOutput(
            { network: workspace.network, transactions: workspace.chainData.transactions },
            input,
            prevouts,
          );
          return resolution.status === 'missing' || resolution.status === 'conflict'
            ? [input.txid]
            : [];
        }) ?? [])
      : [],
  );
  if (
    selected?.kind === 'output' &&
    selected.txid &&
    !workspace.chainData.transactions[selected.txid]
  )
    missing.add(selected.txid);
  return { transactionId: current?.tx.txid, missing: [...missing] };
}
