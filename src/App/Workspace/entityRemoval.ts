import { removeWorkspaceEntity as removeEntityData } from '../../Core/Workspace/entityRemoval';
import type { Workspace } from '../../Core/Workspace/workspace';
import { transactionReference } from '../../Core/Workspace/entityReferences';

import { graphRemovalClosure } from './GraphState/graphBranch';
import { buildGraph } from './GraphState/graphEvidence';

/** Forget vanished entities and newly orphaned I/O without dropping shared
 * outpoints, their loaded evidence, or unrelated future references. */
function pruneRemovedGraphMembership(before: Workspace, after: Workspace): Workspace {
  const admitted = before.view.graphNodeIds;
  if (!admitted?.length) return after;
  const fullGraph = (workspace: Workspace) =>
    buildGraph({
      ...workspace,
      view: {
        ...workspace.view,
        showAddresses: true,
        inputContext: undefined,
      },
    });
  const remainingGraph = fullGraph(after);
  const remaining = new Set(remainingGraph.nodes.map((node) => node.id));
  const previousGraph = fullGraph(before);
  const removedTransactions = Object.keys(before.chainData.transactions)
    .filter((id) => !after.chainData.transactions[id])
    .map(transactionReference);
  const removedTransactionNodes = new Set(removedTransactions);
  // Old transaction edges identify its I/O, while only surviving edges can
  // protect those outputs. Deleting a creator can remove an address association
  // even when a spending input keeps the outpoint itself in the evidence graph.
  const removalGraph = {
    nodes: [
      ...new Map(
        [...previousGraph.nodes, ...remainingGraph.nodes].map((node) => [node.id, node]),
      ).values(),
    ],
    links: [
      ...remainingGraph.links,
      ...previousGraph.links.filter(
        (link) =>
          removedTransactionNodes.has(link.source) || removedTransactionNodes.has(link.target),
      ),
    ],
  };
  const noLongerAdmitted = new Set(
    graphRemovalClosure(removalGraph, new Set(admitted), removedTransactions),
  );
  for (const node of previousGraph.nodes)
    if (!remaining.has(node.id)) noLongerAdmitted.add(node.id);
  const graphNodeIds = admitted.filter((id) => !noLongerAdmitted.has(id));
  return graphNodeIds.length === admitted.length
    ? after
    : { ...after, view: { ...after.view, graphNodeIds } };
}

/** Publish data removal and its Graph-specific orphan cleanup in one workspace edit. */
export function removeWorkspaceEntity(workspace: Workspace, reference: string): Workspace {
  const next = removeEntityData(workspace, reference);
  return next === workspace ? workspace : pruneRemovedGraphMembership(workspace, next);
}
