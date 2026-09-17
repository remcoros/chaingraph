import {
  canonicalAddress,
  canonicalEntityReference,
  outpointReference,
  transactionReference,
} from './entityReferences';
import type { Workspace } from './workspace';

import { outputAddress } from '../Bitcoin';
import { buildWalletMatches } from './Wallets/walletMatches';

export interface EntityRemovalPlan {
  nodeId: string;
  kind: 'transaction' | 'watched-address';
  affectedNodeIds: string[];
  annotationCount: number;
  tagMembershipCount: number;
  requiresConfirmation: boolean;
  removedTransactionIds: string[];
  automaticContextCount: number;
}

/** Human metadata and wallet/watch observations make automatic context worth retaining. */
function contextIds(workspace: Workspace): Set<string> {
  return new Set([
    ...(workspace.chainData.contextTransactionIds ?? []),
    ...Object.keys(workspace.view.inputContext ?? {}),
  ]);
}

function protectedContext(workspace: Workspace): Set<string> {
  const protectedIds = new Set<string>();
  const addresses = new Set(workspace.chainData.watchedAddresses.map(canonicalAddress));
  const retainReference = (id: string) => {
    if (id.startsWith('tx:')) protectedIds.add(id.slice(3));
    else if (id.startsWith('out:')) protectedIds.add(id.slice(4).split(':')[0]);
    else if (id.startsWith('addr:')) addresses.add(canonicalAddress(id.slice(5)));
  };
  for (const [id, annotation] of Object.entries(workspace.annotations.entities))
    if (annotation.label || annotation.note || annotation.icon || annotation.bookmarked)
      retainReference(id);
  for (const tag of workspace.annotations.tags ?? [])
    for (const id of tag.nodeIds) retainReference(id);
  for (const wallet of workspace.wallets.definitions) {
    for (const address of wallet.addresses) {
      addresses.add(canonicalAddress(address.address));
      for (const item of address.history ?? []) protectedIds.add(item.tx_hash);
    }
    for (const id of [
      ...(wallet.pendingTransactionIds ?? []),
      ...(wallet.unreviewedTransactionIds ?? []),
      ...(wallet.lastActivity?.newTransactionIds ?? []),
    ])
      protectedIds.add(id);
  }
  if (addresses.size)
    for (const id of contextIds(workspace)) {
      const transaction = workspace.chainData.transactions[id];
      if (
        transaction?.vout.some((output) => {
          const address = outputAddress(output);
          return address !== undefined && addresses.has(canonicalAddress(address));
        })
      )
        protectedIds.add(id);
    }
  if (workspace.wallets.definitions.some((wallet) => wallet.addresses.length)) {
    const nodes = [...contextIds(workspace)].map((id) => ({
      id: transactionReference(id),
      txid: id,
      kind: 'transaction' as const,
      label: id,
    }));
    for (const [id] of buildWalletMatches(workspace, nodes)) protectedIds.add(id.slice(3));
  }
  return protectedIds;
}

/** Only the removed transaction's automatic ancestor branch is eligible for cleanup. */
function removalTransactions(workspace: Workspace, txid: string): Set<string> {
  const candidates = new Set([txid]);
  const automatic = contextIds(workspace);
  const pending = [txid];
  while (pending.length) {
    const transaction = workspace.chainData.transactions[pending.pop()!];
    for (const input of transaction?.vin ?? []) {
      if (!input.txid || !automatic.has(input.txid) || candidates.has(input.txid)) continue;
      candidates.add(input.txid);
      pending.push(input.txid);
    }
  }
  if (candidates.size === 1) return candidates;
  const protectedIds = protectedContext(workspace);
  const retained = new Set(
    Object.keys(workspace.chainData.transactions).filter(
      (id) => id !== txid && (!candidates.has(id) || protectedIds.has(id)),
    ),
  );
  // References from any retained observation retain its automatic ancestry too.
  pending.push(...retained);
  while (pending.length) {
    for (const input of workspace.chainData.transactions[pending.pop()!]?.vin ?? []) {
      if (
        !input.txid ||
        input.txid === txid ||
        retained.has(input.txid) ||
        !workspace.chainData.transactions[input.txid]
      )
        continue;
      retained.add(input.txid);
      pending.push(input.txid);
    }
  }
  return new Set([...candidates].filter((id) => !retained.has(id)));
}

