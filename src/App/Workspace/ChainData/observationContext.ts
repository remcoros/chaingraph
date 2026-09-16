import type { Workspace } from '../../../Domain/Workspace/workspaceTypes';

/** Explicitly opened or discovered transactions acquire their complete graph. */
export function promoteInputContext(
  workspace: Workspace,
  transactionIds: Iterable<string>,
): Workspace {
  if (!workspace.inputContext) return workspace;
  let context = workspace.inputContext;
  const provenance = new Set(workspace.contextTransactionIds ?? []);
  for (const id of transactionIds) {
    if (!context[id]) continue;
    if (context === workspace.inputContext) context = { ...context };
    delete context[id];
    provenance.add(id);
  }
  return context === workspace.inputContext
    ? workspace
    : {
        ...workspace,
        inputContext: Object.keys(context).length ? context : undefined,
        contextTransactionIds: [...provenance],
      };
}

/** Call only for observations newly fetched as ancestry, never an independent lookup. */
export function markContextTransactions(
  workspace: Workspace,
  transactionIds: Iterable<string>,
): Workspace {
  const ids = new Set(workspace.contextTransactionIds ?? []);
  for (const id of transactionIds) if (workspace.transactions[id]) ids.add(id);
  return ids.size === (workspace.contextTransactionIds?.length ?? 0)
    ? workspace
    : { ...workspace, contextTransactionIds: [...ids] };
}

/** Direct lookup or wallet/address discovery gives the observations independent lifetime. */
export function clearContextProvenance(
  workspace: Workspace,
  transactionIds: Iterable<string>,
): Workspace {
  const ids = new Set(transactionIds);
  const promoted = promoteInputContext(workspace, ids);
  if (!promoted.contextTransactionIds?.some((id) => ids.has(id))) return promoted;
  const remaining = promoted.contextTransactionIds.filter((id) => !ids.has(id));
  return { ...promoted, contextTransactionIds: remaining.length ? remaining : undefined };
}
