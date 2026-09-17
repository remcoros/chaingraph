import { MAX_HIDDEN_NODES, assertHiddenNodeBudget } from '../../../Core/Workspace/view';
import type { Workspace } from '../../../Core/Workspace/workspace';
import {
  canonicalEntityReference,
  outpointReference,
} from '../../../Core/Workspace/entityReferences';

import type { Transaction } from '../../../Core/ChainData';

export function setNodesHidden(
  workspace: Workspace,
  nodeIds: Iterable<string>,
  hidden: boolean,
): Workspace {
  const previous = workspace.view.hiddenNodeIds ?? [];
  assertHiddenNodeBudget(previous);
  const ids = new Set(previous);
  let changed = false;
  let supplied = 0;
  for (const value of nodeIds) {
    if (++supplied > MAX_HIDDEN_NODES)
      throw new Error('A visibility action supports at most 50,000 entity references.');
    const id = canonicalEntityReference(value, workspace.network);
    if (hidden && !ids.has(id)) {
      ids.add(id);
      changed = true;
      if (ids.size > MAX_HIDDEN_NODES)
        throw new Error('Workspace exceeds the 50,000 hidden entity limit.');
    } else if (!hidden && ids.delete(id)) changed = true;
  }
  return changed
    ? {
        ...workspace,
        view: { ...workspace.view, hiddenNodeIds: ids.size ? [...ids] : undefined },
      }
    : workspace;
}

export function showAllNodes(workspace: Workspace): Workspace {
  return workspace.view.hiddenNodeIds?.length
    ? {
        ...workspace,
        view: { ...workspace.view, hiddenNodeIds: undefined },
      }
    : workspace;
}

/** Inputs refer to previous output entities. Coinbase has no previous output to hide. */
export function transactionNodeIds(transaction: Transaction, side: 'inputs' | 'outputs'): string[] {
  return side === 'outputs'
    ? transaction.vout.map((output) => outpointReference(transaction.txid, output.n))
    : [
        ...new Set(
          transaction.vin.flatMap((input) =>
            input.coinbase === undefined && input.txid !== undefined && input.vout !== undefined
              ? [outpointReference(input.txid, input.vout)]
              : [],
          ),
        ),
      ];
}
