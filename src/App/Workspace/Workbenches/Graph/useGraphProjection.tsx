import { indexScanNeighbours } from '../../../../Domain/ConnectionScan/connectionScanNeighbours';
import { EMPTY_GRAPH_ANNOTATIONS, GraphMetadataProjection } from './graphMetadata';
import { indexGraphFlow } from './Renderer/flowContext';
import {
  graphUnconnectedOutputIds,
  graphTransactionOutputIds,
} from '../../../../Domain/Graph/graphBranch';
import {
  projectGraphMembership,
  projectGraphAddresses,
  fullGraphMembershipEvidence,
} from '../../../../Domain/Graph/graphMembership';
import { EntityBadges } from '../../../../Shared/Metadata/EntityBadges';
import { buildWalletMatches, tagNodeIds, buildTagIndex } from '../../../../Domain/Metadata/tags';
import { useCallback, useDeferredValue, useMemo } from 'react';
import {
  describeMatchScope,
  filterGraph,
  buildGraphFilterIndex,
  intersectIds,
  matchingWalletFilterNodeIds,
} from '../../../../Domain/Graph/graphFilters';
import type { GraphFilters } from '../../../../Domain/types';
import { useEntitySelection } from '../../Selection/useEntitySelection';
import { type GraphEvidenceWorkspace } from '../../../../Domain/Workspace/workspace';
import { filterSmallAmounts, omitAmountOrphans } from '../../../../Domain/Graph/smallAmounts';
import { type GraphData, type Workspace } from '../../../../Domain/types';

