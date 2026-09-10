import type { Workspace } from './types';
import { buildGraph, outputAddress, promoteInputContext } from './workspace';

/** Resolve loaded evidence before leaving a finding. Promoting compact context
 * exposes observations already in memory, including unknown input placeholders.
 * It neither downloads parents nor turns missing values into known amounts.
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
  // Selecting a missing creator's placeholder starts an automatic parent lookup.
  // Keep a finding handoff on loaded evidence and show that input in its supporting
  // transaction's flow, where the user can explicitly choose to investigate it.
  let ids = [...new Set(requestedIds)].filter((id) => available.has(id));
  let selectableIds = ids.filter((id) => {
    const output = /^out:([0-9a-f]{64}):[0-9]+$/.exec(id);
    return !output || !!workspace.transactions[output[1]];
  });
  const usedSupportingTransaction = !selectableIds.length;
  if (usedSupportingTransaction) {
    selectableIds = supportingTxids.map((txid) => `tx:${txid}`).filter((id) => available.has(id));
    ids = [...new Set([...ids, ...selectableIds])];
  }
  const hidden = new Set(next.view.hiddenNodeIds);
  const selectedId = selectableIds.find((id) => !hidden.has(id)) ?? selectableIds[0];
  return selectedId ? { workspace: next, ids, selectedId, usedSupportingTransaction } : undefined;
}
