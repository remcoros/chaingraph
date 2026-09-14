import {
  graphNavigationTransactionIds,
  prepareGraphNavigation,
  type GraphNavigationOptions,
} from '../../../../Domain/Graph/graphHandoff';
import { graphUnconnectedOutputIds } from '../../../../Domain/Graph/graphBranch';
import {
  addGraphNodes,
  ensureGraphMembership,
  hideGraphNodes,
  removeGraphNodes,
  fullGraphMembershipEvidence,
  showAllGraphOutputs,
} from '../../../../Domain/Graph/graphMembership';
import { useEffect } from 'react';
import { filterGraph } from '../../../../Domain/Graph/graphFilters';
import { type GraphFilters } from '../../../../Domain/types';
import { setNodesHidden, showAllNodes } from '../../../../Domain/Graph/visibility';
import { promoteInputContext } from '../../../../Domain/Workspace/workspace';
import { mapLimit, MAX_SCAN_TRANSACTIONS } from '../../../../Infra/Bitcoin/api';

import { entityPanelFiltersFromGraph } from './Filters/entityPanelFilters';
import { ADDRESS_DISPLAY_NOTICE } from '../../workspaceNotices';

import type { GraphProjection } from './useGraphProjection';
import type { ChainFetch } from '../../ChainData/useChainFetch';
import type { WorkspaceCore } from '../../workspaceCore';
import type { WorkspaceSelection } from '../../Selection/useWorkspaceSelection';
import type { ConnectionScanTargets } from '../../Selection/useConnectionScanTargets';
import type { WorkspaceAnnotations } from '../../Annotations/useAnnotations';
import type { WorkspaceFilters } from './Filters/useWorkspaceFilters';
import type { GraphPanels } from './useGraphPanels';
import type { GraphCanvas } from './useGraphCanvas';
interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  projection: GraphProjection;
  filters: WorkspaceFilters;
  panels: GraphPanels;
  canvas: GraphCanvas;
  scanTargets: ConnectionScanTargets;
  annotations: WorkspaceAnnotations;
  fetch: ChainFetch;
  viewOwner: string | undefined;
}
export function useGraphActions({
  core,
  selection,
  projection,
  filters,
  panels,
  canvas,
  scanTargets,
  annotations,
  fetch,
  viewOwner,
}: Inputs) {
  const {
    activeWorkspace,
    activeWorkspaceRef,
    workspaceId,
    workspaces,
    edit,
    setNotice,
    setError,
    setOperation,
  } = core;
  const {
    generation: selectionGeneration,
    invalidate: invalidateSelection,
    preserveCamera: preserveSelectionCamera,
    cameraPreserved: cameraPreservedSelection,
    select,
    selectedId,
    setSelectedId,
    navigation,
    setNavigation,
  } = selection;
  const { hiddenIds, selectedNodeIsVisible, admittedIds, visibleGraph, graph, effectiveFilters } =
    projection;
  const {
    graph: graphFilters,
    setGraph: setGraphFilters,
    setEntityPanel: setEntityPanelFilters,
    entityLinked: entityFiltersLinked,
    setEntityLinked: setEntityFiltersLinked,
  } = filters;
  const { setFocusGraph, setRightTab, setMobilePanel } = panels;
  const { setFocusRequest, fitAll } = canvas;
  const { cancelPicking: cancelScanTargetPicking } = scanTargets;
  const { edit: metadataEdit } = annotations;
  const requestMetadataEdit = metadataEdit.request;
  const { getTransaction, run } = fetch;

  const setEntityHidden = (ids: string[], hidden: boolean) => {
    try {
      if (hidden) invalidateSelection();
      edit((current) => (hidden ? hideGraphNodes(current, ids) : addGraphNodes(current, ids)));
      if (hidden) setFocusRequest(undefined);
      if (
        !hidden &&
        !activeWorkspace?.view.showAddresses &&
        ids.some((id) => id.startsWith('addr:'))
      )
        setNotice(ADDRESS_DISPLAY_NOTICE);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Entity visibility could not be updated.');
    }
  };
  const revealGraphNodes = (ids: string[]) => {
    if (!ids.length) return;
    edit((current) => {
      const revealed = addGraphNodes(current, ids);
      return {
        ...revealed,
        view: {
          ...revealed.view,
          smallAmountThreshold: undefined,
          showAddresses: revealed.view.showAddresses || ids.some((id) => id.startsWith('addr:')),
        },
      };
    });
    // Explicit Add makes its result visible without moving the camera or existing nodes.
    setGraphFilters({});
  };
  const removeFromGraph = (ids: string[]) => {
    invalidateSelection();
    setFocusRequest(undefined);
    edit((current) => removeGraphNodes(current, ids));
  };
  const showAllHidden = () => edit(showAllNodes);
  const editNode = (id: string, target: 'label' | 'tags' | 'icon' = 'label') => {
    setNotice('');
    cancelScanTargetPicking();
    select(id, { pickTarget: false });
    setFocusGraph(false);
    setRightTab('inspect');
    setMobilePanel('right');
    requestMetadataEdit(target);
  };
  const lockToSelection = activeWorkspace?.view.lockToSelection ?? false;
  const showAddresses = activeWorkspace?.view.showAddresses ?? false;
  useEffect(() => {
    if (
      !workspaceId ||
      viewOwner !== workspaceId ||
      !lockToSelection ||
      !selectedId ||
      cameraPreservedSelection.current === selectedId ||
      hiddenIds.has(selectedId)
    )
      return;
    if (!selectedNodeIsVisible) {
      setGraphFilters({});
      if (selectedId.startsWith('addr:') && !showAddresses)
        edit((current) => ({ ...current, view: { ...current.view, showAddresses: true } }), false);
    }
    setFocusRequest((previous) =>
      previous?.id === selectedId && previous.preserveZoom
        ? previous
        : { id: selectedId, token: Date.now(), preserveZoom: true },
    );
  }, [
    workspaceId,
    viewOwner,
    edit,
    lockToSelection,
    selectedId,
    hiddenIds,
    selectedNodeIsVisible,
    showAddresses,
    setFocusRequest,
    cameraPreservedSelection,
    setGraphFilters,
  ]);
  function centerNode(id = selectedId, filters?: GraphFilters, showHidden = false) {
    if (!id) return;
    if (hiddenIds.has(id) && !showHidden) {
      setNotice('This entity is hidden from the graph. Show it in the inspector to center it.');
      return;
    }
    if (showHidden || !admittedIds.has(id)) edit((current) => addGraphNodes(current, [id]));
    const rendered =
      filters || showHidden
        ? filterGraph(
            graph,
            {
              ...(filters ?? effectiveFilters),
              showAddresses: activeWorkspace?.view.showAddresses,
            },
            activeWorkspace?.annotations,
            {
              hiddenNodeIds: showHidden
                ? activeWorkspace?.view.hiddenNodeIds?.filter((hidden) => hidden !== id)
                : activeWorkspace?.view.hiddenNodeIds,
              mode: 'visible',
            },
          )
        : visibleGraph;
    if (!rendered.nodes.some((node) => node.id === id)) {
      setGraphFilters({});
      if (id.startsWith('addr:'))
        edit((current) => ({ ...current, view: { ...current.view, showAddresses: true } }));
    }
    setMobilePanel('graph');
    preserveSelectionCamera(undefined);
    setFocusRequest({ id, token: Date.now() });
  }
  function navigateSelection(delta: number) {
    const index = navigation.index + delta;
    const id = navigation.ids[index];
    if (!id) return;
    invalidateSelection();
    setNavigation({ ...navigation, index });
    preserveSelectionCamera(id);
    setFocusRequest(undefined);
    setSelectedId(id);
    setRightTab('inspect');
  }
  function updateFilters(filters: GraphFilters) {
    setFocusRequest(undefined);
    setGraphFilters(filters);
    fitAll();
  }
  function setEntityFilterLink(linked: boolean) {
    setEntityPanelFilters(entityPanelFiltersFromGraph(graphFilters));
    setEntityFiltersLinked(linked);
  }
  function showOnGraph(ids: readonly string[], options: GraphNavigationOptions = {}) {
    const current = workspaces.getUnlocked(activeWorkspaceRef.current?.id ?? '')?.data;
    if (!current) return false;
    const navigation = prepareGraphNavigation(current, ids, options);
    if (!navigation) return false;
    workspaces
      .getUnlocked(current.id)
      ?.edit((latest) => prepareGraphNavigation(latest, ids, options)!.workspace, false);
    // Explicit centering owns this camera move, not Lock or a deferred fit-all.
    select(navigation.selectedId, { preserveCamera: true, pickTarget: false });
    setGraphFilters(navigation.filters);
    setFocusRequest((previous) => ({
      id: navigation.selectedId,
      token: (previous?.token ?? 0) + 1,
    }));
    setMobilePanel('graph');
    return true;
  }
  async function loadGraphTransactions(ids: readonly string[], signal: AbortSignal) {
    const current = workspaces.getUnlocked(activeWorkspace?.id ?? '')?.data;
    if (!current) return [];
    const missing = graphNavigationTransactionIds(ids).filter((id) => !current.transactions[id]);
    if (missing.length > MAX_SCAN_TRANSACTIONS)
      throw new Error('Select at most 500 missing transactions to show on graph at once.');
    if (missing.length) setOperation('Loading graph selection…');
    return mapLimit(missing, 4, (id) => getTransaction(id, signal));
  }
  function prepareIsolation(ids: string[], preserveFilters = false) {
    preserveSelectionCamera(ids[0]);
    setFocusRequest(undefined);
    const transactionIds = [
      ...new Set(
        ids.flatMap((nodeId) => {
          const match = /^(?:tx|out):([0-9a-f]{64})/.exec(nodeId);
          return match ? [match[1]] : [];
        }),
      ),
    ];
    edit((current) => {
      const admitted = addGraphNodes(promoteInputContext(current, transactionIds), ids);
      return {
        ...admitted,
        view: {
          ...admitted.view,
          smallAmountThreshold: preserveFilters ? current.view.smallAmountThreshold : undefined,
          showAddresses:
            ids.some((nodeId) => nodeId.startsWith('addr:')) || current.view.showAddresses,
        },
      };
    }, false);
  }
  function resetGraphFilters() {
    updateFilters({});
    edit(
      (current) => ({ ...current, view: { ...current.view, smallAmountThreshold: undefined } }),
      false,
    );
  }
  function resetEntityFilters() {
    if (entityFiltersLinked) resetGraphFilters();
    else setEntityPanelFilters({});
  }
  async function updateAllGraphOutputs(action: 'hide' | 'show') {
    if (!activeWorkspace) return;
    const ownerId = activeWorkspace.id;
    const generation = selectionGeneration.current;
    await run(async (signal) => {
      setOperation(
        action === 'hide' ? 'Hiding unconnected inputs/outputs…' : 'Showing all inputs/outputs…',
      );
      // Give the busy state a paint before a potentially large membership update.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      signal.throwIfAborted();
      if (activeWorkspaceRef.current?.id !== ownerId || selectionGeneration.current !== generation)
        return;
      cameraPreservedSelection.current = selectedId;
      setFocusRequest(undefined);
      workspaces.getUnlocked(ownerId)?.edit((current) => {
        if (action === 'hide') {
          const evidence = fullGraphMembershipEvidence(current);
          const initialized = ensureGraphMembership(current);
          const hidden = new Set(initialized.view.hiddenNodeIds);
          const participating = new Set(
            initialized.view.graphNodeIds!.filter((id) => !hidden.has(id)),
          );
          return setNodesHidden(
            initialized,
            graphUnconnectedOutputIds(evidence, participating),
            true,
          );
        }
        const expanded = showAllGraphOutputs(current);
        return { ...expanded, view: { ...expanded.view, smallAmountThreshold: undefined } };
      });
      if (action === 'show') setGraphFilters({});
    });
  }
  return {
    setEntityHidden,
    revealGraphNodes,
    removeFromGraph,
    showAllHidden,
    editNode,
    centerNode,
    navigateSelection,
    updateFilters,
    setEntityFilterLink,
    showOnGraph,
    loadGraphTransactions,
    prepareIsolation,
    resetGraphFilters,
    resetEntityFilters,
    updateAllGraphOutputs,
  };
}

/** Graph navigation, visibility and filter behaviour. */
export type GraphActions = ReturnType<typeof useGraphActions>;
