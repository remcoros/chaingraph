import { resolveWalletUtxoObservation } from '../../Core/Workspace/Wallets/WalletUtxos/walletUtxoObservation';
import { useWalletUtxos } from './Wallets/WalletUtxos';
import type { WalletUtxoRecord } from '../../Core/Workspace/Wallets/walletRecords';
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
import { useGraphLookupState } from './Workbenches/Graph/Navigation/useGraphLookupState';
import { useDialogState } from './useDialogState';
import { useWorkspaceHistory } from './useWorkspaceHistory';
import { useAnnotations } from './Annotations/useAnnotations';
import { useConnectionScanTargets } from './Selection/useConnectionScanTargets';
import { setNodesHidden } from './GraphState/visibility';
import { useWorkspaceAnalysis } from './Workbenches/Analysis/useWorkspaceAnalysis';
import type { Wallet } from '../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../Core/Workspace/workspace';

import { useTour } from '../Help/useTour';
import type { useAppState } from '../useAppState';
import type { WorkbenchEntryTarget, WorkbenchMode, WorkbenchSwitchOptions } from './workbenchTypes';
import { download } from '../../Core/Browser/download';
import { isModalOpen } from '../Controls/useDialogFocus';
import { useGraphProjection } from './Workbenches/Graph/useGraphProjection';
import { useAddressEvidence } from './Workbenches/Graph/Address/useAddressEvidence';
import { useAddressNavigation } from './Workbenches/Graph/Address/useAddressNavigation';
import { useGraphExpansion } from './Workbenches/Graph/Navigation/useGraphExpansion';
import { useGraphLookup } from './Workbenches/Graph/Navigation/useGraphLookup';
import { useWorkspaceOperation } from './useWorkspaceOperation';
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
type WalletUtxoObservationInput = Pick<Workspace, 'id' | 'network'> & {
  chainData: Pick<Workspace['chainData'], 'transactions'>;
};
type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;
type WorkbenchReturnPoint = {
  workspaceId: string;
  workbench: WorkbenchMode;
  element?: HTMLElement;
};
type WorkbenchEntryRequest = {
  workspaceId: string;
  workbench: WorkbenchMode;
  interaction: NonNullable<WorkbenchSwitchOptions['interaction']>;
  target: WorkbenchEntryTarget;
};

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
  const lookup = useGraphLookupState(activeWorkspace);
  const focusLookup = lookup.focus;
  const workspaceNetwork = activeWorkspace?.network;
  const workspaceTransactions = activeWorkspace?.chainData.transactions;

  const dialogs = useDialogState(activeWorkspace);
  const [viewOwner, setViewOwner] = useState<string>();
  const graphPanels = useGraphPanels({
    workspace: activeWorkspace,
    workspaceId,
    getWorkspace: getUnlockedWorkspace,
  });
  const { setRightTab, setMobilePanel, setPanels } = graphPanels;
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
  const analysisWorkspaceRef = useRef<HTMLElement>(null);
  const walletWorkspaceRef = useRef<HTMLElement>(null);
  const returnPoint = useRef<WorkbenchReturnPoint | undefined>(undefined);
  const [workbenchEntry, setWorkbenchEntry] = useState<WorkbenchEntryRequest>();
  const workbenchSection = useCallback(
    (mode: WorkbenchMode) =>
      mode === 'graph'
        ? graphWorkspaceRef.current
        : mode === 'analysis'
          ? analysisWorkspaceRef.current
          : walletWorkspaceRef.current,
    [graphWorkspaceRef, analysisWorkspaceRef, walletWorkspaceRef],
  );
  // Workspace restores a returning control or focuses a workbench root. Graph resolves
  // its own stage and Inspector entry targets without exposing its DOM to Workspace.
  useLayoutEffect(() => {
    if (
      !workbenchEntry ||
      workbenchEntry.workspaceId !== activeWorkspace?.id ||
      workbenchEntry.workbench !== workbench ||
      workbenchEntry.target === 'stage' ||
      workbenchEntry.target === 'inspector'
    )
      return;
    const section = workbenchSection(workbench);
    const element =
      workbenchEntry.interaction === 'return' ? returnPoint.current?.element : undefined;
    if (
      returnPoint.current?.workspaceId === activeWorkspace.id &&
      returnPoint.current.workbench === workbench &&
      element?.isConnected &&
      section?.contains(element) &&
      !element.matches(':disabled') &&
      element.getClientRects().length
    )
      element.focus({ preventScroll: true });
    else section?.focus({ preventScroll: true });
  }, [activeWorkspace?.id, workbench, workbenchEntry, workbenchSection]);
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
  const workspaceOperation = useWorkspaceOperation(core);
  const tour = useTour({
    workspaceId: activeWorkspace?.id,
    hasWallets: !!activeWorkspace?.wallets.definitions.length,
    hasSelection: !!selectedId,
    hasTransactions:
      !!activeWorkspace && Object.keys(activeWorkspace.chainData.transactions).length > 0,
  });
  const tourStep = tour.step;
  // Tour previews never change saved workspace state or selection history.
  const shownWorkbench = tourStep ? (tourStep.view?.workbench ?? 'graph') : workbench;
  const shownPanels = graphPanelsInView(graphPanels.saved, {
    preview: tourStep?.view,
    previewing: !!tourStep,
    hasSelectedWallet: !!activeWorkspace?.wallets.definitions.some(
      (item) => item.id === selectedWallet,
    ),
  });
  const {
    right: { tab: shownRightTab },
  } = shownPanels;
  const savedRightTab = graphPanels.saved.right.tab;
  const connectionScanTargets = useConnectionScanTargets({
    workspaceId: activeWorkspace?.id,
    setPickHandler: selection.setPickHandler,
    canPick:
      shownWorkbench === 'graph' && shownRightTab === 'scan' && !lockingWorkspace && !tourStep,
    onSelectSource: setSelectedId,
    onShowPanel: setMobilePanel,
  });
  const pickingScanTargets = connectionScanTargets.picking;
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
  const wallet = activeWorkspace?.wallets.definitions.find((x) => x.id === selectedWallet);
  const tx = selected?.txid ? activeWorkspace?.chainData.transactions[selected.txid] : undefined;
  const resetWorkspacePresentation = useEffectEvent(() => {
    workspaceOperation.cancel();
    preserveSelectionCamera(undefined);
    tour.show(undefined);
    setOperation('');
    setSelectedId(activeWorkspace?.view.selectionId);
    connectionScanTargets.reset();
    setSelectedWallet(
      activeWorkspace?.view.selectedWallet &&
        activeWorkspace.wallets.definitions.some(
          (item) => item.id === activeWorkspace.view.selectedWallet,
        )
        ? activeWorkspace.view.selectedWallet
        : activeWorkspace?.wallets.definitions[0]?.id,
    );
    setWorkbench(
      activeWorkspace?.view.workbench === 'wallet' && activeWorkspace.wallets.definitions.length
        ? 'wallet'
        : activeWorkspace?.view.workbench === 'analysis'
          ? 'analysis'
          : 'graph',
    );
    setReturnWorkbench(undefined);
    returnPoint.current = undefined;
    setWorkbenchEntry(undefined);
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
    // oxlint-disable-next-line react/set-state-in-effect -- Aborts running work and restores a saved presentation when the workspace changes.
    resetWorkspacePresentation();
  }, [workspaceId]);
  const annotations = useAnnotations({
    current: activeWorkspace,
    sessions: workspaces,
    edit: edit,
    setError,
    setNotice,
  });
  // Hydration has its own owner so a workspace switch never writes the previous
  // presentation into the newly active workspace. Presentation does not consume annotation undo.
  const presentationFilters = filters.persistable(activeWorkspace?.view.filters);
  useEffect(() => {
    if (!workspaceId || viewOwner !== workspaceId) return;
    getUnlockedWorkspace(workspaceId)?.edit((current) => {
      const presentation = {
        selectionId: selectedId,
        selectedWallet,
        filters: presentationFilters,
        workbench,
        prefetchDepth,
      };
      // Compare only these UI settings, never the saved graph geometry or membership.
      const unchanged = (Object.keys(presentation) as (keyof typeof presentation)[]).every(
        (key) => JSON.stringify(current.view[key]) === JSON.stringify(presentation[key]),
      );
      return unchanged ? current : { ...current, view: { ...current.view, ...presentation } };
    }, false);
  }, [
    workspaceId,
    viewOwner,
    selectedId,
    selectedWallet,
    presentationFilters,
    workbench,
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
  const transactionEvidence = app.chainDataAcquisition;
  const evidenceWallet = wallet ?? activeWorkspace?.wallets.definitions[0];
  const walletUtxos = useWalletUtxos({
    workspace: activeWorkspace,
    wallet: evidenceWallet,
    transactions: transactionEvidence,
    enabled:
      canLoadChainData &&
      viewOwner === activeWorkspace?.id &&
      !lockingWorkspace &&
      !tourStep &&
      (workbench === 'wallet' || (workbench === 'graph' && savedRightTab === 'utxos')),
  });
  const walletUtxoObservation = useMemo(
    () =>
      resolveWalletUtxoObservationFromEvidence(
        workspaceId && workspaceNetwork && workspaceTransactions
          ? {
              id: workspaceId,
              network: workspaceNetwork,
              chainData: { transactions: workspaceTransactions },
            }
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
  const addressEvidence = useAddressEvidence({
    core,
    selection,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    selected,
    canLoadChainData,
  });
  const addressNavigation = useAddressNavigation({
    core,
    selection,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    evidence: addressEvidence,
    selected,
    setGraphFilters,
    setFocusRequest,
    canLoadChainData,
    revealLookup,
  });
  const graphLookup = useGraphLookup({
    core,
    selection,
    state: lookup,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    addressEvidence,
    canLoadChainData,
    prefetchDepth,
    reveal: revealLookup,
  });
  const graphExpansion = useGraphExpansion({
    core,
    selection,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    setGraphFilters,
    setFocusRequest,
    recoveryGraph,
    canTraceAncestry,
  });
  const graphAddress = {
    history: addressEvidence.addressHistory,
    balance: addressEvidence.addressBalance,
    utxos: addressEvidence.addressUtxos,
    historyLoad: addressEvidence.addressHistoryLoad,
    backgroundHistoryLoad: addressEvidence.backgroundAddressHistoryLoad,
    recentUtxoTargets: addressNavigation.recentAddressUtxoTargets,
    recentTransactionTargets: addressNavigation.recentAddressTransactionTargets,
    actions: {
      openHistory: addressNavigation.openAddressHistory,
      openOutputAddress: addressNavigation.openSelectedOutputAddress,
      refreshBalance: addressEvidence.refreshAddressBalance,
      loadUtxos: addressEvidence.loadAddressUtxos,
      showRecentUtxos: addressNavigation.showRecentAddressUtxos,
      showRecentTransactions: addressNavigation.showRecentAddressTransactions,
      openHistoryTransaction: addressNavigation.openAddressHistoryTransaction,
    },
  };
  const { run } = workspaceOperation;
  const flowInputs = useFlowInputs({
    workspace: activeWorkspace,
    selected,
    enabled: canTraceAncestry && !operation && workbench === 'graph',
    fetch: (id, signal) => transactionEvidence.read.transaction(id, signal, 'visible'),
    update: (id, fn, undo) => workspaces.getUnlocked(id)?.edit(fn, undo),
  });
  function revealLookup(id: string) {
    if (!activeWorkspace) return;
    const address = id.startsWith('addr:') ? id.slice(5) : undefined;
    active?.edit((current) => ({
      ...setNodesHidden(current, [id], false),
      view: {
        ...current.view,
        hiddenNodeIds: current.view.hiddenNodeIds?.filter((hidden) => hidden !== id),
        smallAmountThreshold: undefined,
        showAddresses: !!address || current.view.showAddresses,
      },
      chainData: {
        ...current.chainData,
        watchedAddresses: address
          ? [...new Set([...current.chainData.watchedAddresses, address])]
          : current.chainData.watchedAddresses,
      },
    }));
    select(id);
    setGraphFilters({});
    setPanels((current) => ({
      ...current,
      left: { ...current.left, tab: 'entities' },
      mobile: 'graph',
    }));
    setFocusRequest((previous) => ({ id, token: (previous?.token ?? 0) + 1 }));
  }
  async function exportWorkspace() {
    const id = flushActiveGraph();
    if (!id) return;
    await run(async () => {
      setOperation('Encrypting workspace export…');
      const { name, contents } = await workspaces.exportEncrypted(id);
      download(`${name.replace(/[^a-z0-9_-]/gi, '-')}.chaingraph`, contents);
      setNotice('Encrypted workspace exported. Keep the file and password safe.');
    });
  }
  const walletDiscovery = useWalletActivity({
    core,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    canLoadChainData,
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
    transactions: transactionEvidence,
    operation: workspaceOperation,
    viewOwner,
  });
  function captureReturnPoint(origin: WorkbenchMode): WorkbenchReturnPoint | undefined {
    if (!activeWorkspace) return;
    const section = workbenchSection(origin);
    const activeElement = document.activeElement;
    return {
      workspaceId: activeWorkspace.id,
      workbench: origin,
      element:
        activeElement instanceof HTMLElement && section?.contains(activeElement)
          ? activeElement
          : undefined,
    };
  }
  function changeWorkbench(
    next: WorkbenchMode,
    options: WorkbenchSwitchOptions = {},
    capturedOrigin?: WorkbenchReturnPoint,
  ) {
    const interaction = options.interaction ?? 'switch';
    if (interaction === 'handoff' && activeWorkspace) {
      const origin =
        capturedOrigin?.workspaceId === activeWorkspace.id
          ? capturedOrigin
          : captureReturnPoint(workbench);
      if (origin && origin.workbench !== next) {
        returnPoint.current = origin;
        setReturnWorkbench(origin.workbench);
      }
    }
    const target =
      options.focus ??
      (interaction === 'handoff'
        ? next === 'graph'
          ? 'stage'
          : 'workbench'
        : interaction === 'return'
          ? 'workbench'
          : undefined);
    setWorkbenchEntry(
      target && activeWorkspace
        ? {
            workspaceId: activeWorkspace.id,
            workbench: next,
            interaction,
            target,
          }
        : undefined,
    );
    flushActiveGraph();
    setWorkbench(next);
  }
  function switchWorkbench(next: WorkbenchMode, options?: WorkbenchSwitchOptions) {
    changeWorkbench(next, options);
  }
  function workbenchActionSwitch(origin: WorkbenchMode) {
    const capturedOrigin = captureReturnPoint(origin);
    return (next: WorkbenchMode, options?: WorkbenchSwitchOptions) =>
      changeWorkbench(next, options, capturedOrigin);
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
  const walletCommands = createWalletActions({
    activeWorkspace,
    workspaces,
    setNotice,
    select,
    setSelectedId,
    replaceSelection: selection.batch.replace,
    setSelectionMode: selection.batch.setMode,
    handoff: graphHandoff,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    wallet,
    shownRightTab,
    setGraphFilters,
  });

  const analysisCommands = createAnalysisActions({
    activeWorkspace,
    workspaces,
    setNotice,
    handoff: graphHandoff,
    transactions: transactionEvidence,
    operation: workspaceOperation,
    canLoadChainData,
  });

  function captureCurrent(workspaceId: string) {
    const generation = selection.generation.current;
    return () =>
      activeWorkspaceRef.current?.id === workspaceId && selection.generation.current === generation;
  }
  function walletActionRuntime() {
    return { captureCurrent, switchWorkbench: workbenchActionSwitch('wallet') };
  }
  function analysisActionRuntime() {
    return {
      captureCurrent,
      hasActiveOperation: workspaceOperation.isActive,
      switchWorkbench: workbenchActionSwitch('analysis'),
    };
  }
  const walletActions = {
    selectWalletRecord: (...args: Tail<Parameters<typeof walletCommands.selectWalletRecord>>) =>
      walletCommands.selectWalletRecord(walletActionRuntime(), ...args),
    openWalletRecord: (...args: Tail<Parameters<typeof walletCommands.openWalletRecord>>) =>
      walletCommands.openWalletRecord(walletActionRuntime(), ...args),
    analyzeFromWallet: (...args: Tail<Parameters<typeof walletCommands.analyzeFromWallet>>) =>
      walletCommands.analyzeFromWallet(walletActionRuntime(), ...args),
  };
  const analysisActions = {
    showFindingOnGraph: (...args: Tail<Parameters<typeof analysisCommands.showFindingOnGraph>>) =>
      analysisCommands.showFindingOnGraph(analysisActionRuntime(), ...args),
  };

  return {
    graph: {
      projection: graphProjection,
      canvas: graphCanvas,
      panels: { ...graphPanels, ...shownPanels },
      filters,
      actions: graphActions,
      address: graphAddress,
      navigation: graphExpansion,
      lookup: { ...lookup, submit: graphLookup.submit },
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
    analysis: {
      sessions: analysis.sessions,
      walletRevision: analysis.walletRevision,
      noteWalletAnalysis: analysis.noteWalletAnalysis,
      sectionRef: analysisWorkspaceRef,
      actions: analysisActions,
    },
    selection,
    annotations,
    history,
    dialogs,
    activeWorkspace,
    switchWorkbench,
    setNotice,
    setNoticeSequence,
    operation: { ...workspaceOperation, status: operation },
    selectedTransaction: tx,
    canTraceAncestry,
    chainDataDisabledReason,
    edit,
    canLoadChainData,
    fetchScope,
    shownWorkbench,
    lockingWorkspace,
    activeWorkspaceRef,
    workspaces,
    workbench,
    workbenchEntry,
    viewOwner,
    connected,
    graphWorkspaceRef,
    returnWorkbench,
    prefetchDepth,
    setPrefetchDepth,
    exportWorkspace,
    setLockingWorkspace,
    setError,
    entityRemoval,
    tour,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspace>;
