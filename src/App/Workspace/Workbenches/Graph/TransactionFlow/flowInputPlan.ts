import type { GraphNode, Workspace } from '../../../../../Domain/types';
import { relatedTransactions } from '../../../../../Domain/Chain/relatedTransactions';
import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
} from '../../../../../Domain/Chain/prevouts';

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
