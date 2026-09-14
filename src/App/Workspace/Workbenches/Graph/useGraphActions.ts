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
import { type Workspace } from '../../../../Domain/types';
import { mapLimit, MAX_SCAN_TRANSACTIONS } from '../../../../Infra/Bitcoin/api';
import type { Dispatch, SetStateAction, RefObject } from 'react';

import { entityPanelFiltersFromGraph } from './Filters/entityPanelFilters';
import { ADDRESS_DISPLAY_NOTICE } from '../../workspaceNotices';

import type { AppState } from '../../../useAppState';
import type { GraphProjection } from './useGraphProjection';
import type { WorkspaceEvidence } from '../../ChainData/useWorkspaceEvidence';
interface Inputs {
  selectionGeneration: Readonly<RefObject<number>>;
  invalidateSelection: () => void;
  preserveSelectionCamera: (id: string | undefined) => void;
  change: (
    fn: (data: Workspace) => Workspace,
    undo?: boolean,
    group?: string,
    description?: string,
  ) => void;
  setFocusRequest: Dispatch<
    SetStateAction<
      | {
          id: string;
          token: number;
          preserveZoom?: boolean;
        }
      | undefined
    >
  >;
  setNotice: AppState['setNotice'];
  w: AppState['w'];
  setError: AppState['setError'];
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  requestMetadataEdit: (target: 'label' | 'tags' | 'icon') => void;
  cancelScanTargetPicking: () => void;
  select: (id: string, options?: { preserveCamera?: boolean; pickTarget?: boolean }) => void;
  setFocusGraph: Dispatch<SetStateAction<boolean>>;
  setRightTab: Dispatch<SetStateAction<NonNullable<Workspace['view']['rightTab']>>>;
  setMobilePanel: Dispatch<SetStateAction<'graph' | 'left' | 'right'>>;
  workspaceId: AppState['workspaceId'];
  viewOwner: string | undefined;
  selectedId: string | undefined;
  cameraPreservedSelection: RefObject<string | undefined>;
  hiddenIds: GraphProjection['hiddenIds'];
  updateWorkspace: AppState['updateWorkspace'];
  selectedNodeIsVisible: GraphProjection['selectedNodeIsVisible'];
  admittedIds: GraphProjection['admittedIds'];
  visibleGraph: GraphProjection['visibleGraph'];
  graph: GraphProjection['graph'];
  effectiveFilters: GraphProjection['effectiveFilters'];
  navigation: { ids: string[]; index: number };
  setNavigation: Dispatch<SetStateAction<{ ids: string[]; index: number }>>;
  setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  fitAll: () => void;
  graphFilters: GraphFilters;
  setEntityPanelFilters: Dispatch<SetStateAction<GraphFilters>>;
  setEntityFiltersLinked: Dispatch<SetStateAction<boolean>>;
  wRef: AppState['wRef'];
  ws: AppState['ws'];
  setOperation: Dispatch<SetStateAction<string>>;
  getTransaction: WorkspaceEvidence['getTransaction'];
  entityFiltersLinked: boolean;
  run: WorkspaceEvidence['run'];
}
export function useGraphActions({
  selectionGeneration,
  invalidateSelection,
  preserveSelectionCamera,
  change,
  setFocusRequest,
  setNotice,
  w,
  setError,
  setGraphFilters,
  requestMetadataEdit,
  cancelScanTargetPicking,
  select,
  setFocusGraph,
  setRightTab,
  setMobilePanel,
  workspaceId,
  viewOwner,
  selectedId,
  cameraPreservedSelection,
  hiddenIds,
  updateWorkspace,
  selectedNodeIsVisible,
  admittedIds,
  visibleGraph,
  graph,
  effectiveFilters,
  navigation,
  setNavigation,
  setSelectedId,
  fitAll,
  graphFilters,
  setEntityPanelFilters,
  setEntityFiltersLinked,
  wRef,
  ws,
  setOperation,
  getTransaction,
  entityFiltersLinked,
  run,
}: Inputs) {
  const setEntityHidden = (ids: string[], hidden: boolean) => {
    try {
      if (hidden) invalidateSelection();
      change((current) => (hidden ? hideGraphNodes(current, ids) : addGraphNodes(current, ids)));
      if (hidden) setFocusRequest(undefined);
      if (!hidden && !w?.view.showAddresses && ids.some((id) => id.startsWith('addr:')))
        setNotice(ADDRESS_DISPLAY_NOTICE);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Entity visibility could not be updated.');
    }
  };
  const revealGraphNodes = (ids: string[]) => {
    if (!ids.length) return;
    change((current) => {
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
    change((current) => removeGraphNodes(current, ids));
  };
  const showAllHidden = () => change(showAllNodes);
  const editNode = (id: string, target: 'label' | 'tags' | 'icon' = 'label') => {
    setNotice('');
    cancelScanTargetPicking();
    select(id, { pickTarget: false });
    setFocusGraph(false);
    setRightTab('inspect');
    setMobilePanel('right');
    requestMetadataEdit(target);
  };
  const lockToSelection = w?.view.lockToSelection ?? false;
  const showAddresses = w?.view.showAddresses ?? false;
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
        updateWorkspace(
          workspaceId,
          (current) => ({ ...current, view: { ...current.view, showAddresses: true } }),
          false,
        );
    }
    setFocusRequest((previous) =>
      previous?.id === selectedId && previous.preserveZoom
        ? previous
        : { id: selectedId, token: Date.now(), preserveZoom: true },
    );
  }, [
    workspaceId,
    viewOwner,
    lockToSelection,
    selectedId,
    hiddenIds,
    selectedNodeIsVisible,
    showAddresses,
    updateWorkspace,
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
    if (showHidden || !admittedIds.has(id)) change((current) => addGraphNodes(current, [id]));
    const rendered =
      filters || showHidden
        ? filterGraph(
            graph,
            { ...(filters ?? effectiveFilters), showAddresses: w?.view.showAddresses },
            w?.annotations,
            {
              hiddenNodeIds: showHidden
                ? w?.view.hiddenNodeIds?.filter((hidden) => hidden !== id)
                : w?.view.hiddenNodeIds,
              mode: 'visible',
            },
          )
        : visibleGraph;
    if (!rendered.nodes.some((node) => node.id === id)) {
      setGraphFilters({});
      if (id.startsWith('addr:'))
        change((current) => ({ ...current, view: { ...current.view, showAddresses: true } }));
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
    const current = ws.getSession(wRef.current?.id ?? '')?.data;
    if (!current) return false;
    const navigation = prepareGraphNavigation(current, ids, options);
    if (!navigation) return false;
    ws.update(
      current.id,
      (latest) => prepareGraphNavigation(latest, ids, options)!.workspace,
      false,
    );
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
    const current = ws.getSession(w?.id ?? '')?.data;
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
    change((current) => {
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
    change(
      (current) => ({ ...current, view: { ...current.view, smallAmountThreshold: undefined } }),
      false,
    );
  }
  function resetEntityFilters() {
    if (entityFiltersLinked) resetGraphFilters();
    else setEntityPanelFilters({});
  }
  async function updateAllGraphOutputs(action: 'hide' | 'show') {
    if (!w) return;
    const ownerId = w.id;
    const generation = selectionGeneration.current;
    await run(async (signal) => {
      setOperation(
        action === 'hide' ? 'Hiding unconnected inputs/outputs…' : 'Showing all inputs/outputs…',
      );
      // Give the busy state a paint before a potentially large membership update.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      signal.throwIfAborted();
      if (wRef.current?.id !== ownerId || selectionGeneration.current !== generation) return;
      cameraPreservedSelection.current = selectedId;
      setFocusRequest(undefined);
      ws.update(ownerId, (current) => {
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