/** Removing cached observations never edits an individual Bitcoin input or output. */
export function planEntityRemoval(
  workspace: Workspace,
  reference: string,
): EntityRemovalPlan | undefined {
  const nodeId = canonicalEntityReference(reference, workspace.network);
  const txid = nodeId.startsWith('tx:') ? nodeId.slice(3) : undefined;
  const address = nodeId.startsWith('addr:') ? nodeId.slice(5) : undefined;
  const transaction = txid ? workspace.chainData.transactions[txid] : undefined;
  if (
    !transaction &&
    (!address ||
      !workspace.chainData.watchedAddresses.some((item) => canonicalAddress(item) === address))
  )
    return;
  const removed = transaction
    ? removalTransactions(workspace, transaction.txid)
    : new Set<string>();
  const affected = new Set([nodeId]);
  const belongs = (id: string) =>
    id === nodeId ||
    (id.startsWith('tx:') && removed.has(id.slice(3))) ||
    (id.startsWith('out:') && removed.has(id.slice(4).split(':')[0]));
  for (const id of removed) {
    affected.add(transactionReference(id));
    for (const output of workspace.chainData.transactions[id].vout)
      affected.add(outpointReference(id, output.n));
  }
  let annotationCount = 0;
  for (const [id, annotation] of Object.entries(workspace.annotations.entities)) {
    if (!belongs(id)) continue;
    affected.add(id);
    if (annotation.label || annotation.note || annotation.icon || annotation.bookmarked)
      annotationCount++;
  }
  let tagMembershipCount = 0;
  for (const tag of workspace.annotations.tags ?? [])
    for (const id of tag.nodeIds)
      if (belongs(id)) {
        affected.add(id);
        tagMembershipCount++;
      }
  return {
    nodeId,
    kind: transaction ? 'transaction' : 'watched-address',
    affectedNodeIds: [...affected],
    annotationCount,
    tagMembershipCount,
    requiresConfirmation: annotationCount > 0 || tagMembershipCount > 0,
    removedTransactionIds: [...removed],
    automaticContextCount: transaction ? removed.size - 1 : 0,
  };
}

/** Re-plan at application time; callers confirm against the active workspace immediately before calling. */
export function removeWorkspaceEntity(workspace: Workspace, reference: string): Workspace {
  const plan = planEntityRemoval(workspace, reference);
  if (!plan) return workspace;
  const affected = new Set(plan.affectedNodeIds);
  const annotations = Object.fromEntries(
    Object.entries(workspace.annotations.entities).filter(([id]) => !affected.has(id)),
  );
  const tags = workspace.annotations.tags?.map((tag) => ({
    ...tag,
    nodeIds: tag.nodeIds.filter((id) => !affected.has(id)),
  }));
  if (plan.kind === 'watched-address')
    return {
      ...workspace,
      chainData: {
        ...workspace.chainData,
        watchedAddresses: workspace.chainData.watchedAddresses.filter(
          (address) => canonicalAddress(address) !== plan.nodeId.slice(5),
        ),
      },
      annotations: { ...workspace.annotations, entities: annotations, tags: tags },
    };
  const removed = new Set(plan.removedTransactionIds);
  const transactions = { ...workspace.chainData.transactions };
  for (const id of removed) delete transactions[id];
  const protectedIds = protectedContext(workspace);
  const changedParents = new Set(
    plan.removedTransactionIds.flatMap((id) =>
      workspace.chainData.transactions[id].vin.flatMap((input) => (input.txid ? [input.txid] : [])),
    ),
  );
  const required = new Map<string, Set<number>>();
  for (const transaction of Object.values(transactions))
    for (const input of transaction.vin) {
      if (!input.txid || input.vout === undefined || !workspace.view.inputContext?.[input.txid])
        continue;
      if (!transactions[input.txid]?.vout.some((output) => output.n === input.vout)) continue;
      const outputs = required.get(input.txid) ?? new Set<number>();
      outputs.add(input.vout);
      required.set(input.txid, outputs);
    }
  const inputContext = Object.fromEntries(
    Object.entries(workspace.view.inputContext ?? {})
      .filter(([id]) => !removed.has(id))
      .map(([id, outputs]) => {
        // Preserve independently meaningful context scopes. Shared unannotated parents
        // retain only outputs still used by the remaining branch.
        const needed = required.get(id);
        return [
          id,
          needed?.size && changedParents.has(id) && !protectedIds.has(id)
            ? [...needed].sort((a, b) => a - b)
            : outputs,
        ];
      }),
  );
  const filters = workspace.view.filters;
  return {
    ...workspace,
    chainData: {
      ...workspace.chainData,
      contextTransactionIds: workspace.chainData.contextTransactionIds?.filter(
        (id) => !removed.has(id),
      ),
      transactions: transactions,
    },
    annotations: { ...workspace.annotations, entities: annotations, tags: tags },
    analysis: {
      ...workspace.analysis,
      findings: workspace.analysis.findings.filter(
        (finding) =>
          !finding.txids.some((id) => removed.has(id)) &&
          !finding.nodeIds.some((id) => affected.has(id)),
      ),
    },
    view: {
      ...workspace.view,
      hiddenNodeIds: workspace.view.hiddenNodeIds?.filter((id) => !affected.has(id)),
      graphSnapshot: workspace.view.graphSnapshot
        ? {
            ...workspace.view.graphSnapshot,
            nodes: workspace.view.graphSnapshot.nodes.filter((node) => !affected.has(node.id)),
          }
        : undefined,
      filters: filters
        ? {
            ...filters,
            focus: filters.focus && affected.has(filters.focus.id) ? undefined : filters.focus,
            includeIds: filters.includeIds?.filter((id) => !affected.has(id)),
          }
        : undefined,
      selectionId:
        workspace.view.selectionId && affected.has(workspace.view.selectionId)
          ? undefined
          : workspace.view.selectionId,
      panels: {
        ...workspace.view.panels,
        flow:
          workspace.view.panels?.flow?.transactionId &&
          removed.has(workspace.view.panels.flow.transactionId)
            ? {
                ...workspace.view.panels.flow,
                transactionId: undefined,
              }
            : workspace.view.panels?.flow,
      },
      inputContext: Object.keys(inputContext).length ? inputContext : undefined,
    },
  };
}
