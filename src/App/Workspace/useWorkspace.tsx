import { prepareCustomScanTargets } from '../../Domain/ConnectionScan/connectionScanTargets';
import { isScanNodeId } from '../../Domain/ConnectionScan/connectionScan';
import { resolveWalletUtxoObservation } from '../../Domain/Wallet/walletUtxoObservation';
import { useWalletUtxos } from './Workbenches/Wallet/useWalletUtxos';
import { type WalletUtxoRecord } from '../../Domain/Wallet/walletRecords';
import { useFlowInputs } from './useFlowInputs';
import { addGraphNodes } from '../../Domain/Graph/graphMembership';
import { parseWorkspaceTags } from '../../Domain/Metadata/tags';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { valueFilterError, type GraphFilters } from '../../Domain/Graph/graphFilters';
import { useEntitySelection } from './Selection/useEntitySelection';
import { setNodesHidden } from '../../Domain/Graph/visibility';
import { planEntityRemoval, removeWorkspaceEntity } from '../../Domain/Workspace/entityRemoval';
import { type AnalysisWorkbenchSession } from './Workbenches/Analysis/AnalysisWorkbench';
import { buildGraph, outputAddress } from '../../Domain/Workspace/workspace';
import {
  outputNodeId,
  addressNodeId,
  txNodeId,
  type Wallet,
  type Workspace,
} from '../../Domain/types';
import { fetchTransaction } from '../../Infra/Bitcoin/api';
import { WORKBENCH_TOUR, availableTourSteps } from '../Help/steps';
import { useWalletTourExample } from '../Help/useWalletTourExample';
import type { useAppState } from '../useAppState';
import type { WorkbenchMode } from './workbenchTypes';
import { entityPanelFiltersFromGraph } from './Workbenches/Graph/Filters/entityPanelFilters';
import { download } from '../../Infra/Storage/download';
import { useGraphProjection } from './Workbenches/Graph/useGraphProjection';
import { useWorkspaceEvidence } from './ChainData/useWorkspaceEvidence';
import type { AddressHistoryLoadState } from './ChainData/addressHistoryLoad';
import { useWalletActivity } from './Workbenches/Wallet/useWalletActivity';
import { useGraphActions } from './Workbenches/Graph/useGraphActions';
import { createWalletActions } from './Workbenches/Wallet/walletActions';
import { createAnalysisActions } from './Workbenches/Analysis/analysisActions';

const EMPTY_GRAPH_FILTERS: GraphFilters = {};
type EntityRemovalInput = Pick<
  Workspace,
  | 'network'
  | 'transactions'
  | 'inputContext'
  | 'contextTransactionIds'
  | 'annotations'
  | 'tags'
  | 'wallets'
  | 'watchedAddresses'
