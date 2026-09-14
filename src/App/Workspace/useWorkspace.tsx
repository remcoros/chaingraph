import { resolveWalletUtxoObservation } from '../../Domain/Wallet/walletUtxoObservation';
import { useWalletUtxos } from './Workbenches/Wallet/useWalletUtxos';
import { type WalletUtxoRecord } from '../../Domain/Wallet/walletRecords';
import { useFlowInputs } from './useFlowInputs';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useWorkspaceSelection } from './Selection/useWorkspaceSelection';
import { useWorkspaceFilters } from './Workbenches/Graph/Filters/useWorkspaceFilters';
import { useEntityRemoval } from './useEntityRemoval';
import { useWorkspaceLookup } from './useWorkspaceLookup';
import { useDialogState } from './useDialogState';
import { useWorkspaceHistory } from './useWorkspaceHistory';
import { useAnnotations } from './Annotations/useAnnotations';
import { useConnectionScanTargets } from './Selection/useConnectionScanTargets';
import { setNodesHidden } from '../../Domain/Graph/visibility';
import { type AnalysisSession } from './Workbenches/Analysis/analysisSession';
import { type Wallet, type Workspace } from '../../Domain/types';
import { fetchTransaction } from '../../Infra/Bitcoin/api';
import { WORKBENCH_TOUR, availableTourSteps } from '../Help/steps';
import { useWalletTourExample } from '../Help/useWalletTourExample';
import type { useAppState } from '../useAppState';
import type { WorkbenchMode } from './workbenchTypes';
import { download } from '../../Infra/Storage/download';
import { isModalOpen } from '../../Shared/Controls/useDialogFocus';
import { useGraphProjection } from './Workbenches/Graph/useGraphProjection';
import { useWorkspaceEvidence } from './ChainData/useWorkspaceEvidence';
import type { AddressHistoryLoadState } from './ChainData/addressHistoryLoad';
import { useWalletActivity } from './Workbenches/Wallet/useWalletActivity';
import { useGraphActions } from './Workbenches/Graph/useGraphActions';
import { createWalletActions } from './Workbenches/Wallet/walletActions';
import { createAnalysisActions } from './Workbenches/Analysis/analysisActions';

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
  const lookup = useWorkspaceLookup(w);
  const focusLookup = lookup.focus;
  const workspaceNetwork = w?.network;
  const workspaceTransactions = w?.transactions;

  const dialogs = useDialogState(w);
  const [viewOwner, setViewOwner] = useState<string>();
  const [leftTab, setLeftTab] = useState<'wallets' | 'entities' | 'bookmarks' | 'tags'>('wallets');
  const filters = useWorkspaceFilters();
  const {
    graph: graphFilters,
    setGraph: setGraphFilters,
    entityPanel: entityPanelFilters,
    setEntityPanel: setEntityPanelFilters,
    entityLinked: entityFiltersLinked,
    setEntityLinked: setEntityFiltersLinked,
  } = filters;
  const [focusGraph, setFocusGraph] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    token: number;
    preserveZoom?: boolean;
  }>();
  const analysisSessions = useRef(new Map<string, AnalysisSession>());
  const [walletAnalysisRevision, setWalletAnalysisRevision] = useState(0);
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
  const selection = useWorkspaceSelection({
    workspaceId: w?.id,
    currentRef: wRef,
    sessions: ws,
    setGraphFilters,
    setRightTab,
  });
  const {
    selectedId,
    setSelectedId,
    selectedWallet,
    setSelectedWallet,
    select,
    navigation,
    setNavigation,
    prune,
    generation: selectionGeneration,
    invalidate: invalidateSelection,
    preserveCamera: preserveSelectionCamera,
    cameraPreserved: cameraPreservedSelection,
  } = selection;
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'left' | 'right'>('graph');
  const [prefetchDepth, setPrefetchDepth] = useState<0 | 1 | 2>(0);
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
  const connectionScanTargets = useConnectionScanTargets({
    workspaceId: w?.id,
    setPickHandler: selection.setPickHandler,
    canPick:
      shownWorkbench === 'graph' && shownRightTab === 'scan' && !lockingWorkspace && !tourStep,
    onSelectSource: setSelectedId,
    onShowPanel: setMobilePanel,
  });
  const pickingScanTargets = connectionScanTargets.picking;
  const spendingOffsets = useRef(
    new Map<string, { offset: number; unavailableTxids?: string[] }>(),
  );
  const operationRef = useRef<AbortController | undefined>(undefined);
  const addressHistoryJobsRef = useRef(
    new Map<string, { workspaceId: string; controller: AbortController }>(),
  );
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
      } else if (event.key.toLowerCase() === 'k' && current && !isModalOpen()) {
        event.preventDefault();
        focusLookup();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [persistWorkspace, flushActiveGraph, wRef, setError, focusLookup]);
  const graphProjection = useGraphProjection({
    w,
    graphFilters,
    fitToken,
    selectedId,
    selection: selection.batch,
    scanTargetDraft: connectionScanTargets.draft,
    pickingScanTargets,
    entityPanelFilters,
    entityFiltersLinked,
  });
  const {
    graph,
    effectiveFilters,
    admittedIds,
    visibleGraph,
    hiddenIds,
    recoveryGraph,
    recoveryNodesById,
    selected,
    selectedNodeIsVisible,
  } = graphProjection;
  useEffect(() => {
    prune(recoveryNodesById);
  }, [recoveryNodesById, prune]);
  const wallet = w?.wallets.find((x) => x.id === selectedWallet);
  const tx = selected?.txid ? w?.transactions[selected.txid] : undefined;
  const resetWorkspacePresentation = useEffectEvent(() => {
    operationRef.current?.abort();
    preserveSelectionCamera(undefined);
    setTour(undefined);
    setOperation('');
    setSelectedId(w?.view.selectionId);
    connectionScanTargets.reset();
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
    dialogs.closeAll();
    setExamplesOpen(false);
    lookup.clear();
    lookup.setError('');
    setFocusRequest(undefined);
    filters.hydrate(w?.view.filters);
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
  const annotations = useAnnotations({
    current: w,
    sessions: ws,
    edit: change,
    setError,
    setNotice,
  });
  const changeGraphView = (update: (view: Workspace['view']) => Workspace['view']) =>
    change((current) => {
      const view = update(current.view);
      return view === current.view ? current : { ...current, view };
    }, false);
  // Hydration has its own owner so a workspace switch never writes the previous view
  // into the newly active workspace. Presentation does not consume annotation undo.
  const presentationFilters = filters.persistable(w?.view.filters);
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
  const entityRemoval = useEntityRemoval({
    w,
    wRef,
    ws,
    workspaceId,
    selectedId,
    setSelectedId,
    clearFocusRequest: () => setFocusRequest(undefined),
    setNotice,
  });
  const canQuery = connected && !!w && !!networks?.includes(w.network) && !w.demo;
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
    selectedId,
    select,
    selectionGeneration,
    preserveSelectionCamera,
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
    setGraphFilters,
    setFocusRequest,
    loadedLookupId: lookup.resolveLoaded,
    clearQuery: lookup.clear,
    prefetchDepth,
    recoveryGraph,
    canTrace,
    spendingOffsets,
  });
  const { getTransaction, run, mergeTransactions } = workspaceEvidence;
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
    selection.markPending(id);
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
  const walletDiscovery = useWalletActivity({
    setOperation,
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
    workspaceId,
  });
  const history = useWorkspaceHistory({ w, ws });
  const graphActions = useGraphActions({
    cancelScanTargetPicking: connectionScanTargets.cancelPicking,
    selectionGeneration,
    invalidateSelection,
    preserveSelectionCamera,
    select,
    selectedId,
    setSelectedId,
    navigation,
    cameraPreservedSelection,
    change,
    setFocusRequest,
    setNotice,
    w,
    setError,
    setGraphFilters,
    requestMetadataEdit: annotations.edit.request,
    setFocusGraph,
    setRightTab,
    setMobilePanel,
    workspaceId,
    viewOwner,
    hiddenIds,
    updateWorkspace,
    selectedNodeIsVisible,
    admittedIds,
    visibleGraph,
    graph,
    effectiveFilters,
    setNavigation,
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
    selectionGeneration,
    select,
    setSelectedId,
    w,
    wallet,
    shownRightTab,
    setNotice,
    setGraphFilters,
    showOnGraph,
    setRightTab,
    selection: selection.batch,
    ws,
    loadGraphTransactions,
    wRef,
    mergeTransactions,
    run,
    recordHandoffInvoker,
    setReturnWorkbench,
    switchWorkbench,
    setMobilePanel,
    recoveryGraph,
    graph,
    revealGraphNodes,
    updateFilters,
    setLeftTab,
    change,
  });

  // The factory only creates event handlers; refs are read when an action runs, not during render.
  // oxlint-disable-next-line react/refs
  const analysisActions = createAnalysisActions({
    selectionGeneration,
    w,
    ws,
    recordHandoffInvoker,
    setReturnWorkbench,
    switchWorkbench,
    showOnGraph,
    canQuery,
    operationRef,
    loadGraphTransactions,
    wRef,
    mergeTransactions,
    setNotice,
    run,
  });

  return {
    filters,
    selection,
    annotations,
    history,
    dialogs,
    lookup,
    graphProjection,
    evidence: workspaceEvidence,
    w,
    switchWorkbench,
    walletUtxoObservation,
    setNotice,
    setNoticeSequence,
    operationRef,
    setRightTab,
    setMobilePanel,
    setLeftTab,
    tx,
    operation,
    canTrace,
    queryDisabledReason,
    change,
    wallet,
    canQuery,
    walletDiscovery,
    tourStep,
    shownRightTab,
    rightTab,
    fetchScope,
    connectionScanTargets,
    shownWorkbench,
    lockingWorkspace,
    wRef,
    ws,
    setFocusRequest,
    walletUtxos,
    rightPanelRef,
    shownLeftTab,
    workbench,
    viewOwner,
    flowInputs,
    shownFocusGraph,
    setFocusGraph,
    changeGraphView,
    connected,
    setPendingGraphWorkspace,
    registerGraphSnapshotFlush,
    focusRequest,
    graphWorkspaceRef,
    shownMobilePanel,
    returnWorkbench,
    prefetchDepth,
    setPrefetchDepth,
    exportWorkspace,
    flushActiveGraph,
    setLockingWorkspace,
    setError,
    tourExample,
    analysisSessions,
    setWalletAnalysisRevision,
    walletWorkspaceRef,
    walletAnalysisRevision,
    analysisWorkspaceRef,
    pendingGraphWorkspace,
    setTour,
    entityRemoval,
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
