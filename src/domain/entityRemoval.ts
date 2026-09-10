import { canonicalAddress, canonicalEntityNodeId } from './entityReferences';
import { outputNodeId, short, txNodeId, type Workspace } from './types';
import { buildGraph, outputAddress } from './workspace';
import { buildWalletMatches } from './tags';

export interface EntityRemovalPlan {
  nodeId: string;
  kind: 'transaction' | 'watched-address';
  title: string;
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
    ...(workspace.contextTransactionIds ?? []),
    ...Object.keys(workspace.inputContext ?? {}),
  ]);
}

function protectedContext(workspace: Workspace): Set<string> {
  const protectedIds = new Set<string>();
  const addresses = new Set(workspace.watchedAddresses.map(canonicalAddress));
  const retainReference = (id: string) => {
    if (id.startsWith('tx:')) protectedIds.add(id.slice(3));
    else if (id.startsWith('out:')) protectedIds.add(id.slice(4).split(':')[0]);
    else if (id.startsWith('addr:')) addresses.add(canonicalAddress(id.slice(5)));
  };
  for (const [id, annotation] of Object.entries(workspace.annotations))
    if (annotation.label || annotation.note || annotation.icon || annotation.bookmarked)
      retainReference(id);
  for (const tag of workspace.tags ?? []) for (const id of tag.nodeIds) retainReference(id);
  for (const wallet of workspace.wallets) {
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
      const transaction = workspace.transactions[id];
      if (
        transaction?.vout.some((output) => {
          const address = outputAddress(output);
          return address !== undefined && addresses.has(canonicalAddress(address));
        })
      )
        protectedIds.add(id);
    }
  if (workspace.wallets.some((wallet) => wallet.addresses.length)) {
    const nodes = [...contextIds(workspace)].map((id) => ({
      id: txNodeId(id),
      txid: id,
      kind: 'transaction' as const,
      label: id,
    }));
    for (const [id] of buildWalletMatches(workspace, { nodes, links: [] }))
      protectedIds.add(id.slice(3));
  }
  return protectedIds;
}

