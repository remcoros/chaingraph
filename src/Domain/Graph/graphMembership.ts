import { canonicalEntityNodeId } from '../Metadata/entityReferences';
import { graphRemovalClosure, graphTransactionOutputIds } from './graphBranch';
import type { GraphData, Workspace } from '../types';
import type { GraphEvidenceWorkspace } from '../Workspace/graphEvidence';
import { setNodesHidden } from './visibility';
import { buildGraph } from '../Workspace/graphEvidence';
import {
  assertGraphNodeBudget,
  MAX_GRAPH_ACTION_NODES,
  MAX_GRAPH_NODES,
} from './graphMembershipValidation';
export {
  assertGraphNodeBudget,
  graphNodeIdsSchema,
  MAX_GRAPH_ACTION_NODES,
  MAX_GRAPH_NODES,
  parseGraphNodeIds,
} from './graphMembershipValidation';

/** Seed legacy canvas membership before merging any newly loaded observations. */
export function ensureGraphMembership(workspace: Workspace): Workspace {
  if (workspace.view.graphNodeIds !== undefined) return workspace;
  const graphNodeIds = buildGraph(workspace).nodes.map((node) => node.id);
  assertGraphNodeBudget(graphNodeIds);
  return { ...workspace, view: { ...workspace.view, graphNodeIds } };
}

/** Membership is independent of filters, temporary hiding and complete chain evidence. */
export function projectGraphMembership(graph: GraphData, nodeIds?: Iterable<string>): GraphData {
  if (nodeIds === undefined) return graph;
  const admitted = new Set(nodeIds);
  const nodes = graph.nodes.filter((node) => admitted.has(node.id));
  const present = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: graph.links.filter((link) => present.has(link.source) && present.has(link.target)),
  };
}

/** Display only admitted addresses; changing this preference never adds membership.
 * Retained addresses keep temporary context visible when the general toggle is off. */
export function projectGraphAddresses(
  graph: GraphData,
  showAddresses: boolean,
  retainedAddressIds?: ReadonlySet<string>,
): GraphData {
  if (showAddresses) return graph;
  const excluded = new Set<string>();
  for (const node of graph.nodes)
    if (node.kind === 'address' && !retainedAddressIds?.has(node.id)) excluded.add(node.id);
  if (!excluded.size) return graph;
  return {
    nodes: graph.nodes.filter((node) => !excluded.has(node.id)),
    links: graph.links.filter((link) => !excluded.has(link.source) && !excluded.has(link.target)),
  };
}

function actionNodeIds(workspace: Workspace, nodeIds: Iterable<string>): Set<string> {
  const ids = new Set<string>();
  let supplied = 0;
  for (const value of nodeIds) {
    if (++supplied > MAX_GRAPH_ACTION_NODES)
      throw new Error('A graph action supports at most 50,000 entity references.');
    ids.add(canonicalEntityNodeId(value, workspace.network));
  }
  return ids;
}

/** Add and reveal exactly the requested nodes without expanding their transactions. */
export function addGraphNodes(workspace: Workspace, nodeIds: Iterable<string>): Workspace {
  const requested = actionNodeIds(workspace, nodeIds);
  const initialized = ensureGraphMembership(workspace);
  const admitted = new Set(initialized.view.graphNodeIds);
  const previousSize = admitted.size;
  for (const id of requested) admitted.add(id);
  if (admitted.size > MAX_GRAPH_NODES)
    throw new Error('Workspace exceeds the 110,000 graph entity limit.');
  const added =
    admitted.size === previousSize
      ? initialized
      : { ...initialized, view: { ...initialized.view, graphNodeIds: [...admitted] } };
  return setNodesHidden(added, requested, false);
}

/** Connection checks use all loaded evidence, independent of display preferences. */
export function fullGraphMembershipEvidence(workspace: GraphEvidenceWorkspace): GraphData {
  return buildGraph({
    ...workspace,
    inputContext: undefined,
    view: { ...workspace.view, showAddresses: true },
  });
}

/** Reveal loaded I/O of manually visible canvas transactions without loading or
 * expanding their neighbors. Temporary filters and display preferences do not
 * change the action's scope; manually hidden transactions remain hidden. */
export function showAllGraphOutputs(workspace: Workspace): Workspace {
  const initialized = ensureGraphMembership(workspace);
  const hidden = new Set(initialized.view.hiddenNodeIds);
  const participating = new Set(initialized.view.graphNodeIds!.filter((id) => !hidden.has(id)));
  return addGraphNodes(
    initialized,
    graphTransactionOutputIds(fullGraphMembershipEvidence(initialized), participating),
  );
}

/** Hide requested members and I/O orphaned by hiding their transactions. */
export function hideGraphNodes(workspace: Workspace, nodeIds: Iterable<string>): Workspace {
  const requested = actionNodeIds(workspace, nodeIds);
  const initialized = ensureGraphMembership(workspace);
  const hidden = new Set(initialized.view.hiddenNodeIds);
  const participating = new Set(initialized.view.graphNodeIds!.filter((id) => !hidden.has(id)));
  const ids = graphRemovalClosure(
    fullGraphMembershipEvidence(initialized),
    participating,
    requested,
  );
  return setNodesHidden(initialized, ids, true);
}

/** Remove membership and newly orphaned I/O. Evidence, metadata and geometry survive. */
export function removeGraphNodes(workspace: Workspace, nodeIds: Iterable<string>): Workspace {
  const requested = actionNodeIds(workspace, nodeIds);
  const initialized = ensureGraphMembership(workspace);
  const previous = initialized.view.graphNodeIds!;
  const removed = new Set(
    graphRemovalClosure(fullGraphMembershipEvidence(initialized), new Set(previous), requested),
  );
  const graphNodeIds = previous.filter((id) => !removed.has(id));
  return graphNodeIds.length === previous.length
    ? initialized
    : { ...initialized, view: { ...initialized.view, graphNodeIds } };
}
