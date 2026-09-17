import type { ChainDataDocument } from './chainData';
import type { Workspace } from './workspace';

/** Ancestry acquired only as context may be removed with its last dependent. */
function retainAsContext(
  data: ChainDataDocument,
  transactionIds: Iterable<string>,
): ChainDataDocument {
  const ids = new Set(data.contextTransactionIds ?? []);
  for (const id of transactionIds) if (data.transactions[id]) ids.add(id);
  return ids.size === (data.contextTransactionIds?.length ?? 0)
    ? data
    : { ...data, contextTransactionIds: [...ids] };
}

/** Independent lookup or discovery gives a transaction its own lifetime. */
function retainIndependently(
  data: ChainDataDocument,
  transactionIds: Iterable<string>,
): ChainDataDocument {
  const ids = new Set(transactionIds);
  if (!data.contextTransactionIds?.some((id) => ids.has(id))) return data;
  const remaining = data.contextTransactionIds.filter((id) => !ids.has(id));
  return { ...data, contextTransactionIds: remaining.length ? remaining : undefined };
}

/** Explicitly opened or discovered transactions acquire their complete graph. */
export function promoteInputContext(
  workspace: Workspace,
  transactionIds: Iterable<string>,
): Workspace {
  if (!workspace.view.inputContext) return workspace;
  const ids = [...transactionIds];
  const context = expandInputContext(workspace.view.inputContext, ids);
  return context === workspace.view.inputContext
    ? workspace
    : {
        ...workspace,
        chainData: retainAsContext(
          workspace.chainData,
          ids.filter((id) => workspace.view.inputContext?.[id]),
        ),
        view: { ...workspace.view, inputContext: context },
      };
}

/** Call only for observations newly fetched as ancestry, never an independent lookup. */
export function markContextTransactions(
  workspace: Workspace,
  transactionIds: Iterable<string>,
): Workspace {
  const chainData = retainAsContext(workspace.chainData, transactionIds);
  return chainData === workspace.chainData ? workspace : { ...workspace, chainData };
}

/** Direct lookup or wallet/address discovery gives the observations independent lifetime. */
export function clearContextProvenance(
  workspace: Workspace,
  transactionIds: Iterable<string>,
): Workspace {
  const ids = new Set(transactionIds);
  const promoted = promoteInputContext(workspace, ids);
  const chainData = retainIndependently(promoted.chainData, ids);
  return chainData === promoted.chainData ? promoted : { ...promoted, chainData };
}

/** Expand compact parents without deciding how long chain data is retained. */
function expandInputContext(
  context: Record<string, number[]> | undefined,
  transactionIds: Iterable<string>,
): Record<string, number[]> | undefined {
  if (!context) return context;
  let expanded = context;
  for (const id of transactionIds) {
    if (!expanded[id]) continue;
    if (expanded === context) expanded = { ...context };
    delete expanded[id];
  }
  return expanded === context ? context : Object.keys(expanded).length ? expanded : undefined;
}