/** Only the removed transaction's automatic ancestor branch is eligible for cleanup. */
function removalTransactions(workspace: Workspace, txid: string): Set<string> {
  const candidates = new Set([txid]);
  const automatic = contextIds(workspace);
  const pending = [txid];
  while (pending.length) {
    const transaction = workspace.transactions[pending.pop()!];
    for (const input of transaction?.vin ?? []) {
      if (!input.txid || !automatic.has(input.txid) || candidates.has(input.txid)) continue;
      candidates.add(input.txid);
      pending.push(input.txid);
    }
  }
  if (candidates.size === 1) return candidates;
  const protectedIds = protectedContext(workspace);
  const retained = new Set(
    Object.keys(workspace.transactions).filter(
      (id) => id !== txid && (!candidates.has(id) || protectedIds.has(id)),
    ),
  );
  // References from any retained observation retain its automatic ancestry too.
  pending.push(...retained);
  while (pending.length) {
    for (const input of workspace.transactions[pending.pop()!]?.vin ?? []) {
      if (
        !input.txid ||
        input.txid === txid ||
        retained.has(input.txid) ||
        !workspace.transactions[input.txid]
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
  const nodeId = canonicalEntityNodeId(reference, workspace.network);
  const txid = nodeId.startsWith('tx:') ? nodeId.slice(3) : undefined;
  const address = nodeId.startsWith('addr:') ? nodeId.slice(5) : undefined;
  const transaction = txid ? workspace.transactions[txid] : undefined;
  if (
    !transaction &&
    (!address || !workspace.watchedAddresses.some((item) => canonicalAddress(item) === address))
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
    affected.add(txNodeId(id));
    for (const output of workspace.transactions[id].vout) affected.add(outputNodeId(id, output.n));
  }
  let annotationCount = 0;
  for (const [id, annotation] of Object.entries(workspace.annotations)) {
    if (!belongs(id)) continue;
    affected.add(id);
    if (annotation.label || annotation.note || annotation.icon || annotation.bookmarked)
      annotationCount++;
  }
  let tagMembershipCount = 0;
  for (const tag of workspace.tags ?? [])
    for (const id of tag.nodeIds)
      if (belongs(id)) {
        affected.add(id);
        tagMembershipCount++;
      }
  return {
    nodeId,
    kind: transaction ? 'transaction' : 'watched-address',
    title:
      workspace.annotations[nodeId]?.label || (transaction ? short(transaction.txid) : address!),
    affectedNodeIds: [...affected],
    annotationCount,
    tagMembershipCount,
    requiresConfirmation: annotationCount > 0 || tagMembershipCount > 0,
    removedTransactionIds: [...removed],
    automaticContextCount: transaction ? removed.size - 1 : 0,
  };
}

/** Forget vanished entities without dropping shared outpoints or unrelated future references. */
function pruneRemovedGraphMembership(before: Workspace, after: Workspace): Workspace {
  const admitted = before.view.graphNodeIds;
  if (!admitted?.length) return after;
  const fullGraph = (workspace: Workspace) =>
    buildGraph({
      ...workspace,
      inputContext: undefined,
      view: { ...workspace.view, showAddresses: true },
    });
  const remaining = new Set(fullGraph(after).nodes.map((node) => node.id));
  const vanished = new Set(
    fullGraph(before).nodes.flatMap((node) => (remaining.has(node.id) ? [] : [node.id])),
  );
  const graphNodeIds = admitted.filter((id) => !vanished.has(id));
  return graphNodeIds.length === admitted.length
    ? after
    : { ...after, view: { ...after.view, graphNodeIds } };
}

/** Re-plan at application time; callers confirm against the active workspace immediately before calling. */
export function removeWorkspaceEntity(workspace: Workspace, reference: string): Workspace {
  const plan = planEntityRemoval(workspace, reference);
  if (!plan) return workspace;
  const affected = new Set(plan.affectedNodeIds);
  const annotations = Object.fromEntries(
    Object.entries(workspace.annotations).filter(([id]) => !affected.has(id)),
  );
  const tags = workspace.tags?.map((tag) => ({
    ...tag,
    nodeIds: tag.nodeIds.filter((id) => !affected.has(id)),
  }));
  if (plan.kind === 'watched-address')
    return pruneRemovedGraphMembership(workspace, {
      ...workspace,
      watchedAddresses: workspace.watchedAddresses.filter(
        (address) => canonicalAddress(address) !== plan.nodeId.slice(5),
      ),
      annotations,
      tags,
    });
  const removed = new Set(plan.removedTransactionIds);
  const transactions = { ...workspace.transactions };
  for (const id of removed) delete transactions[id];
  const protectedIds = protectedContext(workspace);
  const changedParents = new Set(
    plan.removedTransactionIds.flatMap((id) =>
      workspace.transactions[id].vin.flatMap((input) => (input.txid ? [input.txid] : [])),
    ),
  );
  const required = new Map<string, Set<number>>();
  for (const transaction of Object.values(transactions))
    for (const input of transaction.vin) {
      if (!input.txid || input.vout === undefined || !workspace.inputContext?.[input.txid])
        continue;
      if (!transactions[input.txid]?.vout.some((output) => output.n === input.vout)) continue;
      const outputs = required.get(input.txid) ?? new Set<number>();
      outputs.add(input.vout);
      required.set(input.txid, outputs);
    }
  const inputContext = Object.fromEntries(
    Object.entries(workspace.inputContext ?? {})
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
  return pruneRemovedGraphMembership(workspace, {
    ...workspace,
    inputContext: Object.keys(inputContext).length ? inputContext : undefined,
    contextTransactionIds: workspace.contextTransactionIds?.filter((id) => !removed.has(id)),
    transactions,
    annotations,
    tags,
    findings: workspace.findings.filter(
      (finding) =>
        !finding.txids.some((id) => removed.has(id)) &&
        !finding.nodeIds.some((id) => affected.has(id)),
    ),
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
      transactionFlow:
        workspace.view.transactionFlow?.transactionId &&
        removed.has(workspace.view.transactionFlow.transactionId)
          ? { ...workspace.view.transactionFlow, transactionId: undefined }
          : workspace.view.transactionFlow,
    },
  });
}
