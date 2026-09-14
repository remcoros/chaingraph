import type { Workspace } from '../types';
import type { GraphFilters } from './graphFilters';
import { addGraphNodes } from './graphMembership';
import { buildGraph, outputAddress, promoteInputContext } from '../Workspace/workspace';

/** Resolve exact evidence references before leaving a finding, including input
 * outpoints whose creators are not loaded. Selection can hydrate that one creator
 * through the normal flow-input path; this pure resolver never fetches or invents values.
 */
export function resolveGraphHandoff(
  workspace: Workspace,
  requestedIds: readonly string[],
  supportingTxids: readonly string[] = [],
) {
  const promote = new Set<string>();
  for (const id of requestedIds) {
    const match = /^(tx|out):([0-9a-f]{64})(?::([0-9]+))?$/.exec(id);
    if (match) {
      const [, kind, txid, index] = match;
      const creator = workspace.transactions[txid];
      if (creator && (kind === 'tx' || creator.vout.some((out) => out.n === Number(index))))
        promote.add(txid);
      if (kind === 'out') {
        for (const support of supportingTxids) {
          if (
            workspace.transactions[support]?.vin.some(
              (input) => input.txid === txid && input.vout === Number(index),
            )
          )
            promote.add(support);
        }
      }
    } else if (id.startsWith('addr:')) {
      for (const txid of Object.keys(workspace.inputContext ?? {})) {
        if (workspace.transactions[txid]?.vout.some((out) => outputAddress(out) === id.slice(5)))
          promote.add(txid);
      }
    }
  }
  const promoted = promoteInputContext(workspace, promote);
  const next = requestedIds.some((id) => id.startsWith('addr:'))
    ? { ...promoted, view: { ...promoted.view, showAddresses: true } }
    : promoted;
  const available = new Set(buildGraph(next).nodes.map((node) => node.id));
  let ids = [...new Set(requestedIds)].filter((id) => available.has(id));
  // Findings without entity references can still open their supporting transactions.
  // Never silently substitute a different entity for an explicitly clicked reference.
  if (!requestedIds.length)
    ids = [...new Set(supportingTxids.map((txid) => `tx:${txid}`))].filter((id) =>
      available.has(id),
    );
  const hidden = new Set(next.view.hiddenNodeIds);
  const selectedId = ids.find((id) => !hidden.has(id)) ?? ids[0];
  return selectedId ? { workspace: next, ids, selectedId } : undefined;
}

export interface GraphNavigationOptions {
  isolate?: boolean;
  selectedId?: string;
  /** Tag/wallet scope controls retain their live membership filter. */
  filters?: GraphFilters;
}

/** Only explicitly referenced transactions, never their ancestors or other inputs. */
export function graphNavigationTransactionIds(nodeIds: readonly string[]): string[] {
  return [
    ...new Set(
      nodeIds.flatMap((id) => {
        const match = /^(?:tx|out):([0-9a-f]{64})(?::[0-9]+)?$/.exec(id);
        return match ? [match[1]] : [];
      }),
    ),
  ];
}

/** Shared Show/Isolate preparation. Callers own fetching and wallet verification;
 * the UI consumes the returned selection and filters and requests explicit centering.
 */
export function prepareGraphNavigation(
  workspace: Workspace,
  nodeIds: readonly string[],
  options: GraphNavigationOptions = {},
) {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return undefined;
  const selectedId =
    options.selectedId && ids.includes(options.selectedId) ? options.selectedId : ids[0];
  const transactionIds = graphNavigationTransactionIds(ids);
  const admitted = addGraphNodes(promoteInputContext(workspace, transactionIds), ids);
  const addresses = ids.filter((id) => id.startsWith('addr:')).map((id) => id.slice(5));
  const filters: GraphFilters =
    options.filters ??
    (options.isolate
      ? ids.length === 1
        ? { focus: { id: selectedId, hops: 1 } }
        : { includeIds: ids, preserveContext: true }
      : {});
  return {
    ids,
    selectedId,
    filters,
    workspace: {
      ...admitted,
      watchedAddresses: addresses.length
        ? [...new Set([...admitted.watchedAddresses, ...addresses])]
        : admitted.watchedAddresses,
      view: {
        ...admitted.view,
        showAddresses: addresses.length > 0 || admitted.view.showAddresses,
        smallAmountThreshold: undefined,
        // An outpoint link must expose its input/output row, even when the flow
        // was collapsed. Missing creators use the existing bounded input loader.
        transactionFlow: selectedId.startsWith('out:')
          ? { ...admitted.view.transactionFlow, open: true }
          : admitted.view.transactionFlow,
      },
    },
  };
}