>;
function entityRemovalPlan(input: EntityRemovalInput | undefined, nodeId: string) {
  return input ? planEntityRemoval(input as Workspace, nodeId) : undefined;
}
function resolveWalletUtxoObservationFromEvidence(
  input: WalletUtxoObservationInput | undefined,
  wallet: Pick<Wallet, 'addresses'> | undefined,
  view: { records: WalletUtxoRecord[]; checkedAt: string } | undefined,
  selectedId: string | undefined,
) {
  return resolveWalletUtxoObservation(input, wallet, view, selectedId);
}
type WalletUtxoObservationInput = Pick<Workspace, 'id' | 'network' | 'transactions'>;
export function useWorkspace(app: ReturnType<typeof useAppState>) {
  const {
    ws,
    w,
    fetchScope,
    updateWorkspace,
    getWorkspaceSession,
    persistWorkspace,
    workspaceId,
    networks,
    discoveryError,
    displayNetwork,
    status,
    unsupportedNetwork,
    connected,
    setExamplesOpen,
    setNotice,
    setNoticeSequence,
    setError,
    pendingGraphWorkspace,
    setPendingGraphWorkspace,
    wRef,
    registerGraphSnapshotFlush,
    flushActiveGraph,
  } = app;
  const workspaceNetwork = w?.network;
  const workspaceTransactions = w?.transactions;
  const workspaceInputContext = w?.inputContext;
  const workspaceContextTransactionIds = w?.contextTransactionIds;

  const workspaceAnnotations = w?.annotations;
  const workspaceTags = w?.tags;
  const workspaceWallets = w?.wallets;
  const workspaceWatchedAddresses = w?.watchedAddresses;

  const [entityRemoval, setEntityRemoval] = useState<{ workspaceId: string; nodeId: string }>();
  const [walletDialog, setWalletDialog] = useState(false);
  const [walletNameDialog, setWalletNameDialog] = useState<{
    workspaceId: string;
    walletId: string;
  }>();
  const [menu, setMenu] = useState(false);
  const workspaceMenu = useRef<HTMLDivElement>(null);
  const workspaceMenuTrigger = useRef<HTMLButtonElement>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [viewOwner, setViewOwner] = useState<string>();
  const [selectedWallet, setSelectedWallet] = useState<string>();
  const selectionGeneration = useRef(0);
  const invalidateSelection = useCallback(() => {
    selectionGeneration.current++;
  }, []);
  const [leftTab, setLeftTab] = useState<'wallets' | 'entities' | 'bookmarks' | 'tags'>('wallets');
  const [graphFilters, setGraphFilters] = useState<GraphFilters>({});
  const [entityFiltersLinked, setEntityFiltersLinked] = useState(true);
  const [entityPanelFilters, setEntityPanelFilters] = useState<GraphFilters>({});
  const selection = useEntitySelection(w?.id);
  const selectedBatchIds = selection.ids;
  const removeSelectedBatchIds = selection.remove;
  const [scanTargets, setScanTargets] = useState<string[]>([]);
  const [scanTargetDraft, setScanTargetDraft] = useState<{
    workspaceId: string;
    source: string;
    ids: string[];
  }>();
  const scanTargetInvoker = useRef<HTMLElement | null>(null);
  const toggleScanTarget = useCallback((id: string) => {
    if (!isScanNodeId(id)) return;
    setScanTargetDraft((draft) =>
      !draft || id === draft.source
        ? draft
        : {
            ...draft,
            ids: draft.ids.includes(id)
              ? draft.ids.filter((target) => target !== id)
              : [...draft.ids, id],
          },
    );
  }, []);
  const [navigation, setNavigation] = useState<{ ids: string[]; index: number }>({
    ids: [],
    index: -1,
  });
  const [focusGraph, setFocusGraph] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    token: number;
    preserveZoom?: boolean;
  }>();
  // Toolbar expansion can change selection without engaging Lock to selection.
  // A normal selection, explicit Center, or Lock toggle resumes camera following.
  const cameraPreservedSelection = useRef<string | undefined>(undefined);
  const preserveSelectionCamera = useCallback((id: string | undefined) => {
    cameraPreservedSelection.current = id;
  }, []);
  const setScanTargetInvoker = useCallback((element: HTMLElement) => {
    scanTargetInvoker.current = element;
  }, []);
  const analysisSessions = useRef(new Map<string, AnalysisWorkbenchSession>());
  const [walletScanRevision, setWalletScanRevision] = useState(0);
  useEffect(() => {
    const unlocked = new Set(ws.sessions.map((session) => session.data.id));
    for (const id of analysisSessions.current.keys())
      if (!unlocked.has(id)) analysisSessions.current.delete(id);
  }, [ws.sessions]);
  const [lockingWorkspace, setLockingWorkspace] = useState(false);
  const [workbench, setWorkbench] = useState<WorkbenchMode>('graph');
  const [returnWorkbench, setReturnWorkbench] = useState<WorkbenchMode>();
  const graphWorkspaceRef = useRef<HTMLElement>(null);
  const analysisWorkspaceRef = useRef<HTMLElement>(null);
  const walletWorkspaceRef = useRef<HTMLElement>(null);
  // The control that started a handoff, per originating workbench.
  const workbenchInvokers = useRef<
    Partial<Record<'analysis' | 'wallet', { workspaceId: string; element: HTMLElement }>>
  >({});
  const pendingWorkbenchFocus = useRef<
    { workspaceId: string; mode: WorkbenchMode; destination?: 'inspector' } | undefined
  >(undefined);
  const rightPanelRef = useRef<HTMLElement>(null);
  const workbenchSection = (mode: WorkbenchMode) =>
    mode === 'graph'
      ? graphWorkspaceRef.current
      : mode === 'analysis'
        ? analysisWorkspaceRef.current
        : walletWorkspaceRef.current;
  // Transfer focus only for explicit cross-workbench actions, never during graph gestures.
  useLayoutEffect(() => {
    const pending = pendingWorkbenchFocus.current;
    pendingWorkbenchFocus.current = undefined;
    if (!pending || pending.workspaceId !== w?.id || pending.mode !== workbench) return;
    if (workbench === 'graph') {
      // A handoff that reveals the Inspector must land there; the canvas can be
      // hidden behind the mobile panel switch and would drop focus to the body.
      const destination =
        pending.destination === 'inspector'
          ? (rightPanelRef.current ?? graphWorkspaceRef.current)
          : (graphWorkspaceRef.current?.querySelector<HTMLElement>(
              '.graph-canvas:not([aria-hidden="true"]) canvas',
            ) ??
            // The lazy renderer may still be loading. Land within Graph without
            // moving focus again when its canvas eventually becomes available.
            graphWorkspaceRef.current?.querySelector<HTMLElement>('.graph-stage') ??
            graphWorkspaceRef.current);
      destination?.focus({ preventScroll: true });
    } else {
      const section = workbenchSection(workbench);
      const invoker = workbenchInvokers.current[workbench];
      const element = invoker?.element;
      if (
        invoker?.workspaceId === w?.id &&
        element?.isConnected &&
        section?.contains(element) &&
        !element.matches(':disabled') &&
        element.getClientRects().length
      )
        element.focus();
      else section?.focus();
    }
  }, [w?.id, workbench]);
  const [rightTab, setRightTab] = useState<NonNullable<Workspace['view']['rightTab']>>('inspect');
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'left' | 'right'>('graph');
  const [prefetchDepth, setPrefetchDepth] = useState<0 | 1 | 2>(0);
  const [editToken, setEditToken] = useState(0);
  const [editTarget, setEditTarget] = useState<'label' | 'tags' | 'icon'>('label');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Only the reset signal stays lifted; the lookup text itself lives in
  // LookupForm so typing does not re-render the whole workbench.
  const [queryReset, setQueryReset] = useState(0);
  const clearQuery = () => setQueryReset((token) => token + 1);
  const [queryError, setQueryError] = useState('');
  const [operation, setOperation] = useState('');
  const [addressHistoryLoads, setAddressHistoryLoads] = useState<
    Record<string, AddressHistoryLoadState>
  >({});
  const [fitToken, setFitToken] = useState(0);
  const [tour, setTour] = useState<string>();
  const tourSteps = availableTourSteps(WORKBENCH_TOUR, {
    hasSelection: !!selectedId,
    hasTransactions: !!w && Object.keys(w.transactions).length > 0,
    features: [],
  });
  const tourStep =
    tour === undefined ? undefined : (tourSteps.find((step) => step.id === tour) ?? tourSteps[0]);
  const needsTourExample = !!w && !w.wallets.length && !!tourStep?.requiresWallet;
  const walletTourExample = useWalletTourExample(w?.id, needsTourExample);
  const tourExample = walletTourExample.snapshot;
  // Tour previews never feed the persisted presentation effect or selection history.
  const shownWorkbench = tourStep ? (tourStep.view?.workbench ?? 'graph') : workbench;
  const shownLeftTab = tourStep?.view?.leftTab ?? leftTab;
  const shownRightTab =
    tourStep?.view?.rightTab ??
    ((rightTab === 'addresses' || rightTab === 'transactions' || rightTab === 'utxos') &&
    !w?.wallets.some((item) => item.id === selectedWallet)
      ? 'inspect'
      : rightTab);
  const shownMobilePanel = tourStep?.view?.panel ?? mobilePanel;
  const shownFocusGraph = tourStep ? false : focusGraph;
  const pickingScanTargets =
    !!scanTargetDraft &&
    scanTargetDraft.workspaceId === w?.id &&
    shownWorkbench === 'graph' &&
    shownRightTab === 'scan' &&
    !lockingWorkspace &&
    !tourStep;
  useEffect(() => {
    if (!pickingScanTargets) setScanTargetDraft(undefined);
  }, [pickingScanTargets]);
  const finishScanTargetPicking = (apply: boolean) => {
    if (apply && scanTargetDraft) setScanTargets(scanTargetDraft.ids);
    if (scanTargetDraft) setSelectedId(scanTargetDraft.source);
    setScanTargetDraft(undefined);
    setMobilePanel('right');
    requestAnimationFrame(() => scanTargetInvoker.current?.focus({ preventScroll: true }));
  };
  const activeWorkspaceId = w?.id;
  const scanTargetPreview = useMemo(() => {
    if (!activeWorkspaceId || !scanTargetDraft || scanTargetDraft.workspaceId !== activeWorkspaceId)
      return {};
    try {
      return {
        targetCount: prepareCustomScanTargets({
          pickedNodeIds: scanTargetDraft.ids,
          source: scanTargetDraft.source,
        }).length,
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Targets could not be prepared.' };
    }
  }, [scanTargetDraft, activeWorkspaceId]);
  const [live, setLive] = useState(false);
  const [scanLimit, setScanLimit] = useState(200);
  const [gap, setGap] = useState(20);
  const spendingOffsets = useRef(
    new Map<string, { offset: number; unavailableTxids?: string[] }>(),
  );
  const operationRef = useRef<AbortController | undefined>(undefined);
  const pendingSelectionRef = useRef<string | undefined>(undefined);
  const addressHistoryJobsRef = useRef(
    new Map<string, { workspaceId: string; controller: AbortController }>(),
  );
  const labelsInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const current = wRef.current;
      if (event.key.toLowerCase() === 's' && current) {
        event.preventDefault();
        flushActiveGraph();
        void persistWorkspace(current.id).catch((error) =>
          setError(error instanceof Error ? error.message : 'Encrypted save failed.'),
        );
      } else if (
        event.key.toLowerCase() === 'k' &&
        current &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [persistWorkspace, flushActiveGraph, wRef, setError]);
  const graphProjection = useGraphProjection({
    w,
    graphFilters,
    fitToken,
    selectedId,
    selection,
    scanTargetDraft,
    pickingScanTargets,
    entityPanelFilters,
    entityFiltersLinked,
  });
  const {
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
  } = graphProjection;
  useEffect(() => {
    const available = recoveryNodesById;
    setNavigation((current) => {
      const ids = current.ids.filter((id) => available.has(id));
      if (ids.length === current.ids.length) return current;
      const index =
        current.ids.slice(0, current.index + 1).filter((id) => available.has(id)).length - 1;
      return { ids, index };
    });
    // Only entities that no longer exist leave the batch selection. Filtering or
    // hiding an entity keeps it selected, with its scope reported in the toolbar.
    const removed = selectedBatchIds.filter((id) => !available.has(id));
    if (removed.length) removeSelectedBatchIds(removed);
    if (selectedId && !available.has(selectedId)) {
      if (pendingSelectionRef.current !== selectedId) setSelectedId(undefined);
    } else if (pendingSelectionRef.current === selectedId) {
      pendingSelectionRef.current = undefined;
    }
  }, [recoveryNodesById, selectedId, selectedBatchIds, removeSelectedBatchIds]);
  const wallet = w?.wallets.find((x) => x.id === selectedWallet);
  const editingWallet =
    w?.id === walletNameDialog?.workspaceId
      ? w?.wallets.find((item) => item.id === walletNameDialog?.walletId)
      : undefined;
  const tx = selected?.txid ? w?.transactions[selected.txid] : undefined;
  const select = useCallback(
    (id: string, options?: { preserveCamera?: boolean; pickTarget?: boolean }) => {
      if (pickingScanTargets && options?.pickTarget !== false) {
        toggleScanTarget(id);
        return;
      }
      if (pendingSelectionRef.current && pendingSelectionRef.current !== id)
        pendingSelectionRef.current = undefined;
      selectionGeneration.current++;
      cameraPreservedSelection.current = options?.preserveCamera ? id : undefined;
      if (options?.preserveCamera) setFocusRequest(undefined);
      const active = getWorkspaceSession(wRef.current?.id ?? '')?.data;
      // A click admits exactly one entity, never its transaction's other branches.
      if (active) updateWorkspace(active.id, (current) => addGraphNodes(current, [id]), false);
      setSelectedId(id);
      setGraphFilters((filters) =>
        filters.focus ? { ...filters, focus: { ...filters.focus, id } } : filters,
      );
      setNavigation((current) =>
        current.ids[current.index] === id
          ? current
          : {
              ids: [...current.ids.slice(0, current.index + 1), id].slice(-100),
              index: Math.min(99, current.index + 1),
            },
      );
      setRightTab((current) => (current === 'scan' ? 'scan' : 'inspect'));
    },
    [updateWorkspace, getWorkspaceSession, pickingScanTargets, toggleScanTarget, wRef],
  );
  const resetWorkspacePresentation = useEffectEvent(() => {
    operationRef.current?.abort();
    cameraPreservedSelection.current = undefined;
    setTour(undefined);
    setOperation('');
    setSelectedId(w?.view.selectionId);
    setScanTargets([]);
    setScanTargetDraft(undefined);
    setSelectedWallet(
      w?.view.selectedWallet && w.wallets.some((item) => item.id === w.view.selectedWallet)
        ? w.view.selectedWallet
        : w?.wallets[0]?.id,
    );
    setLeftTab(w?.view.leftTab ?? 'wallets');
    setRightTab(w?.view.rightTab === 'analysis' ? 'inspect' : (w?.view.rightTab ?? 'inspect'));
    setWorkbench(
      w?.view.workbench === 'wallet' && w.wallets.length
        ? 'wallet'
        : w?.view.workbench === 'analysis' ||
            (!w?.view.workbench && w?.view.rightTab === 'analysis')
          ? 'analysis'
          : 'graph',
    );
    setReturnWorkbench(undefined);
    workbenchInvokers.current = {};
    pendingWorkbenchFocus.current = undefined;
    setLockingWorkspace(false);
    setMobilePanel(w?.view.mobilePanel ?? 'graph');
    setPrefetchDepth(w?.view.prefetchDepth ?? 0);
    setViewOwner(w?.id);
    setError('');
    setNotice('');
    setLive(false);
    setSettingsOpen(false);
    setWalletNameDialog(undefined);
    setExamplesOpen(false);
    setEntityRemoval(undefined);
    setEditToken(0);
    clearQuery();
    setQueryError('');
    setMenu(false);
    setFocusRequest(undefined);
    const savedGraphFilters = w?.view.filters ?? {};
    setGraphFilters(savedGraphFilters);
    setEntityPanelFilters(entityPanelFiltersFromGraph(savedGraphFilters));
    setEntityFiltersLinked(true);
    setNavigation(
      w?.view.selectionId ? { ids: [w.view.selectionId], index: 0 } : { ids: [], index: -1 },
    );
    setFocusGraph(w?.view.focusGraph ?? false);
    spendingOffsets.current.clear();
    if (!w?.view.graphSnapshot) setFitToken((t) => t + 1);
  });
  useEffect(() => {
    resetWorkspacePresentation();
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId) return;
    try {
      if (!localStorage.getItem('chaingraph.tour.seen')) {
        setTour(WORKBENCH_TOUR[0].id);
        localStorage.setItem('chaingraph.tour.seen', '1');
      }
    } catch {
      // A denied/full store must not crash an unlocked workspace or block export.
      setTour(WORKBENCH_TOUR[0].id);
    }
  }, [workspaceId]);
  const change = useCallback(
    (fn: (data: Workspace) => Workspace, undo = true, group?: string, description?: string) => {
      if (workspaceId) updateWorkspace(workspaceId, fn, undo, group, description);
    },
    [workspaceId, updateWorkspace],
  );
  const changeGraphView = (update: (view: Workspace['view']) => Workspace['view']) =>
    change((current) => {
      const view = update(current.view);
      return view === current.view ? current : { ...current, view };
    }, false);
  // Hydration has its own owner so a workspace switch never writes the previous view
  // into the newly active workspace. Presentation does not consume annotation undo.
  const savedGraphFilters = w?.view.filters;
  const presentationFilters = valueFilterError(graphFilters)
    ? (savedGraphFilters ?? EMPTY_GRAPH_FILTERS)
    : graphFilters;
  useEffect(() => {
    if (!workspaceId || viewOwner !== workspaceId) return;
    const presentation = {
      selectionId: selectedId,
      selectedWallet,
      filters: presentationFilters,
      leftTab,
      rightTab,
      workbench,
      mobilePanel,
      focusGraph,
      prefetchDepth,
    };
    updateWorkspace(
      workspaceId,
      (current) => {
        // Compare only these UI settings, never the saved graph geometry or membership.
        const unchanged = (Object.keys(presentation) as (keyof typeof presentation)[]).every(
          (key) =>
            current.view[key] === presentation[key] ||
            (key === 'filters' &&
              JSON.stringify(current.view.filters) === JSON.stringify(presentation.filters)),
        );
        return unchanged ? current : { ...current, view: { ...current.view, ...presentation } };
      },
      false,
    );
  }, [
    workspaceId,
    viewOwner,
    selectedId,
    selectedWallet,
    presentationFilters,
    leftTab,
    rightTab,
    workbench,
    mobilePanel,
    focusGraph,
    prefetchDepth,
    updateWorkspace,
  ]);
  const entityRemovalInput = useMemo<EntityRemovalInput | undefined>(() => {
    if (
      !workspaceNetwork ||
      !workspaceTransactions ||
      !workspaceAnnotations ||
      !workspaceWallets ||
      !workspaceWatchedAddresses
    )
      return undefined;
    return {
      network: workspaceNetwork,
      transactions: workspaceTransactions,
      inputContext: workspaceInputContext,
      contextTransactionIds: workspaceContextTransactionIds,
      annotations: workspaceAnnotations,
      tags: workspaceTags,
      wallets: workspaceWallets,
      watchedAddresses: workspaceWatchedAddresses,
    };
  }, [
    workspaceNetwork,
    workspaceTransactions,
    workspaceInputContext,
    workspaceContextTransactionIds,
    workspaceAnnotations,
    workspaceTags,
    workspaceWallets,
    workspaceWatchedAddresses,
  ]);
  const removalPlan = useMemo(() => {
    if (!entityRemoval || entityRemoval.workspaceId !== workspaceId) return undefined;
    return entityRemovalPlan(entityRemovalInput, entityRemoval.nodeId);
  }, [workspaceId, entityRemovalInput, entityRemoval]);
  const selectedRemovalPlan = useMemo(
    () => (selectedId ? entityRemovalPlan(entityRemovalInput, selectedId) : undefined),
    [entityRemovalInput, selectedId],
  );
  const hasRemovalPlan = removalPlan !== undefined;
  useEffect(() => {
    if (entityRemoval && !hasRemovalPlan) setEntityRemoval(undefined);
  }, [entityRemoval, hasRemovalPlan]);
  const removableNodeIds = useMemo(
    () =>
      workspaceTransactions && workspaceWatchedAddresses
        ? [
            ...Object.keys(workspaceTransactions).map(txNodeId),
            ...workspaceWatchedAddresses.map(addressNodeId),
          ]
        : [],
    [workspaceTransactions, workspaceWatchedAddresses],
  );
  const applyEntityRemoval = (workspaceId: string, nodeId: string) => {
    const current = wRef.current;
    if (!current || current.id !== workspaceId) {
      setEntityRemoval(undefined);
      return;
    }
    const plan = planEntityRemoval(current, nodeId);
    if (!plan) {
      setEntityRemoval(undefined);
      return;
    }
    ws.update(workspaceId, (latest) => removeWorkspaceEntity(latest, nodeId));
    setEntityRemoval(undefined);
    const remaining = ws.getSession(workspaceId)?.data;
    if (
      plan.kind === 'transaction' &&
      selectedId &&
      (plan.affectedNodeIds.includes(selectedId) ||
        !remaining ||
        !buildGraph(remaining).nodes.some((node) => node.id === selectedId))
    ) {
      setSelectedId(undefined);
      setFocusRequest(undefined);
    }
    setNotice(
      plan.kind === 'transaction'
        ? `Transaction removed${plan.automaticContextCount ? ` with ${plan.automaticContextCount} unused input context transaction${plan.automaticContextCount === 1 ? '' : 's'}` : ''}. Shared, independently added or annotated context is retained. Undo restores the removed data.`
        : 'Address is no longer watched. Loaded transactions remain. Undo restores the watch and annotations.',
    );
  };
  const requestEntityRemoval = (nodeId = selectedId) => {
    const current = wRef.current;
    if (!current || !nodeId) return;
    const plan = planEntityRemoval(current, nodeId);
    if (!plan) return;
    if (plan.requiresConfirmation)
      setEntityRemoval({ workspaceId: current.id, nodeId: plan.nodeId });
    else applyEntityRemoval(current.id, plan.nodeId);
  };
  const changeTags = (update: (workspace: Workspace) => Workspace) => {
    try {
      change((current) => {
        const next = update(current);
        return { ...next, tags: parseWorkspaceTags(next.tags ?? [], next.network) };
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update tags.');
    }
  };
  const canQuery = connected && !!w && !!networks?.includes(w.network) && !w.demo;
  const loadedLookupIds = useMemo(() => {
    const ids = new Set((w?.watchedAddresses ?? []).map(addressNodeId));
    for (const transaction of Object.values(w?.transactions ?? {})) {
      ids.add(txNodeId(transaction.txid));
      for (const output of transaction.vout) {
        ids.add(outputNodeId(transaction.txid, output.n));
        const address = outputAddress(output);
        if (address) ids.add(addressNodeId(address));
      }
      for (const input of transaction.vin) {
        if (!input.txid || input.vout === undefined) continue;
        if (!w?.inputContext?.[transaction.txid]) ids.add(outputNodeId(input.txid, input.vout));
        const address = input.prevout && outputAddress({ ...input.prevout, n: input.vout });
        if (address) ids.add(addressNodeId(address));
      }
    }
    return ids;
  }, [w?.transactions, w?.watchedAddresses, w?.inputContext]);
  function loadedLookupId(text: string) {
    const match = /^([0-9a-f]{64})(?::(\d+))?$/i.exec(text);
    const id = match
      ? match[2] === undefined
        ? txNodeId(match[1].toLowerCase())
        : outputNodeId(match[1].toLowerCase(), Number(match[2]))
      : addressNodeId(/^(bc1|tb1)/i.test(text) ? text.toLowerCase() : text);
    return loadedLookupIds.has(id) ? id : undefined;
  }
  const queryDisabledReason = w?.demo
    ? 'Legacy synthetic workspace. Live lookups are disabled; create an example workspace to explore real transactions.'
    : unsupportedNetwork
      ? `Backend does not support ${w!.network}.`
      : discoveryError ||
        (!networks
          ? 'Discovering supported networks…'
          : !status
            ? `Checking ${w?.network ?? displayNetwork ?? 'Bitcoin'} connection…`
            : !connected
              ? `${w?.network ?? displayNetwork ?? 'Bitcoin'} backend is unavailable.`
              : undefined);
  const canTrace = canQuery;
  const evidenceWallet = wallet ?? w?.wallets[0];
  const walletUtxos = useWalletUtxos({
    workspace: w,
    wallet: evidenceWallet,
    enabled:
      canQuery &&
      viewOwner === w?.id &&
      !lockingWorkspace &&
      !tourStep &&
      (workbench === 'wallet' || (workbench === 'graph' && rightTab === 'utxos')),
  });
  const walletUtxoObservation = useMemo(
    () =>
      resolveWalletUtxoObservationFromEvidence(
        workspaceId && workspaceNetwork && workspaceTransactions
          ? { id: workspaceId, network: workspaceNetwork, transactions: workspaceTransactions }
          : undefined,
        evidenceWallet,
        walletUtxos.utxos,
        selectedId,
      ),
    [
      workspaceId,
      workspaceNetwork,
      workspaceTransactions,
      evidenceWallet,
      walletUtxos.utxos,
      selectedId,
    ],
  );
  const workspaceEvidence = useWorkspaceEvidence({
    w,
    addressHistoryJobsRef,
    selected,
    addressHistoryLoads,
    fetchScope,
    operationRef,
    wRef,
    setOperation,
    setError,
    setNotice,
    ws,
    canQuery,
    setAddressHistoryLoads,
    updateWorkspace,
    getWorkspaceSession,
    revealLookup,
    selectionGeneration,
    setGraphFilters,
    select,
    setFocusRequest,
    loadedLookupId,
    clearQuery,
    prefetchDepth,
    recoveryGraph,
    canTrace,
    preserveSelectionCamera,
    selectedId,
    spendingOffsets,
  });
  const {
    addressHistory,
    addressBalance,
    addressUtxos,
    addressHistoryLoad,
    backgroundAddressHistoryLoad,
    getTransaction,
    run,
    mergeTransactions,
    openAddressHistory,
    refreshAddressBalance,
    loadAddressUtxos,
    showRecentAddressUtxos,
    showRecentAddressTransactions,
    openAddressHistoryTransaction,
    addQuery,
    expand,
    recentAddressUtxoTargets,
    recentAddressTransactionTargets,
  } = workspaceEvidence;
  const flowInputs = useFlowInputs({
    workspace: w,
    selected,
    enabled: canTrace && !operation && workbench === 'graph',
    fetch: (id, signal) => {
      if (!w) return Promise.reject(new Error('Open a workspace first.'));
      return w.transactions[id]
        ? Promise.resolve(w.transactions[id])
        : fetchTransaction(w.network, id, signal, undefined, {
            scope: fetchScope,
            priority: 'visible',
          });
    },
    update: ws.update,
  });
  function revealLookup(id: string) {
    if (!w) return;
    pendingSelectionRef.current = id;
    const address = id.startsWith('addr:') ? id.slice(5) : undefined;
    ws.update(w.id, (current) => ({
      ...setNodesHidden(current, [id], false),
      watchedAddresses: address
        ? [...new Set([...current.watchedAddresses, address])]
        : current.watchedAddresses,
      view: {
        ...current.view,
        hiddenNodeIds: current.view.hiddenNodeIds?.filter((hidden) => hidden !== id),
        smallAmountThreshold: undefined,
        showAddresses: !!address || current.view.showAddresses,
      },
    }));
    select(id);
    setGraphFilters({});
    setLeftTab('entities');
    setMobilePanel('graph');
    setFocusRequest((previous) => ({ id, token: (previous?.token ?? 0) + 1 }));
  }
  async function exportWorkspace() {
    const id = flushActiveGraph();
    if (!id) return;
    await run(async () => {
      setOperation('Encrypting workspace export…');
      const { name, envelope } = await ws.exportEncrypted(id);
      download(`${name.replace(/[^a-z0-9_-]/gi, '-')}.chaingraph`, JSON.stringify(envelope));
      setNotice('Encrypted workspace exported. Keep the file and password safe.');
    });
  }
  const walletActivity = useWalletActivity({
    setOperation,
    gap,
    scanLimit,
    fetchScope,
    ws,
    w,
    canQuery,
    setNotice,
    setFitToken,
    run,
    operationRef,
    wRef,
    mergeTransactions,
    updateWorkspace,
    live,
    workspaceId,
  });
  const { scan } = walletActivity;
  const undoToken = ws.getSession(w?.id ?? '')?.undoRevision ?? 0;
  const undoDescription = ws.active?.history.at(-1)?.description;
  const undoLabel = undoDescription ? `Undo: ${undoDescription}` : 'Nothing to undo';
  const redoDescription = ws.active?.redoHistory.at(-1)?.description;
  const redoLabel = redoDescription ? `Redo: ${redoDescription}` : 'Nothing to redo';
  const applyBatch = (summary: string, update: (data: Workspace) => Workspace) => {
    if (!w) return undefined;
    const before = ws.getSession(w.id)?.undoRevision;
    try {
      // A single workspace update keeps one Undo step for the whole batch.
      change(update);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The batch edit could not be applied.');
      return undefined;
    }
    const after = ws.getSession(w.id)?.undoRevision;
    setError('');
    if (after === undefined || after === before) {
      // Nothing changed, so no undo step exists and none is offered.
      setNotice('That batch left every selected entity unchanged.');
      return undefined;
    }
    setNotice(`${summary}. Undo restores the previous values.`);
    return after;
  };
  const bookmarks = Object.entries(w?.annotations ?? {}).filter(([, a]) => a.bookmarked);
  const graphActions = useGraphActions({
    selectionGeneration,
    invalidateSelection,
    preserveSelectionCamera,
    change,
    setFocusRequest,
    setNotice,
    w,
    setError,
    setGraphFilters,
    setEditTarget,
    setScanTargetDraft,
    select,
    setFocusGraph,
    setRightTab,
    setMobilePanel,
    setEditToken,
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
    setFitToken,
    graphFilters,
    setEntityPanelFilters,
    setEntityFiltersLinked,
    wRef,
    ws,
    setOperation,
    getTransaction,
    entityFiltersLinked,
    run,
  });
  const { revealGraphNodes, updateFilters, showOnGraph, loadGraphTransactions } = graphActions;
  function switchWorkbench(next: WorkbenchMode, handoffFocus = false, destination?: 'inspector') {
    pendingWorkbenchFocus.current =
      handoffFocus && w ? { workspaceId: w.id, mode: next, destination } : undefined;
    flushActiveGraph();
    setWorkbench(next);
  }
  /** Remember the control that started a handoff so the return restores focus. */
  function recordHandoffInvoker(origin: 'analysis' | 'wallet') {
    const invoker = document.activeElement;
    const section =
      origin === 'analysis' ? analysisWorkspaceRef.current : walletWorkspaceRef.current;
    workbenchInvokers.current[origin] =
      w && invoker instanceof HTMLElement && section?.contains(invoker)
        ? { workspaceId: w.id, element: invoker }
        : undefined;
  }
  // The factory only creates event handlers; refs are read when an action runs, not during render.
  // oxlint-disable-next-line react/refs
  const walletActions = createWalletActions({
    w,
    wallet,
    shownRightTab,
    setNotice,
    select,
    setGraphFilters,
    showOnGraph,
    setRightTab,
    selection,
    ws,
    selectionGeneration,
    loadGraphTransactions,
    wRef,
    mergeTransactions,
    run,
    recordHandoffInvoker,
    setReturnWorkbench,
    switchWorkbench,
    setMobilePanel,
    recoveryGraph,
    setSelectedId,
    graph,
    revealGraphNodes,
    updateFilters,
    setLeftTab,
    change,
  });

  // The factory only creates event handlers; refs are read when an action runs, not during render.
  // oxlint-disable-next-line react/refs
  const analysisActions = createAnalysisActions({
    w,
    ws,
    recordHandoffInvoker,
    setReturnWorkbench,
    switchWorkbench,
    showOnGraph,
    canQuery,
    operationRef,
    selectionGeneration,
    loadGraphTransactions,
    wRef,
    mergeTransactions,
    setNotice,
    run,
  });

  return {
    invalidateSelection,
    preserveSelectionCamera,
    setScanTargetInvoker,
    w,
    switchWorkbench,
    walletUtxoObservation,
    addressBalance,
    selected,
    walletMatches,
    setNotice,
    setNoticeSequence,
    selectionGeneration,
    operationRef,
    setSelectedWallet,
    setSelectedId,
    setRightTab,
    setMobilePanel,
    editToken,
    editTarget,
    setEditToken,
    changeTags,
    setLeftTab,
    tx,
    graph,
    operation,
    canTrace,
    queryDisabledReason,
    select,
    expand,
    getTransaction,
    mergeTransactions,
    run,
    refreshAddressBalance,
    selectedRemovalPlan,
    requestEntityRemoval,
    change,
    wallet,
    canQuery,
    scan,
    setWalletNameDialog,
    tourStep,
    shownRightTab,
    rightTab,
    selectedId,
    selectedWallet,
    fetchScope,
    scanTargetDraft,
    pickingScanTargets,
    scanTargets,
    scanTargetInvoker,
    setScanTargetDraft,
    setScanTargets,
    visibleGraph,
    connectionMembers,
    flowIndex,
    scanNeighbours,
    shownWorkbench,
    lockingWorkspace,
    wRef,
    ws,
    setGraphFilters,
    setFocusRequest,
    walletUtxos,
    rightPanelRef,
    removableNodeIds,
    selection,
    shownLeftTab,
    setWalletDialog,
    gap,
    setGap,
    scanLimit,
    setScanLimit,
    live,
    setLive,
    entityPanelFilters,
    graphFilters,
    entityFiltersLinked,
    setEntityPanelFilters,
    recoveryGraph,
    visibleEntityCount,
    entityVisibility,
    hiddenCount,
    canvasFilterResult,
    graphFiltering,
    entityNodes,
    entityBatchNodes,
    bookmarks,
    graphFlowContext,
    canvasIds,
    allGraphOutputIds,
    admittedIds,
    hiddenIds,
    unconnectedForHide,
    unconnectedForRemoval,
    recentAddressUtxoTargets,
    addressUtxos,
    addressHistory,
    recentAddressTransactionTargets,
    openAddressHistory,
    showRecentAddressUtxos,
    showRecentAddressTransactions,
    navigation,
    cameraPreservedSelection,
    workbench,
    viewOwner,
    renderEntityMetadata,
    addressHistoryLoad,
    loadAddressUtxos,
    openAddressHistoryTransaction,
    flowInputs,
    amountGraph,
    shownFocusGraph,
    setFocusGraph,
    changeGraphView,
    connected,
    setPendingGraphWorkspace,
    registerGraphSnapshotFlush,
    appliedGraphRequest,
    batchPresentation,
    focusRequest,
    graphSelectedId,
    highlightedSelection,
    toggleScanTarget,
    admittedGraph,
    graphWorkspaceRef,
    shownMobilePanel,
    menu,
    workspaceMenu,
    setMenu,
    workspaceMenuTrigger,
    returnWorkbench,
    searchInput,
    queryReset,
    queryError,
    setQueryError,
    loadedLookupId,
    addQuery,
    prefetchDepth,
    setPrefetchDepth,
    undoLabel,
    redoLabel,
    exportWorkspace,
    setSettingsOpen,
    labelsInput,
    flushActiveGraph,
    setLockingWorkspace,
    setError,
    tourExample,
    analysisSessions,
    setWalletScanRevision,
    walletWorkspaceRef,
    walletScanRevision,
    analysisWorkspaceRef,
    selectionOnCanvas,
    matchingScope,
    applyBatch,
    undoToken,
    undoDescription,
    finishScanTargetPicking,
    scanTargetPreview,
    backgroundAddressHistoryLoad,
    pendingGraphWorkspace,
    setTour,
    settingsOpen,
    entityRemoval,
    removalPlan,
    setEntityRemoval,
    applyEntityRemoval,
    editingWallet,
    walletNameDialog,
    walletDialog,
    tour,
    tourSteps,
    needsTourExample,
    walletTourExample,
    graphActions,
    walletActions,
    analysisActions,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
