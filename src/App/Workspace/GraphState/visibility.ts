import { z } from 'zod';
import { canonicalEntityNodeId } from '../../../Domain/Metadata/entityReferences';
import type { Network } from '../../../Domain/Chain/network';
import { outputNodeId } from '../../../Domain/Metadata/entityReferences';
import type { Transaction } from '../../../Domain/Chain/transaction';
import type { Workspace } from '../workspace';

export const MAX_HIDDEN_NODES = 50_000;
export const hiddenNodeIdsSchema = z.array(z.string().max(200)).max(MAX_HIDDEN_NODES);

export function assertHiddenNodeBudget(value: unknown): void {
  if (Array.isArray(value) && value.length > MAX_HIDDEN_NODES)
    throw new Error('Workspace exceeds the 50,000 hidden entity limit.');
}

export function parseHiddenNodeIds(value: unknown, network: Network): string[] {
  assertHiddenNodeBudget(value);
  return [
    ...new Set(hiddenNodeIdsSchema.parse(value).map((id) => canonicalEntityNodeId(id, network))),
  ];
}

/** Hide exactly these entities. This never edits transaction observations or linked entities. */
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
    const id = canonicalEntityNodeId(value, workspace.network);
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
    ? transaction.vout.map((output) => outputNodeId(transaction.txid, output.n))
    : [
        ...new Set(
          transaction.vin.flatMap((input) =>
            input.coinbase === undefined && input.txid !== undefined && input.vout !== undefined
              ? [outputNodeId(input.txid, input.vout)]
              : [],
          ),
        ),
      ];
}
