import { canonicalAddress, canonicalEntityNodeId } from './entityReferences';
import { outputNodeId, short, type Workspace } from './types';
import { promoteInputContext } from './workspace';

export interface EntityRemovalPlan {
  nodeId: string;
  kind: 'transaction' | 'watched-address';
  title: string;
  affectedNodeIds: string[];
  annotationCount: number;
  tagMembershipCount: number;
  requiresConfirmation: boolean;
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
  const affected = new Set([nodeId]);
  const belongs = (id: string) =>
    id === nodeId || (!!transaction && id.startsWith(`out:${transaction.txid}:`));
  if (transaction)
    for (const output of transaction.vout) affected.add(outputNodeId(transaction.txid, output.n));
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
  };
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
    return {
      ...workspace,
      watchedAddresses: workspace.watchedAddresses.filter(
        (address) => canonicalAddress(address) !== plan.nodeId.slice(5),
      ),
      annotations,
      tags,
    };
  const txid = plan.nodeId.slice(3);
  const transactions = { ...workspace.transactions };
  delete transactions[txid];
  return {
    ...promoteInputContext(workspace, [txid]),
    transactions,
    annotations,
    tags,
    findings: workspace.findings.filter(
      (finding) => !finding.txids.includes(txid) && !finding.nodeIds.some((id) => affected.has(id)),
    ),
    view: {
      ...workspace.view,
      selectionId:
        workspace.view.selectionId && affected.has(workspace.view.selectionId)
          ? undefined
          : workspace.view.selectionId,
      transactionFlow:
        workspace.view.transactionFlow?.transactionId === txid
          ? { ...workspace.view.transactionFlow, transactionId: undefined }
          : workspace.view.transactionFlow,
    },
  };
}
