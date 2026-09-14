import { resolveWalletUtxoObservation } from '../../Domain/Wallet/walletUtxoObservation';
import { useWalletUtxos } from './Workbenches/Wallet/useWalletUtxos';
import { type WalletUtxoRecord } from '../../Domain/Wallet/walletRecords';
import { useFlowInputs } from './Workbenches/Graph/TransactionFlow/useFlowInputs';
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
import { useGraphCanvas } from './Workbenches/Graph/useGraphCanvas';
import type { WorkspaceCore } from './workspaceCore';
import type { GraphHandoff } from './Workbenches/workbenchHandoff';
import { graphPanelsInView, useGraphPanels } from './Workbenches/Graph/useGraphPanels';
import { useEntityRemoval } from './useEntityRemoval';
import { useWorkspaceLookup } from './useWorkspaceLookup';
import { useDialogState } from './useDialogState';
import { useWorkspaceHistory } from './useWorkspaceHistory';
import { useAnnotations } from './Annotations/useAnnotations';
import { useConnectionScanTargets } from './Selection/useConnectionScanTargets';
import { setNodesHidden } from '../../Domain/Graph/visibility';
import { useWorkspaceAnalysis } from './Workbenches/Analysis/useWorkspaceAnalysis';
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
    workspaces,
    activeWorkspace,
    fetchScope,
    getUnlockedWorkspace,
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
    activeWorkspaceRef,
    registerGraphSnapshotFlush,
    flushActiveGraph,
  } = app;
  const lookup = useWorkspaceLookup(activeWorkspace);
  const focusLookup = lookup.focus;
  const workspaceNetwork = activeWorkspace?.network;
  const workspaceTransactions = activeWorkspace?.transactions;

  const dialogs = useDialogState(activeWorkspace);
  const [viewOwner, setViewOwner] = useState<string>();
  const graphPanels = useGraphPanels();
  const { setLeftTab, setRightTab, setMobilePanel } = graphPanels;
  const graphCanvas = useGraphCanvas({
    getUnlockedWorkspace,
    workspaceId,
    registerSnapshotFlush: registerGraphSnapshotFlush,
    flushActive: flushActiveGraph,
    pendingWorkspaceId: pendingGraphWorkspace,
    setPendingWorkspaceId: setPendingGraphWorkspace,
  });
  const { setFocusRequest, fitToken } = graphCanvas;
  const fitAll = graphCanvas.fitAll;
  const filters = useWorkspaceFilters();
  const {
    graph: graphFilters,
    setGraph: setGraphFilters,
    entityPanel: entityPanelFilters,
    entityLinked: entityFiltersLinked,
  } = filters;
  const analysis = useWorkspaceAnalysis(workspaces.unlocked);
  const [lockingWorkspace, setLockingWorkspace] = useState(false);
  const [workbench, setWorkbench] = useState<WorkbenchMode>('graph');
  const [returnWorkbench, setReturnWorkbench] = useState<WorkbenchMode>();
  const graphWorkspaceRef = useRef<HTMLElement>(null);
  const analysisWorkspaceRef = analysis.sectionRef;
  const walletWorkspaceRef = useRef<HTMLElement>(null);
  // The control that started a handoff, per originating workbench.
  const workbenchInvokers = useRef<
    Partial<Record<'analysis' | 'wallet', { workspaceId: string; element: HTMLElement }>>
  >({});
  const pendingWorkbenchFocus = useRef<
    { workspaceId: string; mode: WorkbenchMode; destination?: 'inspector' } | undefined
  >(undefined);
  const rightPanelRef = useRef<HTMLElement>(null);
  const workbenchSection = useCallback(
    (mode: WorkbenchMode) =>
      mode === 'graph'
        ? graphWorkspaceRef.current
        : mode === 'analysis'
          ? analysisWorkspaceRef.current
          : walletWorkspaceRef.current,
    [graphWorkspaceRef, analysisWorkspaceRef, walletWorkspaceRef],
  );
  // Transfer focus only for explicit cross-workbench actions, never during graph gestures.
  useLayoutEffect(() => {
    const pending = pendingWorkbenchFocus.current;
    pendingWorkbenchFocus.current = undefined;
    if (!pending || pending.workspaceId !== activeWorkspace?.id || pending.mode !== workbench)
      return;
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
        invoker?.workspaceId === activeWorkspace?.id &&
        element?.isConnected &&
        section?.contains(element) &&
        !element.matches(':disabled') &&
        element.getClientRects().length
      )
        element.focus();
      else section?.focus();
    }
  }, [activeWorkspace?.id, workbench, workbenchSection]);
  const selection = useWorkspaceSelection({
    workspaceId: activeWorkspace?.id,
    currentRef: activeWorkspaceRef,
    sessions: workspaces,
    setGraphFilters,
    revealSelected: graphPanels.revealInspector,
  });
  const {
    selectedId,
    setSelectedId,
    selectedWallet,
    setSelectedWallet,
    select,
    setNavigation,
    prune,
    preserveCamera: preserveSelectionCamera,
  } = selection;
  const [prefetchDepth, setPrefetchDepth] = useState<0 | 1 | 2>(0);
  const [operation, setOperation] = useState('');
  const [tour, setTour] = useState<string>();
  const tourSteps = availableTourSteps(WORKBENCH_TOUR, {
    hasSelection: !!selectedId,
    hasTransactions: !!activeWorkspace && Object.keys(activeWorkspace.transactions).length > 0,
    features: [],
  });
  const tourStep =
    tour === undefined ? undefined : (tourSteps.find((step) => step.id === tour) ?? tourSteps[0]);
  const needsTourExample =
    !!activeWorkspace && !activeWorkspace.wallets.length && !!tourStep?.requiresWallet;
  const walletTourExample = useWalletTourExample(activeWorkspace?.id, needsTourExample);
  const tourExample = walletTourExample.snapshot;
  // Tour previews never feed the persisted presentation effect or selection history.
  const shownWorkbench = tourStep ? (tourStep.view?.workbench ?? 'graph') : workbench;
  const shownPanels = graphPanelsInView(graphPanels.chosen, {
    preview: tourStep?.view,
    previewing: !!tourStep,
    hasSelectedWallet: !!activeWorkspace?.wallets.some((item) => item.id === selectedWallet),
  });
  const { rightTab: shownRightTab } = shownPanels;
  const { leftTab, rightTab, mobilePanel, focusGraph } = graphPanels.chosen;
  const connectionScanTargets = useConnectionScanTargets({
    workspaceId: activeWorkspace?.id,
    setPickHandler: selection.setPickHandler,
    canPick:
      shownWorkbench === 'graph' && shownRightTab === 'scan' && !lockingWorkspace && !tourStep,
    onSelectSource: setSelectedId,
    onShowPanel: setMobilePanel,
  });
  const pickingScanTargets = connectionScanTargets.picking;
  const operationRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const current = activeWorkspaceRef.current;
      if (event.key.toLowerCase() === 's' && current) {
        event.preventDefault();
        flushActiveGraph();
        void workspaces
          .getUnlocked(current.id)
          ?.persist()
          .catch((error) =>
            setError(error instanceof Error ? error.message : 'Encrypted save failed.'),
          );
      } else if (event.key.toLowerCase() === 'k' && current && !isModalOpen()) {
        event.preventDefault();
        focusLookup();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [workspaces, flushActiveGraph, activeWorkspaceRef, setError, focusLookup]);
  const graphProjection = useGraphProjection({
    activeWorkspace,
    graphFilters,
    fitToken,
    selectedId,
    selection: selection.batch,
    scanTargetDraft: connectionScanTargets.draft,
    pickingScanTargets,
    entityPanelFilters,
    entityFiltersLinked,
  });
  const { recoveryGraph, recoveryNodesById, selected } = graphProjection;
  useEffect(() => {
    prune(recoveryNodesById);
  }, [recoveryNodesById, prune]);
  const wallet = activeWorkspace?.wallets.find((x) => x.id === selectedWallet);
  const tx = selected?.txid ? activeWorkspace?.transactions[selected.txid] : undefined;
  const resetWorkspacePresentation = useEffectEvent(() => {
    operationRef.current?.abort();
    preserveSelectionCamera(undefined);
    setTour(undefined);
    setOperation('');
    setSelectedId(activeWorkspace?.view.selectionId);
    connectionScanTargets.reset();
    setSelectedWallet(
      activeWorkspace?.view.selectedWallet &&
        activeWorkspace.wallets.some((item) => item.id === activeWorkspace.view.selectedWallet)
        ? activeWorkspace.view.selectedWallet
        : activeWorkspace?.wallets[0]?.id,
    );
    graphPanels.hydrate(activeWorkspace?.view);
    setWorkbench(
      activeWorkspace?.view.workbench === 'wallet' && activeWorkspace.wallets.length
        ? 'wallet'
        : activeWorkspace?.view.workbench === 'analysis' ||
            (!activeWorkspace?.view.workbench && activeWorkspace?.view.rightTab === 'analysis')
          ? 'analysis'
          : 'graph',
    );
    setReturnWorkbench(undefined);
    workbenchInvokers.current = {};
    pendingWorkbenchFocus.current = undefined;
    setLockingWorkspace(false);
    setPrefetchDepth(activeWorkspace?.view.prefetchDepth ?? 0);
    setViewOwner(activeWorkspace?.id);
    setError('');
    setNotice('');
    dialogs.closeAll();
    setExamplesOpen(false);
    lookup.clear();
    lookup.setError('');
    setFocusRequest(undefined);
    filters.hydrate(activeWorkspace?.view.filters);
    setNavigation(
      activeWorkspace?.view.selectionId
        ? { ids: [activeWorkspace.view.selectionId], index: 0 }
        : { ids: [], index: -1 },
    );
    if (!activeWorkspace?.view.graphSnapshot) fitAll();
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
  const active = workspaces.active;
  const edit = useCallback(
    (fn: (data: Workspace) => Workspace, undo = true, group?: string, description?: string) => {
      active?.edit(fn, undo, group, description);
    },
    [active],
  );
  const core: WorkspaceCore = {
    activeWorkspace,
    activeWorkspaceRef,
    workspaceId,
    workspaces,
    edit,
    setNotice,
    setError,
    setOperation,
  };
  const annotations = useAnnotations({
    current: activeWorkspace,
    sessions: workspaces,
    edit: edit,
    setError,
    setNotice,
  });
  // Hydration has its own owner so a workspace switch never writes the previous view
  // into the newly active workspace. Presentation does not consume annotation undo.
  const presentationFilters = filters.persistable(activeWorkspace?.view.filters);
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
    getUnlockedWorkspace(workspaceId)?.edit((current) => {
      // Compare only these UI settings, never the saved graph geometry or membership.
      const unchanged = (Object.keys(presentation) as (keyof typeof presentation)[]).every(
        (key) =>
          current.view[key] === presentation[key] ||
          (key === 'filters' &&
            JSON.stringify(current.view.filters) === JSON.stringify(presentation.filters)),
      );
      return unchanged ? current : { ...current, view: { ...current.view, ...presentation } };
    }, false);
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
    getUnlockedWorkspace,
  ]);
  const entityRemoval = useEntityRemoval({
    activeWorkspace,
    activeWorkspaceRef,
    workspaces,
    workspaceId,
    selectedId,
    setSelectedId,
    clearFocusRequest: () => setFocusRequest(undefined),
    setNotice,
  });
  const canLoadChainData =
    connected &&
    !!activeWorkspace &&
    !!networks?.includes(activeWorkspace.network) &&
    !activeWorkspace.demo;
  const chainDataDisabledReason = activeWorkspace?.demo
    ? 'Legacy synthetic workspace. Live lookups are disabled; create an example workspace to explore real transactions.'
    : unsupportedNetwork
      ? `Backend does not support ${activeWorkspace!.network}.`
      : discoveryError ||
        (!networks
          ? 'Discovering supported networks…'
          : !status
            ? `Checking ${activeWorkspace?.network ?? displayNetwork ?? 'Bitcoin'} connection…`
            : !connected
              ? `${activeWorkspace?.network ?? displayNetwork ?? 'Bitcoin'} backend is unavailable.`
              : undefined);
  const canTraceAncestry = canLoadChainData;
  const evidenceWallet = wallet ?? activeWorkspace?.wallets[0];
  const walletUtxos = useWalletUtxos({
    workspace: activeWorkspace,
    wallet: evidenceWallet,
    enabled:
      canLoadChainData &&
      viewOwner === activeWorkspace?.id &&
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
    core,
    selection,
    lookup,
    setGraphFilters,
    setFocusRequest,
    selected,
    recoveryGraph,
    fetchScope,
    operationRef,
    canLoadChainData,
    canTraceAncestry,
    prefetchDepth,
    revealLookup,
  });
  const { run } = workspaceEvidence;
  const flowInputs = useFlowInputs({
    workspace: activeWorkspace,
    selected,
    enabled: canTraceAncestry && !operation && workbench === 'graph',
    fetch: (id, signal) => {
      if (!activeWorkspace) return Promise.reject(new Error('Open a workspace first.'));
      return activeWorkspace.transactions[id]
        ? Promise.resolve(activeWorkspace.transactions[id])
        : fetchTransaction(activeWorkspace.network, id, signal, undefined, {
            scope: fetchScope,
            priority: 'visible',
          });
    },
    update: (id, fn, undo) => workspaces.getUnlocked(id)?.edit(fn, undo),
  });
  function revealLookup(id: string) {
    if (!activeWorkspace) return;
    selection.markPending(id);
    const address = id.startsWith('addr:') ? id.slice(5) : undefined;
    active?.edit((current) => ({
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
      const { name, envelope } = await workspaces.exportEncrypted(id);
      download(`${name.replace(/[^a-z0-9_-]/gi, '-')}.chaingraph`, JSON.stringify(envelope));
      setNotice('Encrypted workspace exported. Keep the file and password safe.');
    });
  }
  const walletDiscovery = useWalletActivity({
    core,
    evidence: workspaceEvidence,
    fetchScope,
    canLoadChainData,
    operationRef,
    fitAll,
  });
  const history = useWorkspaceHistory({ workspaces });
  const graphActions = useGraphActions({
    core,
    selection,
    projection: graphProjection,
    filters,
    panels: graphPanels,
    canvas: graphCanvas,
    scanTargets: connectionScanTargets,
    annotations,
    evidence: workspaceEvidence,
    viewOwner,
  });
  function switchWorkbench(next: WorkbenchMode, handoffFocus = false, destination?: 'inspector') {
    pendingWorkbenchFocus.current =
      handoffFocus && activeWorkspace
        ? { workspaceId: activeWorkspace.id, mode: next, destination }
        : undefined;
    flushActiveGraph();
    setWorkbench(next);
  }
  /** Remember the control that started a handoff so the return restores focus. */
  function recordHandoffInvoker(origin: 'analysis' | 'wallet') {
    const invoker = document.activeElement;
    const section =
      origin === 'analysis' ? analysisWorkspaceRef.current : walletWorkspaceRef.current;
    workbenchInvokers.current[origin] =
      activeWorkspace && invoker instanceof HTMLElement && section?.contains(invoker)
        ? { workspaceId: activeWorkspace.id, element: invoker }
        : undefined;
  }
  // The factory only creates event handlers; refs are read when an action runs, not during render.
  // oxlint-disable-next-line react/refs
  // What Graph publishes to the other workbenches, assembled once.
  const graphHandoff: GraphHandoff = {
    ...graphActions,
    graph: graphProjection.graph,
    recoveryGraph: graphProjection.recoveryGraph,
    showRecordTab: setRightTab,
    showPanel: setMobilePanel,
    revealEntities: graphPanels.revealEntities,
  };
  const walletActions = createWalletActions({
    core,
    selection,
    handoff: graphHandoff,
    evidence: workspaceEvidence,
    wallet,
    shownRightTab,
    setGraphFilters,
    recordHandoffInvoker,
    setReturnWorkbench,
    switchWorkbench,
  });

  // The factory only creates event handlers; refs are read when an action runs, not during render.
  // oxlint-disable-next-line react/refs
  const analysisActions = createAnalysisActions({
    core,
    selection,
    handoff: graphHandoff,
    evidence: workspaceEvidence,
    canLoadChainData,
    operationRef,
    recordHandoffInvoker,
    setReturnWorkbench,
    switchWorkbench,
  });

  return {
    graph: {
      projection: graphProjection,
      canvas: graphCanvas,
      panels: { ...graphPanels, ...shownPanels },
      filters,
      actions: graphActions,
      flowInputs,
      scanTargets: connectionScanTargets,
    },
    wallet: {
      selected: wallet,
      utxos: walletUtxos,
      utxoObservation: walletUtxoObservation,
      discovery: walletDiscovery,
      sectionRef: walletWorkspaceRef,
      actions: walletActions,
    },
    analysis: { ...analysis, actions: analysisActions },
    selection,
    annotations,
    history,
    dialogs,
    lookup,
    evidence: workspaceEvidence,
    activeWorkspace,
    switchWorkbench,
    setNotice,
    setNoticeSequence,
    operationRef,
    selectedTransaction: tx,
    operationStatus: operation,
    canTraceAncestry,
    chainDataDisabledReason,
    edit,
    canLoadChainData,
    tourStep,
    rightTab,
    fetchScope,
    shownWorkbench,
    lockingWorkspace,
    activeWorkspaceRef,
    workspaces,
    rightPanelRef,
    workbench,
    viewOwner,
    connected,
    graphWorkspaceRef,
    returnWorkbench,
    prefetchDepth,
    setPrefetchDepth,
    exportWorkspace,
    setLockingWorkspace,
    setError,
    tourExample,
    setTour,
    entityRemoval,
    tour,
    tourSteps,
    needsTourExample,
    walletTourExample,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