const EMPTY_WALLETS: Workspace['wallets'] = [];
type GraphEvidenceInput = Omit<GraphEvidenceWorkspace, 'inputContext' | 'annotations' | 'view'>;
function completeGraphFromEvidence(input: GraphEvidenceInput | undefined): GraphData {
  if (!input) return { nodes: [], links: [] };
  return fullGraphMembershipEvidence({
    ...input,
    inputContext: undefined,
    annotations: EMPTY_GRAPH_ANNOTATIONS,
    view: { showAddresses: true },
  });
}
type WalletMatchInput = Pick<Workspace, 'network' | 'transactions' | 'wallets'>;
function walletMatchesFromEvidence(input: WalletMatchInput | undefined, graph: GraphData) {
  return input ? buildWalletMatches(input, graph) : new Map();
}
function tagIndexFromTags(tags: Workspace['tags'], graph: GraphData) {
  return buildTagIndex({ tags }, graph);
}
function graphMetadataWorkspace(
  annotations: Workspace['annotations'] | undefined,
  wallets: Workspace['wallets'] | undefined,
) {
  return {
    annotations: annotations ?? EMPTY_GRAPH_ANNOTATIONS,
    wallets: wallets ?? EMPTY_WALLETS,
  };
}
function membershipFilters(
  source: GraphData,
  sourceMatches: ReadonlyMap<string, { walletIds: string[] }>,
  sourceTags: ReadonlyMap<string, unknown>,
  filters: GraphFilters,
  tags: Workspace['tags'],
): GraphFilters {
  const includes: (string[] | undefined)[] = [filters.includeIds];
  const excludes: string[] = [];
  includes.push(matchingWalletFilterNodeIds(filters, sourceMatches));
  if (filters.walletMatch === 'matched') includes.push([...sourceMatches.keys()]);
  else if (filters.walletMatch === 'unmatched') excludes.push(...sourceMatches.keys());
  if (filters.tagId) {
    const tag = tags?.find((entry) => entry.id === filters.tagId);
    includes.push(tag ? tagNodeIds(tag, source) : []);
  }
  if (filters.tagState === 'tagged') includes.push([...sourceTags.keys()]);
  else if (filters.tagState === 'untagged') excludes.push(...sourceTags.keys());
  const includeIds = intersectIds(includes);
  return includeIds || excludes.length
    ? { ...filters, includeIds, excludeIds: excludes.length ? excludes : undefined }
    : filters;
}
interface Inputs {
  w: ReturnType<typeof import('../../../useAppState').useAppState>['w'];
  graphFilters: GraphFilters;
  fitToken: number;
  selectedId: string | undefined;
  selection: ReturnType<typeof useEntitySelection>;
  scanTargetDraft:
    | {
        workspaceId: string;
        source: string;
        ids: string[];
      }
    | undefined;
  pickingScanTargets: boolean;
  entityPanelFilters: GraphFilters;
  entityFiltersLinked: boolean;
}
export function useGraphProjection({
  w,
  graphFilters,
  fitToken,
  selectedId,
  selection,
  scanTargetDraft,
  pickingScanTargets,
  entityPanelFilters,
  entityFiltersLinked,
}: Inputs) {
  const workspaceNetwork = w?.network;
  const workspaceTransactions = w?.transactions;
  const workspaceFindings = w?.findings;
  const workspaceAnnotations = w?.annotations;
  const workspaceTags = w?.tags;
  const workspaceWallets = w?.wallets;
  const workspaceWatchedAddresses = w?.watchedAddresses;
  const workspaceAddressBalances = w?.addressBalances;
  // Controls commit first; expensive graph/list projection can yield to newer input.
  const graphRenderRequest = useMemo(
    () => ({
      workspaceId: w?.id,
      filters: graphFilters,
      fitToken,
      showAddresses: w?.view.showAddresses ?? false,
      smallAmountThreshold: w?.view.smallAmountThreshold,
      dimensions: w?.view.dimensions ?? 3,
      sizeBy: w?.view.sizeBy ?? 'uniform',
      glow: w?.view.glow ?? true,
      showLabels: w?.view.showLabels ?? true,
      showTags: w?.view.showTags ?? true,
      showIcons: w?.view.showIcons ?? true,
      highlightMode: w?.view.highlightMode ?? 'all',
    }),
    [
      w?.id,
      graphFilters,
      fitToken,
      w?.view.showAddresses,
      w?.view.smallAmountThreshold,
      w?.view.dimensions,
      w?.view.sizeBy,
      w?.view.glow,
      w?.view.showLabels,
      w?.view.showTags,
      w?.view.showIcons,
      w?.view.highlightMode,
    ],
  );
  const deferredGraphRequest = useDeferredValue(graphRenderRequest);
  const appliedGraphRequest =
    deferredGraphRequest.workspaceId === w?.id ? deferredGraphRequest : graphRenderRequest;
  const appliedGraphFilters = appliedGraphRequest.filters;
  const graphFiltering = appliedGraphRequest !== graphRenderRequest;
  // Selection drives the inspector and transaction flow immediately. The canvas can
  // retain its previous highlight briefly, so an expensive renderer update does not
  // hold those panels behind a large graph presentation pass.
  const graphSelectionRequest = useMemo(
    () => ({ workspaceId: w?.id, selectedId }),
    [w?.id, selectedId],
  );
  const deferredGraphSelectionRequest = useDeferredValue(graphSelectionRequest);
  const graphSelectedId =
    deferredGraphSelectionRequest.workspaceId === w?.id
      ? deferredGraphSelectionRequest.selectedId
      : graphSelectionRequest.selectedId;
  // Topology and chain indexes do not depend on human labels, icons or bookmarks.
  const graphEvidenceInput = useMemo<GraphEvidenceInput | undefined>(() => {
    if (
      !workspaceNetwork ||
      !workspaceTransactions ||
      !workspaceFindings ||
      !workspaceWatchedAddresses
    )
      return undefined;
    return {
      network: workspaceNetwork,
      transactions: workspaceTransactions,
      findings: workspaceFindings,
      addressBalances: workspaceAddressBalances,
      watchedAddresses: workspaceWatchedAddresses,
    };
  }, [
    workspaceNetwork,
    workspaceTransactions,
    workspaceFindings,
    workspaceWatchedAddresses,
    workspaceAddressBalances,
  ]);
  const completeGraph = useMemo(
    () => completeGraphFromEvidence(graphEvidenceInput),
    [graphEvidenceInput],
  );
  const graphWithoutAddresses = useMemo(
    () => projectGraphAddresses(completeGraph, false),
    [completeGraph],
  );
  const graph = appliedGraphRequest.showAddresses ? completeGraph : graphWithoutAddresses;
  const flowIndex = useMemo(() => indexGraphFlow(graphWithoutAddresses), [graphWithoutAddresses]);
  const scanNeighbours = useMemo(
    () => indexScanNeighbours(graphWithoutAddresses),
    [graphWithoutAddresses],
  );
  const graphFlowContext = useMemo(
    () => flowIndex.resolve(graphSelectedId, w?.view.transactionFlow?.transactionId),
    [flowIndex, graphSelectedId, w?.view.transactionFlow?.transactionId],
  );
  const walletMatchInput = useMemo<WalletMatchInput | undefined>(() => {
    if (!workspaceNetwork || !workspaceTransactions || !workspaceWallets) return undefined;
    return {
      network: workspaceNetwork,
      transactions: workspaceTransactions,
      wallets: workspaceWallets,
    };
  }, [workspaceNetwork, workspaceTransactions, workspaceWallets]);
  const walletMatches = useMemo(
    () => walletMatchesFromEvidence(walletMatchInput, completeGraph),
    [walletMatchInput, completeGraph],
  );
  const tagIndex = useMemo(
    () => tagIndexFromTags(workspaceTags, completeGraph),
    [workspaceTags, completeGraph],
  );
  const metadataProjection = useMemo(() => new GraphMetadataProjection(), []);
  const graphMetadata = useMemo(
    () =>
      metadataProjection.project(
        completeGraph,
        graphMetadataWorkspace(workspaceAnnotations, workspaceWallets),
        tagIndex,
        walletMatches,
        appliedGraphRequest.highlightMode,
      ),
    [
      metadataProjection,
      workspaceAnnotations,
      workspaceWallets,
      appliedGraphRequest.highlightMode,
      completeGraph,
      walletMatches,
      tagIndex,
    ],
  );
  const nodePresentation = graphMetadata.presentation;
  // Batch selection is shared UI state projected onto the neutral display contract.
  const highlightedSelection = pickingScanTargets ? scanTargetDraft!.ids : selection.ids;
  const batchPresentation = useMemo(() => {
    if (!highlightedSelection.length) return nodePresentation;
    const merged = new Map(nodePresentation);
    for (const id of highlightedSelection) {
      const base = merged.get(id);
      merged.set(id, { ...base, highlight: true, scale: (base?.scale ?? 1) * 1.35 });
    }
    return merged;
  }, [nodePresentation, highlightedSelection]);
  const effectiveFilters = useMemo(
    () =>
      membershipFilters(completeGraph, walletMatches, tagIndex, appliedGraphFilters, workspaceTags),
    [appliedGraphFilters, workspaceTags, completeGraph, walletMatches, tagIndex],
  );
  const entityFilterRequest = entityFiltersLinked ? appliedGraphFilters : entityPanelFilters;
  const effectiveEntityFilters = useMemo(
    () =>
      membershipFilters(completeGraph, walletMatches, tagIndex, entityFilterRequest, workspaceTags),
    [entityFilterRequest, workspaceTags, completeGraph, walletMatches, tagIndex],
  );
  const automaticContextIds = useMemo(
    () => [
      ...new Set([...(w?.contextTransactionIds ?? []), ...Object.keys(w?.inputContext ?? {})]),
    ],
    [w?.contextTransactionIds, w?.inputContext],
  );
  const completeAdmittedGraph = useMemo(
    () => projectGraphMembership(completeGraph, w?.view.graphNodeIds),
    [completeGraph, w?.view.graphNodeIds],
  );
  const admittedWithoutAddresses = useMemo(
    () => projectGraphAddresses(completeAdmittedGraph, false),
    [completeAdmittedGraph],
  );
  // With no admitted addresses, toggling the control must not update the renderer.
  const canvasShowAddresses =
    completeAdmittedGraph !== admittedWithoutAddresses && appliedGraphRequest.showAddresses;
  const admittedGraph = canvasShowAddresses ? completeAdmittedGraph : admittedWithoutAddresses;
  const admittedIds = useMemo(
    () => new Set(admittedGraph.nodes.map((node) => node.id)),
    [admittedGraph],
  );
  const amountSelectionId = appliedGraphRequest.smallAmountThreshold ? graphSelectedId : undefined;
  const amountGraph = useMemo(
    () =>
      filterSmallAmounts(
        admittedGraph,
        appliedGraphRequest.smallAmountThreshold,
        amountSelectionId,
        automaticContextIds,
      ),
    [
      admittedGraph,
      appliedGraphRequest.smallAmountThreshold,
      amountSelectionId,
      automaticContextIds,
    ],
  );
  const amountFilterIndex = useMemo(() => buildGraphFilterIndex(amountGraph), [amountGraph]);
  // Metadata only changes canvas membership when a metadata filter is active.
  const filterAnnotations =
    appliedGraphFilters.query?.trim() ||
    (appliedGraphFilters.label && appliedGraphFilters.label !== 'all') ||
    appliedGraphFilters.bookmarkedOnly
      ? w?.annotations
      : EMPTY_GRAPH_ANNOTATIONS;
  const entityFilterAnnotations =
    entityFilterRequest.query?.trim() ||
    (entityFilterRequest.label && entityFilterRequest.label !== 'all') ||
    entityFilterRequest.bookmarkedOnly
      ? w?.annotations
      : EMPTY_GRAPH_ANNOTATIONS;
  const canvasFilterResult = useMemo(
    () =>
      filterGraph(
        amountGraph,
        { ...effectiveFilters, showAddresses: canvasShowAddresses },
        filterAnnotations,
        { hiddenNodeIds: w?.view.hiddenNodeIds, mode: 'visible' },
        { index: amountFilterIndex, previewContext: true },
      ),
    [
      amountGraph,
      amountFilterIndex,
      effectiveFilters,
      canvasShowAddresses,
      w?.view.hiddenNodeIds,
      filterAnnotations,
    ],
  );
  const visibleGraph = useMemo(() => {
    return appliedGraphRequest.smallAmountThreshold ||
      effectiveFilters.minSats !== undefined ||
      effectiveFilters.maxSats !== undefined
      ? omitAmountOrphans(canvasFilterResult, graphSelectedId)
      : canvasFilterResult;
  }, [
    canvasFilterResult,
    effectiveFilters,
    appliedGraphRequest.smallAmountThreshold,
    graphSelectedId,
  ]);
  const hiddenIds = useMemo(() => new Set(w?.view.hiddenNodeIds ?? []), [w?.view.hiddenNodeIds]);
  const connectionGraph = completeGraph;
  const connectionMembers = useMemo(
    () => new Set(w?.view.graphNodeIds ?? connectionGraph.nodes.map((node) => node.id)),
    [w?.view.graphNodeIds, connectionGraph],
  );
  const shownConnectionMembers = useMemo(
    () => new Set([...connectionMembers].filter((id) => !hiddenIds.has(id))),
    [connectionMembers, hiddenIds],
  );
  const unconnectedForHide = useMemo(
    () => graphUnconnectedOutputIds(connectionGraph, shownConnectionMembers),
    [connectionGraph, shownConnectionMembers],
  );
  const unconnectedForRemoval = useMemo(
    () => graphUnconnectedOutputIds(connectionGraph, connectionMembers),
    [connectionGraph, connectionMembers],
  );
  const allGraphOutputIds = useMemo(
    () => graphTransactionOutputIds(connectionGraph, shownConnectionMembers),
    [connectionGraph, shownConnectionMembers],
  );
  // Address visibility is a canvas preference. Manually hidden addresses must
  // remain recoverable without enabling every address node in the renderer.
  const recoveryGraph = useMemo(() => {
    if (appliedGraphRequest.showAddresses) return completeGraph;
    if (![...hiddenIds].some((id) => id.startsWith('addr:'))) return graphWithoutAddresses;
    return projectGraphAddresses(completeGraph, false, hiddenIds);
  }, [completeGraph, graphWithoutAddresses, hiddenIds, appliedGraphRequest.showAddresses]);
  const hiddenCount = useMemo(
    () =>
      recoveryGraph.nodes.filter((node) => admittedIds.has(node.id) && hiddenIds.has(node.id))
        .length,
    [recoveryGraph, hiddenIds, admittedIds],
  );
  const visibleEntityCount = useMemo(
    () => admittedGraph.nodes.filter((node) => !hiddenIds.has(node.id)).length,
    [admittedGraph, hiddenIds],
  );
  const entityVisibility = w?.view.entityVisibility ?? 'graph';
  const recoveryFilterIndex = useMemo(() => buildGraphFilterIndex(recoveryGraph), [recoveryGraph]);
  const entityGraph = useMemo(() => {
    if (entityFiltersLinked) {
      if (entityVisibility === 'graph')
        return { ...visibleGraph, matchedNodes: visibleGraph.nodes };
      if (entityVisibility === 'visible' && !appliedGraphRequest.smallAmountThreshold)
        return canvasFilterResult;
      const source = entityVisibility === 'visible' ? admittedGraph : recoveryGraph;
      return filterGraph(
        source,
        {
          ...effectiveFilters,
          showAddresses: entityVisibility === 'visible' ? canvasShowAddresses : true,
        },
        filterAnnotations,
        { hiddenNodeIds: w?.view.hiddenNodeIds, mode: entityVisibility },
        { index: source === recoveryGraph ? recoveryFilterIndex : undefined },
      );
    }
    const source =
      entityVisibility === 'hidden' || entityVisibility === 'all' ? recoveryGraph : admittedGraph;
    return filterGraph(
      source,
      effectiveEntityFilters,
      entityFilterAnnotations,
      {
        hiddenNodeIds: w?.view.hiddenNodeIds,
        mode:
          entityVisibility === 'hidden' ? 'hidden' : entityVisibility === 'all' ? 'all' : 'visible',
      },
      { index: source === recoveryGraph ? recoveryFilterIndex : undefined },
    );
  }, [
    admittedGraph,
    recoveryGraph,
    entityFilterAnnotations,
    entityFiltersLinked,
    effectiveEntityFilters,
    effectiveFilters,
    recoveryFilterIndex,
    canvasFilterResult,
    appliedGraphRequest.smallAmountThreshold,
    filterAnnotations,
    canvasShowAddresses,
    w?.view.hiddenNodeIds,
    entityVisibility,
    visibleGraph,
  ]);
  const recoveryNodesById = useMemo(
    () => new Map(recoveryGraph.nodes.map((node) => [node.id, node])),
    [recoveryGraph],
  );
  const renderEntityMetadata = useCallback(
    (id: string) => {
      const match = walletMatches.get(id);
      return (
        <EntityBadges
          tags={tagIndex.get(id) ?? []}
          wallets={
            w?.wallets
              .filter((wallet) => match?.walletIds.includes(wallet.id))
              .map((wallet) => wallet.name) ?? []
          }
          related={match?.kind === 'transaction'}
        />
      );
    },
    [walletMatches, tagIndex, w?.wallets],
  );
  const selected = selectedId
    ? (graphMetadata.labeledNodes.get(selectedId) ?? recoveryNodesById.get(selectedId))
    : undefined;
  const entityNodes = useMemo(
    () => entityGraph.matchedNodes.map((node) => graphMetadata.labeledNodes.get(node.id) ?? node),
    [entityGraph.matchedNodes, graphMetadata.labeledNodes],
  );
  // Match graph lists connected context so links stay explainable. Context is
  // excluded from Select matching; explicit selections remain batch targets.
  const entityBatchNodes = useMemo(() => {
    if (entityVisibility !== 'graph') return entityNodes;
    const context = new Set(visibleGraph.contextNodeIds);
    return entityNodes.filter((node) => !context.has(node.id));
  }, [entityNodes, entityVisibility, visibleGraph]);
  const canvasIds = useMemo(
    () => new Set(visibleGraph.nodes.map((node) => node.id)),
    [visibleGraph],
  );
  const selectionOnCanvas = selection.ids.filter((id) => canvasIds.has(id)).length;
  const matchingScope = useMemo(
    () => ({
      label: describeMatchScope(visibleGraph.matchedNodes),
      ids: visibleGraph.matchedNodes.map((node) => node.id),
    }),
    [visibleGraph],
  );
  const selectedNodeIsVisible = useMemo(
    () => !!selectedId && visibleGraph.nodes.some((node) => node.id === selectedId),
    [selectedId, visibleGraph.nodes],
  );
  return {
    appliedGraphRequest,
    graphFiltering,
    graphSelectedId,
    graph,
    flowIndex,
    scanNeighbours,
    graphFlowContext,
    walletMatches,
    highlightedSelection,
    batchPresentation,
    effectiveFilters,
    admittedGraph,
    admittedIds,
    amountGraph,
    canvasFilterResult,
    visibleGraph,
    hiddenIds,
    connectionMembers,
    unconnectedForHide,
    unconnectedForRemoval,
    allGraphOutputIds,
    recoveryGraph,
    hiddenCount,
    visibleEntityCount,
    entityVisibility,
    recoveryNodesById,
    renderEntityMetadata,
    selected,
    entityNodes,
    entityBatchNodes,
    canvasIds,
    selectionOnCanvas,
    matchingScope,
    selectedNodeIsVisible,
  };
}
