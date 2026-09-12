import { formatBitcoinAmount } from './domain/amountFormat';
import { Amount } from './components/Amount';
import { TransactionFetchShell } from './lib/useTransactionFetch';
import { ConnectionScanPanel } from './components/ConnectionScanPanel';
import { ScanTargetToolbar } from './components/ScanTargetToolbar';
import { prepareCustomScanTargets } from './domain/connectionScanTargets';
import { indexScanNeighbours } from './domain/connectionScanNeighbours';
import { isScanNodeId } from './domain/connectionScan';
import { addScanPathAddition, addScanNodeAddition } from './domain/connectionScanAddition';
import { spendingNotice } from './lib/spendingNotice';
import { WalletRecordsPanel } from './components/WalletRecordsPanel';
import { resolveGraphHandoff } from './domain/graphHandoff';
import { resolveWalletUtxoObservation } from './domain/walletUtxoObservation';
import { useWalletUtxos } from './lib/useWalletUtxos';
import {
  verifiedWalletAddresses,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from './domain/walletRecords';
import { listWalletRelationships } from './domain/walletRelationships';
import {
  indexAddressHistoryTransactions,
  listAddressHistory,
  projectAddressHistory,
  recentAddressHistoryEntries,
  recentAddressUtxos,
  RECENT_ADDRESS_GRAPH_LIMIT,
  shouldLoadAddressHistory,
  selectedAddress as selectedAddressForHistory,
} from './domain/addressHistory';
import { useFlowInputs } from './lib/useFlowInputs';
import { ExamplesDialog } from './components/ExamplesDialog';
import { EMPTY_GRAPH_ANNOTATIONS, GraphMetadataProjection } from './lib/graphMetadata';
import { GraphLegend } from './components/GraphLegend';
import { indexGraphFlow } from './components/graph/flowContext';
import { GraphContextToolbar, type GraphContextSideCounts } from './components/GraphContextToolbar';
import { graphUnconnectedOutputIds, graphTransactionOutputIds } from './domain/graphBranch';
import {
  addGraphNodes,
  ensureGraphMembership,
  hideGraphNodes,
  projectGraphMembership,
  projectGraphAddresses,
  removeGraphNodes,
  fullGraphMembershipEvidence,
  showAllGraphOutputs,
} from './domain/graphMembership';
import { GraphControls } from './components/GraphControls';
import { LookupForm } from './components/LookupForm';
import { EntityBadges } from './components/EntityBadges';
import { CopyButton } from './components/CopyButton';
import TagsPanel, { SelectedTags } from './components/TagsPanel';
import { buildWalletMatches, tagNodeIds, buildTagIndex, parseWorkspaceTags } from './domain/tags';
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Crosshair,
  Focus,
  Filter,
  Download,
  Ellipsis,
  Eye,
  FolderOpen,
  GitBranch,
  List,
  LoaderCircle,
  LockKeyhole,
  Network as NetworkIcon,
  Plus,
  Search,
  Upload,
  Wallet as WalletIcon,
  X,
  Undo2,
  Redo2,
} from 'lucide-react';
// The graph renderer is the one genuinely optional chunk: it pulls in three.js
// and is not needed until a workspace is open. The other workbenches and dialogs
// are deliberately NOT split: their stylesheets would then load as separate
// chunks, and this project uses global, unscoped CSS whose cascade depends on
// source order.
const GraphView = lazy(() => import('./components/GraphView'));

import {
  CreateDialog,
  ImportDialog,
  UnlockDialog,
  WalletDialog,
  WalletNameDialog,
  WorkspaceDetailsDialog,
  Modal,
} from './components/Dialogs';
import { TransactionView } from './components/TransactionView';
import { emptyAnnotation, NodeInspector, WalletInspector } from './components/Inspector';
import { HelpMenu } from './components/HelpMenu';
import { AboutDialog } from './components/AboutDialog';
import {
  describeMatchScope,
  filterGraph,
  buildGraphFilterIndex,
  hasActiveFilters,
  intersectIds,
  matchingWalletFilterNodeIds,
  selectedWalletFilterIds,
  valueFilterError,
  type GraphFilters,
} from './domain/graphFilters';
import { useEntitySelection } from './lib/useEntitySelection';
import { applyBatchIcon } from './domain/batchMetadata';
import { SelectionToolbar } from './components/SelectionToolbar';
import {
  FilterChips,
  GraphConnectionsAction,
  GraphFilterButton,
} from './components/GraphFilterControls';
import { GraphWalletFilter } from './components/GraphWalletFilter';
import { setNodesHidden, showAllNodes, transactionNodeIds } from './domain/visibility';
import { planEntityRemoval, removeWorkspaceEntity } from './domain/entityRemoval';
import { applyWalletScan, walletActivitySummary } from './domain/walletActivity';
import { AnalysisWorkbench, type AnalysisWorkbenchSession } from './components/AnalysisWorkbench';
import { WalletWorkbench } from './components/WalletWorkbench';
import { pruneWalletReviews } from './domain/walletReview';
import './components/workbenches.css';
import { WorkspaceHome } from './components/WorkspaceHome';
import { WorkspacePanel } from './components/WorkspacePanel';
import { GuidedTour } from './components/GuidedTour';
import {
  buildGraph,
  clearContextProvenance,
  markContextTransactions,
  promoteInputContext,
  outputAddress,
} from './domain/workspace';
import { mergeTransactionObservations } from './domain/prevouts';
import { withHistoryHeight } from './domain/transactionStatus';
import { filterSmallAmounts, omitAmountOrphans } from './domain/smallAmounts';
import {
  outputNodeId,
  addressNodeId,
  txNodeId,
  type GraphData,
  type Network,
  type Transaction,
  type Wallet,
  type Workspace,
  type WorkspaceTag,
} from './domain/types';
import {
  fetchAddressBalance,
  fetchAddressUtxos,
  fetchHistory,
  fetchTransaction,
  loadAddress,
  loadSpending,
  mapLimit,
  MAX_SCAN_TRANSACTIONS,
  scanWallet,
  type AddressHistoryLoadCallbacks,
} from './lib/api';
import { addressToScriptHash } from './lib/wallet';
import { useBackendNetworks } from './lib/useBackendNetworks';
import { ancestryNotice, loadAncestors, traceSourceExists } from './lib/tracing';
import { WORKBENCH_TOUR, availableTourSteps } from './features/tour/steps';
import { useWalletTourExample } from './features/tour/useWalletTourExample';
import { WORKSPACE_TEMPLATES } from './domain/workspaceTemplates';
import { MAX_ENCRYPTED_FILE_BYTES } from './lib/crypto';
import { exportLabels, importLabels } from './lib/labels';
import { useWorkspaces, type SavedWorkspace } from './lib/useWorkspaces';

type WorkbenchMode = 'wallet' | 'graph' | 'analysis';
const WORKBENCH_LABELS: Record<WorkbenchMode, string> = {
  wallet: 'Wallet',
  graph: 'Graph',
  analysis: 'Analysis',
};
const ADDRESS_DISPLAY_NOTICE = 'This address is no longer hidden. Address nodes are switched off.';
type AddressHistoryLoadPhase = 'history' | 'details' | 'balance';
interface AddressHistoryLoadState {
  workspaceId: string;
  address: string;
  phase: AddressHistoryLoadPhase;
  done: number;
  total: number;
  error?: string;
}

const addressHistoryLoadKey = (workspaceId: string, network: Network, address: string) =>
  `${workspaceId}:${network}:${address}`;

/** Panel-local filters do not own graph scope actions such as isolate or context. */
function entityPanelFiltersFromGraph(filters: GraphFilters): GraphFilters {
  const panelFilters = { ...filters };
  delete panelFilters.excludeIds;
  delete panelFilters.focus;
  delete panelFilters.includeIds;
  delete panelFilters.preserveContext;
  delete panelFilters.showAddresses;
  return panelFilters;
}

function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function withScanActionEvidence(
  workspace: Workspace,
  evidence?: Record<string, Transaction>,
): Workspace {
  return evidence
    ? {
        ...workspace,
        connectionScans: {
          runs: workspace.connectionScans?.runs ?? [],
          evidence: { ...workspace.connectionScans?.evidence, ...evidence },
        },
      }
    : workspace;
}

export default function App() {
  const ws = useWorkspaces();
  const w = ws.active?.data;
  const fetchScope = ws.active?.fetchScope;
  const updateWorkspace = ws.update;
  const getWorkspaceSession = ws.getSession;
  const [create, setCreate] = useState<string>();
  const [unlock, setUnlock] = useState<SavedWorkspace>();
  const [entityRemoval, setEntityRemoval] = useState<{ workspaceId: string; nodeId: string }>();
  const [walletDialog, setWalletDialog] = useState(false);
  const [walletNameDialog, setWalletNameDialog] = useState<{
    workspaceId: string;
    walletId: string;
  }>();
  const [fileDialog, setFileDialog] = useState<File>();
  const [menu, setMenu] = useState(false);
  const workspaceMenu = useRef<HTMLDivElement>(null);
  const workspaceMenuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const items = () =>
      [
        ...(workspaceMenu.current?.querySelectorAll<HTMLButtonElement>(
          '.dropdown button:not(:disabled)',
        ) ?? []),
      ].filter((item) => item.offsetParent !== null);
    items()[0]?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!workspaceMenu.current?.contains(event.target as Node)) setMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(false);
        workspaceMenuTrigger.current?.focus({ preventScroll: true });
      }
      const buttons = items();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index < 0) return;
      const next =
        event.key === 'ArrowDown'
          ? (index + 1) % buttons.length
          : event.key === 'ArrowUp'
            ? (index - 1 + buttons.length) % buttons.length
            : undefined;
      if (next !== undefined) {
        event.preventDefault();
        buttons[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  const [selectedId, setSelectedId] = useState<string>();
  const inspectorScroll = useRef<HTMLDivElement>(null);
  const [viewOwner, setViewOwner] = useState<string>();
  const [selectedWallet, setSelectedWallet] = useState<string>();
  const selectionGeneration = useRef(0);
  const [leftTab, setLeftTab] = useState<'wallets' | 'entities' | 'bookmarks' | 'tags'>('wallets');
  const [graphFilters, setGraphFilters] = useState<GraphFilters>({});
  const [entityFiltersLinked, setEntityFiltersLinked] = useState(true);
  const [entityPanelFilters, setEntityPanelFilters] = useState<GraphFilters>({});
  const selection = useEntitySelection(w?.id);
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
  const [aboutOpen, setAboutOpen] = useState<false | 'guide' | 'about' | 'connection'>(false);
  const [connectionCheck, setConnectionCheck] = useState(0);
  const { networks, statuses, discoveryError } = useBackendNetworks(connectionCheck);
  const displayNetwork = w?.network ?? networks?.[0];
  const status = displayNetwork ? statuses[displayNetwork] : undefined;
  const unsupportedNetwork =
    !!w && !w.demo && !!networks && !networks.includes(w.network) && !discoveryError;
  const statusError =
    discoveryError ||
    (unsupportedNetwork ? `Backend does not support ${w!.network}.` : (status?.error ?? ''));
  const [deleteEntry, setDeleteEntry] = useState<SavedWorkspace>();
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
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Only the reset signal stays lifted; the lookup text itself lives in
  // LookupForm so typing does not re-render the whole workbench.
  const [queryReset, setQueryReset] = useState(0);
  const clearQuery = () => setQueryReset((token) => token + 1);
  const [queryError, setQueryError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeSequence, setNoticeSequence] = useState(0);
  useEffect(() => {
    if (!notice || /partial|incomplete|cancelled|could not/i.test(notice)) return;
    const timer = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [notice, noticeSequence]);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState('');
  const [addressHistoryLoads, setAddressHistoryLoads] = useState<
    Record<string, AddressHistoryLoadState>
  >({});
  const [fitToken, setFitToken] = useState(0);
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
  const scanTargetPreview = useMemo(() => {
    if (!w || !scanTargetDraft || scanTargetDraft.workspaceId !== w.id) return {};
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
  }, [scanTargetDraft, w?.id]);
  const [live, setLive] = useState(false);
  const [pendingGraphWorkspace, setPendingGraphWorkspace] = useState<string>();
  const [scanLimit, setScanLimit] = useState(200);
  const [gap, setGap] = useState(20);
  const spendingOffsets = useRef(
    new Map<string, { offset: number; unavailableTxids?: string[] }>(),
  );
  const operationRef = useRef<AbortController | undefined>(undefined);
  const pendingSelectionRef = useRef<string | undefined>(undefined);
  const addressHistoryLoadRefs = useRef(
    new Map<string, { workspaceId: string; controller: AbortController }>(),
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const labelsInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const workspaceTabs = useRef<HTMLElement>(null);
  useEffect(() => {
    const tabs = workspaceTabs.current;
    const active = tabs?.querySelector<HTMLElement>('.active');
    if (!tabs || !active) return;
    const reveal = () => {
      const bounds = tabs.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left) tabs.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right) tabs.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [w?.id, ws.sessions.length]);
  const wRef = useRef(w);
  // Latest-workspace ref for callbacks (guards of the form "is this still the
  // same workspace?"). Published from a layout effect rather than during render:
  // mutating a ref during render is unsafe under concurrent rendering because
  // React may discard the render, and it also made React Compiler skip this
  // component. useLayoutEffect (not useEffect) keeps the value fresh before
  // paint, so event handlers observe the same value they did before. Declared
  // ahead of every other effect that reads it.
  useLayoutEffect(() => {
    wRef.current = w;
  });
  useEffect(() => {
    const workspaceId = w?.id;
    const jobs = addressHistoryLoadRefs.current;
    return () => {
      for (const [key, job] of jobs) {
        if (job.workspaceId !== workspaceId) continue;
        job.controller.abort();
        jobs.delete(key);
      }
    };
  }, [w?.id]);
  const graphFlush = useRef<{ workspaceId: string; flush: () => void } | undefined>(undefined);
  const flushActiveGraph = useCallback(() => {
    const id = wRef.current?.id;
    if (id && graphFlush.current?.workspaceId === id) graphFlush.current.flush();
    return id;
  }, []);
  const saveBeforeLeaving = () => {
    const id = flushActiveGraph();
    return id ? ws.persist(id) : Promise.resolve();
  };
  const activateWorkspace = (id?: string) => {
    if (id !== wRef.current?.id) void saveBeforeLeaving().catch(() => {});
    ws.setActiveId(id);
  };
  const openWorkspace = (data: Workspace, password: string) => {
    void saveBeforeLeaving().catch(() => {});
    ws.open(data, password);
  };
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const id = flushActiveGraph();
      const session = id ? ws.getSession(id) : undefined;
      if (session && session.revision !== session.savedRevision) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [flushActiveGraph, ws.getSession]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const current = wRef.current;
      if (event.key.toLowerCase() === 's' && current) {
        event.preventDefault();
        flushActiveGraph();
        void ws
          .persist(current.id)
          .catch((error) =>
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
  }, [ws.persist, flushActiveGraph]);
  // Topology and chain indexes do not depend on human labels, icons or bookmarks.
  const completeGraph = useMemo(
    () =>
      w
        ? fullGraphMembershipEvidence({ ...w, annotations: EMPTY_GRAPH_ANNOTATIONS })
        : { nodes: [], links: [] },
    [w?.id, w?.network, w?.transactions, w?.findings, w?.watchedAddresses, w?.addressBalances],
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
    () => flowIndex.resolve(selectedId, w?.view.transactionFlow?.transactionId),
    [flowIndex, selectedId, w?.view.transactionFlow?.transactionId],
  );
  const walletMatches = useMemo(
    () => (w ? buildWalletMatches(w, completeGraph) : new Map()),
    [w?.network, w?.transactions, w?.wallets, completeGraph],
  );
  const tagIndex = useMemo(
    () => (w ? buildTagIndex(w, completeGraph) : new Map<string, WorkspaceTag[]>()),
    [w?.tags, completeGraph],
  );
  const metadataProjection = useMemo(() => new GraphMetadataProjection(), [w?.id]);
  const graphMetadata = useMemo(
    () =>
      metadataProjection.project(
        completeGraph,
        w,
        tagIndex,
        walletMatches,
        appliedGraphRequest.highlightMode,
      ),
    [
      metadataProjection,
      w?.annotations,
      w?.wallets,
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
  const membershipFilters = (
    source: GraphData,
    sourceMatches: ReadonlyMap<string, { walletIds: string[] }>,
    sourceTags: ReadonlyMap<string, unknown>,
    filters: GraphFilters,
  ): GraphFilters => {
    const includes: (string[] | undefined)[] = [filters.includeIds];
    const excludes: string[] = [];
    includes.push(matchingWalletFilterNodeIds(filters, sourceMatches));
    if (filters.walletMatch === 'matched') includes.push([...sourceMatches.keys()]);
    else if (filters.walletMatch === 'unmatched')
      excludes.push(...sourceMatches.keys());
    if (filters.tagId) {
      const tag = w?.tags?.find((entry) => entry.id === filters.tagId);
      includes.push(tag ? tagNodeIds(tag, source) : []);
    }
    if (filters.tagState === 'tagged') includes.push([...sourceTags.keys()]);
    else if (filters.tagState === 'untagged') excludes.push(...sourceTags.keys());
    const includeIds = intersectIds(includes);
    return includeIds || excludes.length
      ? { ...filters, includeIds, excludeIds: excludes.length ? excludes : undefined }
      : filters;
  };
  const effectiveFilters = useMemo(
    () => membershipFilters(completeGraph, walletMatches, tagIndex, appliedGraphFilters),
    [appliedGraphFilters, w?.tags, completeGraph, walletMatches, tagIndex],
  );
  const entityFilterRequest = entityFiltersLinked ? appliedGraphFilters : entityPanelFilters;
  const effectiveEntityFilters = useMemo(
    () => membershipFilters(completeGraph, walletMatches, tagIndex, entityFilterRequest),
    [entityFilterRequest, w?.tags, completeGraph, walletMatches, tagIndex],
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
  const amountSelectionId = appliedGraphRequest.smallAmountThreshold ? selectedId : undefined;
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
      ? omitAmountOrphans(canvasFilterResult, selectedId)
      : canvasFilterResult;
  }, [canvasFilterResult, effectiveFilters, appliedGraphRequest.smallAmountThreshold, selectedId]);
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
      if (entityVisibility === 'graph') return { ...visibleGraph, matchedNodes: visibleGraph.nodes };
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
    w?.wallets,
    w?.tags,
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
    const removed = selection.ids.filter((id) => !available.has(id));
    if (removed.length) selection.remove(removed);
    if (selectedId && !available.has(selectedId)) {
      if (pendingSelectionRef.current !== selectedId) setSelectedId(undefined);
    } else if (pendingSelectionRef.current === selectedId) {
      pendingSelectionRef.current = undefined;
    }
  }, [recoveryNodesById, selectedId]);
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
  const addressHistoryNetwork = w?.network;
  const addressHistoryTransactions = w?.transactions;
  const addressHistoryWallets = w?.wallets;
  const addressHistoryObservations = w?.addressHistories;
  const addressHistoryGraphNodeIds = w?.view.graphNodeIds;
  const addressHistoryHiddenNodeIds = w?.view.hiddenNodeIds;
  const addressHistorySelectedAddress =
    w && selected?.kind === 'address' && selected.address
      ? selectedAddressForHistory(selected, w.network)
      : undefined;
  const hasAddressHistorySelection = addressHistorySelectedAddress !== undefined;
  const addressHistoryIndex = useMemo(
    () => {
      if (!hasAddressHistorySelection || !addressHistoryNetwork || !addressHistoryTransactions)
        return undefined;
      return indexAddressHistoryTransactions({
        network: addressHistoryNetwork,
        transactions: addressHistoryTransactions,
      });
    },
    [addressHistoryNetwork, addressHistoryTransactions, hasAddressHistorySelection],
  );
  const addressHistory = useMemo(() => {
    if (
      !addressHistoryNetwork ||
      !addressHistoryTransactions ||
      !addressHistoryIndex ||
      !addressHistorySelectedAddress
    )
      return undefined;
    return projectAddressHistory(
      {
        network: addressHistoryNetwork,
        transactions: addressHistoryTransactions,
        wallets: addressHistoryWallets ?? [],
        addressHistories: addressHistoryObservations,
        view: {
          graphNodeIds: addressHistoryGraphNodeIds,
          hiddenNodeIds: addressHistoryHiddenNodeIds,
        },
      },
      addressHistorySelectedAddress,
      addressHistoryIndex,
    );
  }, [
    addressHistoryIndex,
    addressHistoryNetwork,
    addressHistoryTransactions,
    addressHistoryWallets,
    addressHistoryObservations,
    addressHistoryGraphNodeIds,
    addressHistoryHiddenNodeIds,
    addressHistorySelectedAddress,
  ]);
  const addressBalance =
    w && selected?.kind === 'address' && selected.address
      ? w.addressBalances?.[selected.address]
      : undefined;
  const addressUtxos =
    w && selected?.kind === 'address' && selected.address
      ? w.addressUtxos?.[selected.address]
      : undefined;
  const addressHistoryLoad =
    w && selected?.kind === 'address' && selected.address
      ? addressHistoryLoads[addressHistoryLoadKey(w.id, w.network, selected.address)]
      : undefined;
  const backgroundAddressHistoryLoad = w
    ? Object.values(addressHistoryLoads).find((load) => load.workspaceId === w.id && !load.error)
    : undefined;
  useLayoutEffect(() => {
    if (inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [w?.id, rightTab]);
  useLayoutEffect(() => {
    // Scan results stay in place while their paths change the graph selection.
    if (rightTab !== 'scan' && inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [selectedId, selectedWallet, rightTab]);
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
      const active = ws.getSession(wRef.current?.id ?? '')?.data;
      // A click admits exactly one entity, never its transaction's other branches.
      if (active) ws.update(active.id, (current) => addGraphNodes(current, [id]), false);
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
    [ws.update, ws.getSession, pickingScanTargets, toggleScanTarget],
  );
  useEffect(() => {
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
  }, [w?.id]);
  useEffect(() => {
    if (!w) return;
    try {
      if (!localStorage.getItem('chaingraph.tour.seen')) {
        setTour(WORKBENCH_TOUR[0].id);
        localStorage.setItem('chaingraph.tour.seen', '1');
      }
    } catch {
      // A denied/full store must not crash an unlocked workspace or block export.
      setTour(WORKBENCH_TOUR[0].id);
    }
  }, [w?.id]);
  const change = useCallback(
    (fn: (data: Workspace) => Workspace, undo = true, group?: string, description?: string) => {
      if (w) ws.update(w.id, fn, undo, group, description);
    },
    [w, ws.update],
  );
  const changeGraphView = (update: (view: Workspace['view']) => Workspace['view']) =>
    change((current) => {
      const view = update(current.view);
      return view === current.view ? current : { ...current, view };
    }, false);
  // Hydration has its own owner so a workspace switch never writes the previous view
  // into the newly active workspace. Presentation does not consume annotation undo.
  useEffect(() => {
    if (!w || viewOwner !== w.id) return;
    const presentation = {
      selectionId: selectedId,
      selectedWallet,
      filters: valueFilterError(graphFilters) ? (w.view.filters ?? {}) : graphFilters,
      leftTab,
      rightTab,
      workbench,
      mobilePanel,
      focusGraph,
      prefetchDepth,
    };
    ws.update(
      w.id,
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
    w?.id,
    viewOwner,
    selectedId,
    selectedWallet,
    graphFilters,
    leftTab,
    rightTab,
    workbench,
    mobilePanel,
    focusGraph,
    prefetchDepth,
  ]);
  const setEntityHidden = (ids: string[], hidden: boolean) => {
    try {
      if (hidden) selectionGeneration.current++;
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
    selectionGeneration.current++;
    setFocusRequest(undefined);
    change((current) => removeGraphNodes(current, ids));
  };
  const showAllHidden = () => change(showAllNodes);
  const removalPlan = useMemo(
    () =>
      w && entityRemoval?.workspaceId === w.id
        ? planEntityRemoval(w, entityRemoval.nodeId)
        : undefined,
    [
      w?.id,
      w?.transactions,
      w?.annotations,
      w?.tags,
      w?.watchedAddresses,
      entityRemoval?.workspaceId,
      entityRemoval?.nodeId,
    ],
  );
  const selectedRemovalPlan = useMemo(
    () => (w && selectedId ? planEntityRemoval(w, selectedId) : undefined),
    [w?.id, w?.transactions, w?.annotations, w?.tags, w?.watchedAddresses, selectedId],
  );
  useEffect(() => {
    if (entityRemoval && !removalPlan) setEntityRemoval(undefined);
  }, [entityRemoval, Boolean(removalPlan)]);
  const removableNodeIds = useMemo(
    () =>
      w
        ? [...Object.keys(w.transactions).map(txNodeId), ...w.watchedAddresses.map(addressNodeId)]
        : [],
    [w?.transactions, w?.watchedAddresses],
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
  const connected = !!status?.connected && !statusError;
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
    () => resolveWalletUtxoObservation(w, evidenceWallet, walletUtxos.utxos, selectedId),
    [w?.id, w?.network, w?.transactions, evidenceWallet, walletUtxos.utxos, selectedId],
  );
  const getTransaction = async (
    id: string,
    signal?: AbortSignal,
    priority: 'navigation' | 'background' = 'navigation',
  ) => {
    signal?.throwIfAborted();
    if (!w) throw new Error('Open a workspace first.');
    if (w.demo) throw new Error('Live lookups are disabled for legacy synthetic workspaces.');
    return (
      w.transactions[id] ??
      fetchTransaction(w.network, id, signal, undefined, {
        scope: fetchScope,
        priority,
      })
    );
  };
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
  const editNode = (id: string, target: 'label' | 'tags' | 'icon' = 'label') => {
    setEditTarget(target);
    setNotice('');
    setScanTargetDraft(undefined);
    select(id, { pickTarget: false });
    setFocusGraph(false);
    setRightTab('inspect');
    setMobilePanel('right');
    setEditToken((token) => token + 1);
  };
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operationRef.current) return;
    const controller = new AbortController();
    const workspaceId = wRef.current?.id;
    operationRef.current = controller;
    setOperation('Working…');
    setError('');
    setNotice('');
    try {
      await task(controller.signal);
    } catch (e) {
      if (wRef.current?.id !== workspaceId || operationRef.current !== controller) return;
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Operation failed.');
      else setNotice('Operation cancelled. Completed data from earlier actions is preserved.');
    } finally {
      if (operationRef.current === controller) {
        operationRef.current = undefined;
        setOperation('');
      }
    }
  };
  const mergeTransactions = (
    id: string,
    transactions: Transaction[],
    promotionIds = transactions.map((transaction) => transaction.txid),
    contextIds?: string[],
    requiredSourceId?: string,
  ) => {
    if (!transactions.length && !promotionIds.length) {
      const current = ws.getSession(id)?.data;
      return !!current && (!requiredSourceId || traceSourceExists(current, requiredSourceId));
    }
    let accepted = false;
    ws.update(
      id,
      (current) => {
        if (requiredSourceId && !traceSourceExists(current, requiredSourceId)) return current;
        accepted = true;
        const initialized = ensureGraphMembership(current);
        const promoted = contextIds
          ? promoteInputContext(initialized, promotionIds)
          : clearContextProvenance(initialized, promotionIds);
        const merged = !transactions.length
          ? promoted
          : {
              ...promoted,
              transactions: {
                ...current.transactions,
                ...Object.fromEntries(
                  transactions.map((transaction) => [
                    transaction.txid,
                    mergeTransactionObservations(
                      current.transactions[transaction.txid],
                      transaction,
                      current.network,
                    ),
                  ]),
                ),
              },
            };
        return contextIds ? markContextTransactions(merged, contextIds) : merged;
      },
      false,
    );
    return accepted;
  };
  function selectWalletRecord(
    nodeId: string,
    utxo?: WalletUtxoRecord,
    options: {
      tab?: NonNullable<Workspace['view']['rightTab']>;
      center?: boolean;
      isolate?: boolean;
      selectionIds?: readonly string[];
    } = {},
  ) {
    if (!w || !wallet) return;
    const ownerId = w.id;
    const walletId = wallet.id;
    const tab = options.tab ?? shownRightTab;
    const center = options.center ?? true;
    const ids = [...new Set(options.selectionIds ?? [nodeId])];
    const idSet = new Set(ids);
    const addresses = ids.filter((id) => id.startsWith('addr:')).map((id) => id.slice(5));
    if (addresses.length) {
      const relationships = listWalletRelationships(w, wallet);
      const known = new Set([
        ...verifiedWalletAddresses(wallet, w.network).map((entry) => entry.address),
        ...relationships.sources.flatMap((entry) => (entry.address ? [entry.address] : [])),
        ...relationships.destinations.flatMap((entry) => (entry.address ? [entry.address] : [])),
      ]);
      if (addresses.some((address) => !known.has(address))) {
        setNotice('An address is no longer in this wallet view.');
        return;
      }
    }
    const reveal = (current: Workspace): Workspace => {
      const admitted = addGraphNodes(current, ids);
      return {
        ...admitted,
        watchedAddresses: addresses.length
          ? [...new Set([...current.watchedAddresses, ...addresses])]
          : current.watchedAddresses,
        view: {
          ...admitted.view,
          hiddenNodeIds: current.view.hiddenNodeIds?.filter((id) => !idSet.has(id)),
          showAddresses: addresses.length > 0 || current.view.showAddresses,
          smallAmountThreshold: center ? undefined : current.view.smallAmountThreshold,
        },
      };
    };
    const finish = () => {
      select(nodeId, { preserveCamera: options.isolate });
      setRightTab(tab);
      if (options.selectionIds) {
        selection.replace(ids.length > 1 ? ids : []);
        selection.setMode(ids.length > 1);
      }
      if (options.isolate) {
        prepareIsolation(ids);
        updateFilters(
          ids.length === 1
            ? { focus: { id: nodeId, hops: 1 } }
            : { includeIds: ids, preserveContext: true },
        );
      } else setGraphFilters({});
      if (center && !options.isolate) setFocusRequest({ id: nodeId, token: Date.now() });
    };
    if (nodeId.startsWith('addr:')) {
      ws.update(ownerId, reveal, false);
      finish();
      return;
    }
    const transactionId = nodeId.split(':')[1];
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const cachedTransaction = ws.getSession(ownerId)?.data.transactions[transactionId];
      const transaction =
        cachedTransaction ??
        (await fetchTransaction(w.network, transactionId, signal, undefined, {
          scope: fetchScope,
          priority: 'navigation',
        }));
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation) return;
      const current = ws.getSession(ownerId)?.data;
      if (
        !current ||
        !current.wallets.some((item) => item.id === walletId) ||
        wRef.current?.id !== ownerId
      )
        return;
      if (utxo && !verifyWalletUtxo(utxo, transaction, w.network))
        throw new Error(
          'The UTXO response does not match its transaction. Refresh the wallet UTXOs and retry.',
        );
      // Cached navigation promotes graph context without replacing chain evidence.
      // A new transaction still takes the normal history/findings invalidation path.
      mergeTransactions(ownerId, cachedTransaction ? [] : [transaction], [transactionId]);
      ws.update(ownerId, reveal, false);
      finish();
    });
  }

  /** Wallet review keeps its context: Graph and Analysis both offer a way back. */
  function openWalletRecord(
    nodeId: string,
    utxo?: WalletUtxoRecord,
    mode: 'graph' | 'inspect' | 'isolate' = 'graph',
    selectionIds?: readonly string[],
  ) {
    recordHandoffInvoker('wallet');
    setReturnWorkbench('wallet');
    switchWorkbench('graph', true, mode === 'inspect' ? 'inspector' : undefined);
    setMobilePanel(mode === 'inspect' ? 'right' : 'graph');
    selectWalletRecord(nodeId, utxo, {
      tab: 'inspect',
      center: mode !== 'inspect',
      isolate: mode === 'isolate',
      selectionIds: selectionIds ?? [nodeId],
    });
  }
  function analyzeFromWallet(nodeId?: string) {
    recordHandoffInvoker('wallet');
    setReturnWorkbench('wallet');
    const node = nodeId ? recoveryGraph.nodes.find((item) => item.id === nodeId) : undefined;
    if (node) select(node.id);
    else {
      setSelectedId(undefined);
      if (nodeId)
        setNotice(
          'This record is not loaded yet, so the scan uses the selected wallet. Open it in Graph to scan it directly.',
        );
    }
    switchWorkbench('analysis', true);
  }
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
    setFocusRequest({ id, token: Date.now() });
  }
  const startAddressHistoryLoad = useCallback((address: string, force = false) => {
    const current = wRef.current;
    if (!current || !canQuery) return;
    const ownerId = current.id;
    const key = addressHistoryLoadKey(ownerId, current.network, address);
    if (addressHistoryLoadRefs.current.has(key)) return;
    const currentHistory = listAddressHistory(current, address);
    const needsHistory =
      force ||
      shouldLoadAddressHistory(currentHistory) ||
      !currentHistory?.complete;
    const needsBalance = force || !current.addressBalances?.[address];
    if (!needsHistory && !needsBalance) return;

    const controller = new AbortController();
    addressHistoryLoadRefs.current.set(key, { workspaceId: ownerId, controller });
    setAddressHistoryLoads((loads) => ({
      ...loads,
      [key]: {
        workspaceId: ownerId,
        address,
        phase: needsHistory ? 'history' : 'balance',
        done: 0,
        total: 0,
      },
    }));

    const updateProgress = (update: Partial<AddressHistoryLoadState>) => {
      setAddressHistoryLoads((loads) => {
        const previous = loads[key];
        return previous ? { ...loads, [key]: { ...previous, ...update } } : loads;
      });
    };
    const persistHistory: NonNullable<AddressHistoryLoadCallbacks['onHistory']> = (
      history,
      detailTotal,
      truncated,
    ) => {
      if (wRef.current?.id !== ownerId) return;
      updateWorkspace(
        ownerId,
        (latest) => ({
          ...latest,
          addressHistories: {
            ...latest.addressHistories,
            [address]: {
              history,
              truncated,
              scannedAt: new Date().toISOString(),
            },
          },
        }),
        false,
      );
      updateProgress({ phase: 'details', done: 0, total: detailTotal });
    };
    let pendingTransactions: Transaction[] = [];
    let transactionFlushTimer: ReturnType<typeof setTimeout> | undefined;
    const flushTransactions = () => {
      if (transactionFlushTimer) {
        clearTimeout(transactionFlushTimer);
        transactionFlushTimer = undefined;
      }
      const batch = pendingTransactions;
      pendingTransactions = [];
      if (!batch.length || wRef.current?.id !== ownerId) return;
      updateWorkspace(
        ownerId,
        (latest) => ({
          ...clearContextProvenance(
            latest,
            batch.map((transaction) => transaction.txid),
          ),
          transactions: {
            ...latest.transactions,
            ...Object.fromEntries(
              batch.map((transaction) => [
                transaction.txid,
                mergeTransactionObservations(
                  latest.transactions[transaction.txid],
                  transaction,
                  latest.network,
                ),
              ]),
            ),
          },
        }),
        false,
      );
    };
    const persistTransaction = (transaction: Transaction) => {
      pendingTransactions.push(transaction);
      if (!transactionFlushTimer) transactionFlushTimer = setTimeout(flushTransactions, 16);
    };

    let failed = false;
    void (async () => {
      let historyError: unknown;
      let balanceFailed = false;
      const balancePromise = needsBalance
        ? fetchAddressBalance(current.network, address, controller.signal).catch(() => {
            controller.signal.throwIfAborted();
            balanceFailed = true;
            return undefined;
          })
        : Promise.resolve(undefined);
      let result: Awaited<ReturnType<typeof loadAddress>> | undefined;
      try {
        if (needsHistory) {
          try {
            result = await loadAddress(
              address,
              current.network,
              current.transactions,
              controller.signal,
              (progress) =>
                updateProgress({
                  phase: 'details',
                  done: progress.done,
                  total: progress.total ?? 0,
                }),
              { scope: fetchScope },
              { onHistory: persistHistory, onTransaction: persistTransaction },
            );
          } catch (error) {
            controller.signal.throwIfAborted();
            historyError = error;
          }
        }
        flushTransactions();
        controller.signal.throwIfAborted();
        if (result && wRef.current?.id === ownerId)
          updateWorkspace(
            ownerId,
            (latest) => clearContextProvenance(latest, result!.observedTransactionIds),
            false,
          );
        if (needsBalance) updateProgress({ phase: 'balance' });
        const balance = await balancePromise;
        controller.signal.throwIfAborted();
        if (balance && wRef.current?.id === ownerId)
          updateWorkspace(
            ownerId,
            (latest) => ({
              ...latest,
              addressBalances: { ...latest.addressBalances, [address]: balance },
            }),
            false,
          );
        if (historyError) throw historyError;
        if (balanceFailed)
          setNotice(
            result
              ? 'Address history loaded, but the address balance could not be checked. Retry.'
              : 'Address balance could not be checked. Retry.',
          );
        if (result?.truncated)
          setNotice(
            balanceFailed
              ? 'Address history is partial and the balance could not be checked. Retry.'
              : 'Address history is partial: some transaction details are not loaded. Select a row to load one.',
          );
      } catch {
        if (controller.signal.aborted) return;
        failed = true;
        setAddressHistoryLoads((loads) => ({
          ...loads,
          [key]: {
            ...loads[key],
            phase: 'history',
            error: 'Address history could not be loaded. Retry.',
          },
        }));
        setNotice('Address history could not be loaded. Retry.');
      }
    })().finally(() => {
      if (transactionFlushTimer) clearTimeout(transactionFlushTimer);
      flushTransactions();
      addressHistoryLoadRefs.current.delete(key);
      if (!failed)
        setAddressHistoryLoads((loads) => {
          if (!loads[key]) return loads;
          const next = { ...loads };
          delete next[key];
          return next;
        });
    });
  }, [canQuery, fetchScope, updateWorkspace]);
  const autoLoadAddress =
    w && selected?.kind === 'address' && selected.address
      ? selectedAddressForHistory(selected, w.network)
      : undefined;
  useEffect(() => {
    if (!w?.id || !canQuery || !autoLoadAddress) return;
    const current = getWorkspaceSession(w.id)?.data;
    if (!current || !shouldLoadAddressHistory(listAddressHistory(current, autoLoadAddress))) return;
    // Selection is the stable trigger. Do not depend on the observation itself:
    // an empty successful result must not start an endless refresh loop.
    startAddressHistoryLoad(autoLoadAddress);
  }, [autoLoadAddress, canQuery, getWorkspaceSession, startAddressHistoryLoad, w?.id]);
  function openAddressHistory(force = false) {
    if (!w || !selected) return;
    const address = selectedAddressForHistory(selected, w.network);
    if (!address) return;
    const current = ws.getSession(w.id)?.data;
    if (!current) return;
    revealLookup(addressNodeId(address));
    if (!canQuery) {
      if (listAddressHistory(current, address)?.source === 'loaded transactions')
        setNotice('Showing transactions mentioning this address in the loaded workspace data.');
      return;
    }
    startAddressHistoryLoad(address, force);
  }
  function refreshAddressBalance() {
    if (!w || !selected) return;
    const address = selectedAddressForHistory(selected, w.network);
    if (!address || !canQuery) return;
    const ownerId = w.id;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      setOperation('Checking address balance…');
      const observation = await fetchAddressBalance(w.network, address, signal);
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || wRef.current?.id !== ownerId) return;
      ws.update(
        ownerId,
        (latest) => ({
          ...latest,
          addressBalances: {
            ...latest.addressBalances,
            [address]: observation,
          },
        }),
        false,
      );
    });
  }
  function loadAddressUtxos(force = false) {
    if (!w || !selected) return;
    const address = selectedAddressForHistory(selected, w.network);
    if (!address) return;
    const ownerId = w.id;
    const current = ws.getSession(ownerId)?.data;
    if (!current) return;
    if (!force && current.addressUtxos?.[address]) return;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      setOperation('Loading address UTXOs…');
      const utxos = await fetchAddressUtxos(current.network, address, signal);
      let balance: Awaited<ReturnType<typeof fetchAddressBalance>> | undefined;
      let balanceFailed = false;
      if (force || !current.addressBalances?.[address]) {
        try {
          balance = await fetchAddressBalance(current.network, address, signal);
        } catch {
          signal.throwIfAborted();
          balanceFailed = true;
        }
      }
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || wRef.current?.id !== ownerId) return;
      ws.update(
        ownerId,
        (latest) => ({
          ...latest,
          addressUtxos: {
            ...latest.addressUtxos,
            [address]: utxos,
          },
          ...(balance
            ? {
                addressBalances: {
                  ...latest.addressBalances,
                  [address]: balance,
                },
              }
            : {}),
        }),
        false,
      );
      if (balanceFailed) setNotice('UTXOs loaded. Address balance could not be checked. Retry.');

      const latestTransactions = (ws.getSession(ownerId)?.data ?? current).transactions;
      const detailTargets = [
        ...new Map(
          utxos.utxos
            .filter((utxo) => utxo.height > 0 && !latestTransactions[utxo.txid])
            .map((utxo) => [utxo.txid, utxo] as const),
        ).values(),
      ];
      const boundedDetailTargets = detailTargets.slice(0, MAX_SCAN_TRANSACTIONS);
      if (!boundedDetailTargets.length) return;
      setOperation(
        `Loading UTXO timestamps 0/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
      );
      let loaded = 0;
      const details = await mapLimit(
        boundedDetailTargets,
        4,
        async (utxo): Promise<Transaction | undefined> => {
          try {
            const transaction = await fetchTransaction(
              current.network,
              utxo.txid,
              signal,
              undefined,
              {
                scope: fetchScope,
                priority: 'background',
              },
            );
            if (transaction.confirmations !== undefined && transaction.confirmations < 0)
              return undefined;
            const conflictingHeight =
              transaction.blockHeight !== undefined && transaction.blockHeight !== utxo.height;
            const observed = conflictingHeight
              ? {
                  ...transaction,
                  blockHeight: utxo.height,
                  blockhash: undefined,
                  blocktime: undefined,
                  time: undefined,
                  confirmations: undefined,
                  mempool: undefined,
                }
              : {
                  ...transaction,
                  blockHeight: utxo.height,
                  confirmations:
                    transaction.confirmations !== undefined && transaction.confirmations > 0
                      ? transaction.confirmations
                      : undefined,
                  mempool: undefined,
                };
            setOperation(
              `Loading UTXO timestamps ${++loaded}/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
            );
            return observed;
          } catch {
            signal.throwIfAborted();
            setOperation(
              `Loading UTXO timestamps ${++loaded}/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
            );
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      const loadedDetails = details.filter(
        (transaction): transaction is Transaction => !!transaction,
      );
      if (loadedDetails.length) mergeTransactions(ownerId, loadedDetails);
    });
  }
  function selectedAddressGraphAction() {
    if (!w || selected?.kind !== 'address' || !selected.address) return undefined;
    const address = selectedAddressForHistory(selected, w.network);
    return address
      ? { address, generation: selectionGeneration.current, ownerId: w.id }
      : undefined;
  }
  function revealAddressGraphNodes(ownerId: string, ids: string[]) {
    if (!ids.length) return;
    updateWorkspace(
      ownerId,
      (current) => {
        const revealed = addGraphNodes(current, ids);
        return {
          ...revealed,
          view: { ...revealed.view, smallAmountThreshold: undefined },
        };
      },
      false,
    );
    setGraphFilters({});
  }
  function showRecentAddressUtxos() {
    const action = selectedAddressGraphAction();
    if (!action) return;
    const current = getWorkspaceSession(action.ownerId)?.data;
    if (!current) return;
    const cached = current.addressUtxos?.[action.address];
    if (!cached && !canQuery) return;
    void run(async (signal) => {
      setOperation('Loading recent UTXOs…');
      const observation =
        cached ?? (await fetchAddressUtxos(current.network, action.address, signal));
      signal.throwIfAborted();
      if (selectionGeneration.current !== action.generation || wRef.current?.id !== action.ownerId)
        return;
      if (!cached)
        updateWorkspace(
          action.ownerId,
          (latest) => ({
            ...latest,
            addressUtxos: {
              ...latest.addressUtxos,
              [action.address]: observation,
            },
          }),
          false,
        );
      const recent = recentAddressUtxos(observation, RECENT_ADDRESS_GRAPH_LIMIT);
      if (!recent.length) {
        setNotice('No unspent outputs observed for this address.');
        return;
      }
      const latestTransactions = (getWorkspaceSession(action.ownerId)?.data ?? current)
        .transactions;
      const detailTargets = [
        ...new Map(
          recent
            .filter((utxo) => !latestTransactions[utxo.txid])
            .map((utxo) => [utxo.txid, utxo] as const),
        ).values(),
      ];
      const details = await mapLimit(
        canQuery ? detailTargets : [],
        4,
        async (utxo): Promise<Transaction | undefined> => {
          try {
            const transaction = await fetchTransaction(
              current.network,
              utxo.txid,
              signal,
              utxo.height,
              { scope: fetchScope, priority: 'visible' },
            );
            return transaction.confirmations !== undefined && transaction.confirmations < 0
              ? undefined
              : withHistoryHeight(transaction, utxo.height);
          } catch {
            signal.throwIfAborted();
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      if (selectionGeneration.current !== action.generation || wRef.current?.id !== action.ownerId)
        return;
      mergeTransactions(
        action.ownerId,
        details.filter((transaction): transaction is Transaction => !!transaction),
        [...new Set(recent.map((utxo) => utxo.txid))],
      );
      const latest = getWorkspaceSession(action.ownerId)?.data;
      if (!latest) return;
      const outpointIds = recent.flatMap((utxo) => {
        const transaction = latest.transactions[utxo.txid];
        return transaction?.vout.some((output) => output.n === utxo.vout)
          ? [outputNodeId(utxo.txid, utxo.vout)]
          : [];
      });
      revealAddressGraphNodes(action.ownerId, outpointIds);
    });
  }
  function showRecentAddressTransactions() {
    const action = selectedAddressGraphAction();
    if (!action) return;
    const current = getWorkspaceSession(action.ownerId)?.data;
    if (!current) return;
    const historyKey = addressHistoryLoadKey(action.ownerId, current.network, action.address);
    void run(async (signal) => {
      let latest = getWorkspaceSession(action.ownerId)?.data ?? current;
      let history = listAddressHistory(latest, action.address);
      let historyLoadActive = addressHistoryLoadRefs.current.has(historyKey);
      const needsObservedHistory =
        !history || history.source === 'loaded transactions' || history.entries.length === 0;
      if (needsObservedHistory && !historyLoadActive && canQuery) {
        setOperation('Loading recent transactions…');
        const observedHistory = await fetchHistory(
          latest.network,
          addressToScriptHash(action.address, latest.network),
          signal,
        );
        signal.throwIfAborted();
        if (
          selectionGeneration.current !== action.generation ||
          wRef.current?.id !== action.ownerId
        )
          return;
        updateWorkspace(
          action.ownerId,
          (workspace) => ({
            ...workspace,
            addressHistories: {
              ...workspace.addressHistories,
              [action.address]: {
                history: observedHistory,
                truncated: false,
                scannedAt: new Date().toISOString(),
              },
            },
          }),
          false,
        );
        latest = getWorkspaceSession(action.ownerId)?.data ?? latest;
        history = listAddressHistory(latest, action.address);
        historyLoadActive = addressHistoryLoadRefs.current.has(historyKey);
      }
      const recent = recentAddressHistoryEntries(history, RECENT_ADDRESS_GRAPH_LIMIT);
      if (!recent.length) {
        setNotice(
          historyLoadActive
            ? 'Address history is still loading. Try again when recent transactions are available.'
            : 'No observed transactions for this address.',
        );
        return;
      }
      const latestTransactions = latest.transactions;
      const detailTargets = recent.filter((entry) => !latestTransactions[entry.txid]);
      const details = await mapLimit(
        canQuery ? detailTargets : [],
        4,
        async (entry): Promise<Transaction | undefined> => {
          try {
            return await fetchTransaction(latest.network, entry.txid, signal, entry.height, {
              scope: fetchScope,
              priority: 'visible',
            });
          } catch {
            signal.throwIfAborted();
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      if (selectionGeneration.current !== action.generation || wRef.current?.id !== action.ownerId)
        return;
      mergeTransactions(
        action.ownerId,
        details.filter((transaction): transaction is Transaction => !!transaction),
        [...new Set(recent.map((entry) => entry.txid))],
      );
      revealAddressGraphNodes(
        action.ownerId,
        recent.map((entry) => txNodeId(entry.txid)),
      );
    });
  }
  function openAddressHistoryTransaction(txid: string, height?: number, vout?: number) {
    if (!w || !/^[0-9a-f]{64}$/i.test(txid)) return;
    const ownerId = w.id;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const current = ws.getSession(ownerId)?.data;
      if (!current) return;
      const cached = current.transactions[txid];
      setOperation(cached ? 'Opening transaction…' : 'Loading transaction…');
      const transaction =
        cached ??
        (await fetchTransaction(current.network, txid, signal, height, {
          scope: fetchScope,
          priority: 'navigation',
        }));
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || wRef.current?.id !== ownerId) return;
      mergeTransactions(ownerId, cached ? [] : [transaction], [transaction.txid]);
      ws.update(
        ownerId,
        (latest) => {
          const admitted = addGraphNodes(latest, [txNodeId(transaction.txid)]);
          return {
            ...admitted,
            view: {
              ...admitted.view,
              transactionFlow: {
                ...latest.view.transactionFlow,
                transactionId: transaction.txid,
                open: true,
              },
            },
          };
        },
        false,
      );
      const selectedId =
        vout !== undefined && transaction.vout.some((output) => output.n === vout)
          ? outputNodeId(transaction.txid, vout)
          : txNodeId(transaction.txid);
      select(selectedId);
      setFocusRequest({ id: selectedId, token: Date.now() });
    });
  }
  async function addQuery(text: string) {
    if (!w || !text || operationRef.current) return;
    text = text.trim();
    if (/^(bc1|tb1)/i.test(text)) text = text.toLowerCase();
    const existing = loadedLookupId(text);
    if (existing && !existing.startsWith('addr:')) {
      setError('');
      setNotice('');
      mergeTransactions(w.id, [], [existing.split(':')[1]]);
      revealLookup(existing);
      if (!canQuery || !prefetchDepth) {
        clearQuery();
        return;
      }
    }
    if (!/^[0-9a-f]{64}(:\d+)?$/i.test(text)) {
      if (!canQuery && !existing) return;
      setError('');
      setNotice('');
      revealLookup(addressNodeId(text));
      clearQuery();
      startAddressHistoryLoad(text);
      return;
    }
    if (!canQuery) return;
    const generation = selectionGeneration.current;
    await run(async (signal) => {
      if (/^[0-9a-f]{64}(:\d+)?$/i.test(text)) {
        const [id, index] = text.split(':');
        setOperation('Loading transaction…');
        const cached = w.transactions[id.toLowerCase()];
        const t =
          cached ??
          (await fetchTransaction(w.network, id, signal, undefined, {
            scope: fetchScope,
            priority: 'navigation',
          }));
        if (index !== undefined && !t.vout.some((o) => o.n === Number(index)))
          throw new Error('This output index does not exist in the transaction.');
        signal.throwIfAborted();
        if (selectionGeneration.current !== generation || wRef.current?.id !== w.id) return;
        mergeTransactions(w.id, cached ? [] : [t], [t.txid]);
        const requestedId =
          index === undefined ? txNodeId(t.txid) : outputNodeId(t.txid, Number(index));
        revealLookup(requestedId);
        if (prefetchDepth) {
          const before = ws.getSession(w.id)!.data;
          const result = await loadAncestors([t], before.transactions, prefetchDepth, {
            fetch: (id, signal) => getTransaction(id, signal, 'background'),
            signal,
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          if (
            mergeTransactions(
              w.id,
              result.transactions,
              result.resolvedTransactionIds,
              result.transactions.map((tx) => tx.txid),
              txNodeId(t.txid),
            )
          )
            setNotice(ancestryNotice(result));
        }
      }
      clearQuery();
    });
  }
  async function refreshWallets(targets: Wallet[], initial: Workspace, signal: AbortSignal) {
    let snapshot = initial;
    let added = 0;
    let refreshed = 0;
    let partial = false;
    let missing = 0;
    for (const target of targets) {
      setOperation(`${target.scannedAt ? 'Refreshing' : 'Scanning'} ${target.name}…`);
      const result = await scanWallet(target, snapshot.network, snapshot.transactions, {
        gap,
        maxIndex: scanLimit,
        signal,
        fetchHints: { scope: fetchScope },
        onProgress: (p) => setOperation(p.message),
      });
      signal.throwIfAborted();
      ws.update(
        initial.id,
        (current) => applyWalletScan(current, result.wallet, result.transactions),
        false,
      );
      snapshot = applyWalletScan(snapshot, result.wallet, result.transactions);
      added += result.wallet.lastActivity?.newTransactionIds.length ?? 0;
      refreshed += result.wallet.lastActivity?.refreshedTransactionCount ?? 0;
      missing += result.wallet.lastActivity?.missingTransactionCount ?? 0;
      partial = partial || !result.wallet.scanComplete;
    }
    return { snapshot, added, refreshed, partial, missing };
  }
  async function scan(target?: Wallet) {
    if (!w || !canQuery) return;
    await run(async (signal) => {
      const result = await refreshWallets(target ? [target] : w.wallets, w, signal);
      const checkedWallets = result.snapshot.wallets.filter(
        (entry) => !target || entry.id === target.id,
      );
      const pendingTransactions = checkedWallets.reduce(
        (count, entry) => count + (entry.pendingTransactionIds?.length ?? 0),
        0,
      );
      setNotice(
        `${target ? walletActivitySummary(result.snapshot.wallets.find((item) => item.id === target.id)!) : `${result.added} new to workspace · ${result.refreshed} transactions refreshed`}.${pendingTransactions ? ` ${pendingTransactions} transactions waiting; Refresh again to continue.` : result.partial ? ` Address search reached its ${scanLimit}/branch limit. Increase Addresses / branch in Graph wallet controls to search further.` : ''}${result.missing ? ` ${result.missing} previously observed transactions absent from checked histories; saved graph retained.` : ''}`,
      );
      // Only the first discovery frames an empty canvas. Returning checks leave
      // the user's camera, selection, filters and annotations alone.
      if (!Object.keys(w.transactions).length && result.added) setFitToken((token) => token + 1);
    });
  }
  function showWalletActivity(target: Wallet) {
    const ids = new Set(target.unreviewedTransactionIds ?? []);
    const activityNodes = graph.nodes
      .filter((node) => node.kind === 'transaction' && node.txid && ids.has(node.txid))
      .map((node) => node.id);
    revealGraphNodes(activityNodes);
    updateFilters({
      includeIds: activityNodes,
      preserveContext: true,
    });
    setLeftTab('entities');
    setMobilePanel('graph');
    change(
      (current) => ({
        ...current,
        wallets: current.wallets.map((wallet) =>
          wallet.id === target.id
            ? { ...wallet, unreviewedTransactionIds: [], activityOverflow: false }
            : wallet,
        ),
      }),
      false,
    );
  }
  async function expand(
    direction: 'funding' | 'spending',
    nodeId = selectedId,
    options?: { preserveCamera?: boolean },
  ) {
    if (!w) return;
    const snapshot = ws.getSession(w.id)?.data;
    if (!snapshot) return;
    // A flow arrow selects and traces in one event. Read newly exposed input
    // placeholders from the session instead of waiting for the next render.
    const node =
      recoveryGraph.nodes.find((n) => n.id === nodeId) ??
      buildGraph(snapshot).nodes.find((n) => n.id === nodeId);
    if (!node?.txid || node.kind === 'address') return;
    const generation = selectionGeneration.current;
    if (
      !canTrace &&
      !(direction === 'funding' && node.kind === 'output' && snapshot.transactions[node.txid])
    )
      return;
    if (options?.preserveCamera) {
      cameraPreservedSelection.current = selectedId;
      setFocusRequest(undefined);
    }
    await run(async (signal) => {
      setOperation(
        direction === 'funding'
          ? 'Loading previous transactions…'
          : 'Checking outputs for spending transactions…',
      );
      const loaded = snapshot.transactions[node.txid!];
      const traceSourceId = loaded ? txNodeId(node.txid!) : node.id;
      const transaction = loaded ?? (await getTransaction(node.txid!, signal));
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || wRef.current?.id !== w.id) return;
      if (!traceSourceExists(ws.getSession(w.id)!.data, traceSourceId)) return;
      if (direction === 'funding') {
        if (node.kind === 'output') {
          mergeTransactions(w.id, loaded ? [] : [transaction], [transaction.txid]);
          const id = txNodeId(transaction.txid);
          ws.update(
            w.id,
            (current) => ({
              ...setNodesHidden(current, [id], false),
              view: {
                ...current.view,
                hiddenNodeIds: current.view.hiddenNodeIds?.filter((hidden) => hidden !== id),
                transactionFlow: {
                  ...current.view.transactionFlow,
                  transactionId: transaction.txid,
                  open: true,
                },
              },
            }),
            false,
          );
          select(id, options);
          setGraphFilters({});
          if (!options?.preserveCamera) setFocusRequest({ id, token: Date.now() });
        } else if (!loaded) {
          signal.throwIfAborted();
          mergeTransactions(w.id, [transaction]);
        } else {
          const before = ws.getSession(w.id)!.data;
          const result = await loadAncestors([transaction], before.transactions, 1, {
            signal,
            fetch: (id, signal) => getTransaction(id, signal, 'background'),
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          if (selectionGeneration.current !== generation || wRef.current?.id !== w.id) return;
          if (
            mergeTransactions(
              w.id,
              result.transactions,
              result.resolvedTransactionIds,
              result.transactions.map((tx) => tx.txid),
              traceSourceId,
            )
          ) {
            const parents = new Set(result.resolvedTransactionIds);
            ws.update(w.id, (current) =>
              addGraphNodes(current, [
                ...result.resolvedTransactionIds.map(txNodeId),
                ...transaction.vin.flatMap((input) =>
                  input.txid && input.vout !== undefined && parents.has(input.txid)
                    ? [outputNodeId(input.txid, input.vout)]
                    : [],
                ),
              ]),
            );
            setNotice(ancestryNotice(result));
          }
        }
      } else {
        const outputIndex = node.kind === 'output' ? node.vout : undefined;
        const searchKey = `${transaction.txid}:${outputIndex ?? 'all'}`;
        const result = await loadSpending(
          transaction,
          w,
          outputIndex,
          signal,
          spendingOffsets.current.get(searchKey)?.offset ?? 0,
          { scope: fetchScope, priority: 'background' },
          spendingOffsets.current.get(searchKey)?.unavailableTxids,
        );
        signal.throwIfAborted();
        if (selectionGeneration.current !== generation || wRef.current?.id !== w.id) return;
        if (
          !mergeTransactions(
            w.id,
            [...(!loaded ? [transaction] : []), ...result.transactions],
            result.transactions.map((tx) => tx.txid),
            undefined,
            traceSourceId,
          )
        )
          return;
        const spendingNodeIds = result.transactions.map((item) => txNodeId(item.txid));
        const connectingOutputs = result.transactions.flatMap((item) =>
          item.vin.flatMap((input) =>
            input.txid === transaction.txid &&
            input.vout !== undefined &&
            (outputIndex === undefined || input.vout === outputIndex)
              ? [outputNodeId(input.txid, input.vout)]
              : [],
          ),
        );
        ws.update(w.id, (current) => {
          const admitted = addGraphNodes(current, [...spendingNodeIds, ...connectingOutputs]);
          return node.kind === 'output' && result.transactions.length === 1
            ? {
                ...admitted,
                view: {
                  ...admitted.view,
                  transactionFlow: {
                    ...admitted.view.transactionFlow,
                    transactionId: result.transactions[0].txid,
                    open: true,
                  },
                },
              }
            : admitted;
        });
        if ('nextOffset' in result && result.nextOffset !== undefined)
          spendingOffsets.current.set(searchKey, {
            offset: result.nextOffset,
            unavailableTxids: result.unavailableTxids,
          });
        else spendingOffsets.current.delete(searchKey);

        if (selectionGeneration.current !== generation || wRef.current?.id !== w.id) return;
        if (!result.transactions.length && outputIndex !== undefined)
          setOperation('Checking current UTXO status…');
        const notice = await spendingNotice(result, transaction, w.network, outputIndex, signal);
        signal.throwIfAborted();
        const active = ws.getSession(w.id)?.data;
        if (
          notice &&
          active &&
          selectionGeneration.current === generation &&
          wRef.current?.id === w.id &&
          traceSourceExists(active, traceSourceId)
        )
          setNotice(notice);
      }
      // Tracing extends the investigation without taking over its camera.
      // Initial framing, explicit Fit and Lock to selection own camera changes.
    });
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
  // Poll from the client, only while this workspace is unlocked. Backend never owns scan state.
  useEffect(() => {
    if (!live || !canQuery || !w) return;
    let monitorOperation: AbortController | undefined;
    const timer = setInterval(() => {
      if (operationRef.current) return;
      const current = wRef.current;
      if (!current) return;
      void run(async (signal) => {
        monitorOperation = operationRef.current;
        setOperation('Checking watched activity…');
        const checked = await refreshWallets(current.wallets, current, signal);
        let added = checked.added;
        let refreshed = checked.refreshed;
        let partial = checked.partial;
        let snapshot = checked.snapshot;
        const polledTransactions: Transaction[] = [];
        const polledObservedTransactionIds = new Set<string>();
        const refreshedHistories: NonNullable<Workspace['addressHistories']> = {};
        let pollFailed = false;
        let pollFailure: unknown;
        try {
          for (const address of current.watchedAddresses) {
            const result = await loadAddress(
              address,
              current.network,
              snapshot.transactions,
              signal,
              undefined,
              { scope: fetchScope },
            );
            signal.throwIfAborted();
            polledTransactions.push(...result.transactions);
            for (const txid of result.observedTransactionIds)
              polledObservedTransactionIds.add(txid);
            refreshedHistories[address] = {
              history: result.history,
              truncated: result.truncated,
              scannedAt: new Date().toISOString(),
            };
            added += result.transactions.filter((tx) => !snapshot.transactions[tx.txid]).length;
            refreshed += result.transactions.filter(
              (tx) => !!snapshot.transactions[tx.txid],
            ).length;
            snapshot = {
              ...clearContextProvenance(snapshot, result.observedTransactionIds),
              transactions: {
                ...snapshot.transactions,
                ...Object.fromEntries(
                  result.transactions.map((tx) => [
                    tx.txid,
                    mergeTransactionObservations(
                      snapshot.transactions[tx.txid],
                      tx,
                      snapshot.network,
                    ),
                  ]),
                ),
              },
            };
            partial = partial || result.truncated;
          }
        } catch (error) {
          pollFailed = true;
          pollFailure = error;
        }
        // Publish completed work as one immutable snapshot. If polling is cancelled,
        // preserve the addresses already checked before the abort as well.
        if (wRef.current?.id === current.id && wRef.current.network === current.network) {
          mergeTransactions(current.id, polledTransactions, [...polledObservedTransactionIds]);
          if (Object.keys(refreshedHistories).length)
            ws.update(
              current.id,
              (latest) => ({
                ...latest,
                addressHistories: {
                  ...latest.addressHistories,
                  ...refreshedHistories,
                },
              }),
              false,
            );
        }
        if (pollFailed) throw pollFailure;
        setNotice(
          `Activity check finished · ${added} new to workspace · ${refreshed} transactions refreshed.${partial ? ' Some history remains partial; review scan limits.' : ''}${checked.missing ? ' Previously observed transactions disappeared from checked histories; review wallet details.' : ''}`,
        );
      }).finally(() => {
        monitorOperation = undefined;
      });
    }, 30000);
    return () => {
      clearInterval(timer);
      monitorOperation?.abort();
    };
  }, [live, canQuery, w?.id, gap, scanLimit]);
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
  const recentAddressUtxoTargets = useMemo(
    () => recentAddressUtxos(addressUtxos, RECENT_ADDRESS_GRAPH_LIMIT),
    [addressUtxos],
  );
  const recentAddressTransactionTargets = useMemo(
    () => recentAddressHistoryEntries(addressHistory, RECENT_ADDRESS_GRAPH_LIMIT),
    [addressHistory],
  );
  const matchingScope = useMemo(
    () => ({
      label: describeMatchScope(visibleGraph.matchedNodes),
      ids: visibleGraph.matchedNodes.map((node) => node.id),
    }),
    [visibleGraph],
  );
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
  useEffect(() => {
    if (
      !w ||
      viewOwner !== w.id ||
      !w.view.lockToSelection ||
      !selectedId ||
      cameraPreservedSelection.current === selectedId ||
      hiddenIds.has(selectedId)
    )
      return;
    if (!visibleGraph.nodes.some((node) => node.id === selectedId)) {
      setGraphFilters({});
      if (selectedId.startsWith('addr:') && !w.view.showAddresses)
        ws.update(
          w.id,
          (current) => ({ ...current, view: { ...current.view, showAddresses: true } }),
          false,
        );
    }
    setFocusRequest({ id: selectedId, token: Date.now(), preserveZoom: true });
  }, [w?.id, viewOwner, w?.view.lockToSelection, selectedId, hiddenIds]);
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
    cameraPreservedSelection.current = undefined;
    setFocusRequest({ id, token: Date.now() });
  }
  function navigateSelection(delta: number) {
    const index = navigation.index + delta;
    const id = navigation.ids[index];
    if (!id) return;
    selectionGeneration.current++;
    setNavigation({ ...navigation, index });
    cameraPreservedSelection.current = id;
    setFocusRequest(undefined);
    setSelectedId(id);
    setRightTab('inspect');
  }
  function updateFilters(filters: GraphFilters) {
    setFocusRequest(undefined);
    setGraphFilters(filters);
    setFitToken((token) => token + 1);
  }
  function setEntityFilterLink(linked: boolean) {
    setEntityPanelFilters(entityPanelFiltersFromGraph(graphFilters));
    setEntityFiltersLinked(linked);
  }
  function switchWorkbench(next: WorkbenchMode, handoffFocus = false, destination?: 'inspector') {
    pendingWorkbenchFocus.current =
      handoffFocus && w ? { workspaceId: w.id, mode: next, destination } : undefined;
    flushActiveGraph();
    setWorkbench(next);
  }
  function prepareIsolation(ids: string[], preserveFilters = false) {
    cameraPreservedSelection.current = ids[0];
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
  function showFindingOnGraph(ids: string[], isolate = false, supportingTxids: string[] = []) {
    const current = w && ws.getSession(w.id)?.data;
    if (!current) return false;
    const target = resolveGraphHandoff(current, ids, supportingTxids);
    if (!target) return false;
    recordHandoffInvoker('analysis');
    change((latest) => {
      const resolved = resolveGraphHandoff(latest, ids, supportingTxids);
      if (!resolved) return latest;
      const revealed = addGraphNodes(resolved.workspace, [...resolved.ids, resolved.selectedId]);
      return {
        ...revealed,
        view: {
          ...revealed.view,
          smallAmountThreshold: undefined,
          ...(resolved.usedSupportingTransaction
            ? {
                transactionFlow: {
                  ...revealed.view.transactionFlow,
                  open: true,
                  transactionId: resolved.selectedId.slice(3),
                },
              }
            : {}),
        },
      };
    }, false);
    setReturnWorkbench('analysis');
    switchWorkbench('graph', true);
    select(target.selectedId, { preserveCamera: isolate });
    if (target.usedSupportingTransaction)
      setNotice(
        'The requested entity cannot be opened directly. Showing its supporting transaction.',
      );
    updateFilters(isolate ? { includeIds: target.ids, preserveContext: true } : {});
    if (!isolate) setFocusRequest({ id: target.selectedId, token: Date.now() });
    setMobilePanel('graph');
    return true;
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
  const contextTransaction =
    graphFlowContext && w?.transactions[graphFlowContext.transactionId.slice(3)];
  const contextSideIds = useMemo(
    () =>
      contextTransaction
        ? {
            inputs: transactionNodeIds(contextTransaction, 'inputs'),
            outputs: transactionNodeIds(contextTransaction, 'outputs'),
          }
        : undefined,
    [contextTransaction],
  );
  const showAllOutputCount = useMemo(
    () => [...allGraphOutputIds].filter((id) => !canvasIds.has(id)).length,
    [allGraphOutputIds, canvasIds],
  );
  // One pass per side instead of five `.filter().length` scans each. These
  // recompute on every render of a very large component, over the full
  // input/output id lists of the focused transaction.
  const contextSides = useMemo(() => {
    if (!contextSideIds) return undefined;
    const countSide = (ids: readonly string[]): GraphContextSideCounts => {
      let shown = 0;
      let hidden = 0;
      let added = 0;
      let unconnectedShown = 0;
      let unconnectedAdded = 0;
      for (const id of ids) {
        const onCanvas = canvasIds.has(id);
        const admitted = admittedIds.has(id);
        if (onCanvas) shown++;
        if (admitted) {
          added++;
          if (hiddenIds.has(id)) hidden++;
        }
        if (onCanvas && unconnectedForHide.has(id)) unconnectedShown++;
        if (unconnectedForRemoval.has(id)) unconnectedAdded++;
      }
      return { total: ids.length, shown, hidden, added, unconnectedShown, unconnectedAdded };
    };
    return {
      inputs: countSide(contextSideIds.inputs),
      outputs: countSide(contextSideIds.outputs),
    };
  }, [
    contextSideIds,
    canvasIds,
    admittedIds,
    hiddenIds,
    unconnectedForHide,
    unconnectedForRemoval,
  ]);
  const toolbarSelection = selection.ids.length ? selection.ids : selectedId ? [selectedId] : [];
  // Single pass over every graph link, memoized: this ran filter+map across the
  // whole link set on each render, including on every keystroke in the lookup field.
  const selectedSpenders = useMemo(() => {
    if (selected?.kind !== 'output') return [];
    const spenders: string[] = [];
    for (const link of graph.links)
      if (link.kind === 'spends' && link.source === selected.id) spenders.push(link.target);
    return spenders;
  }, [selected?.kind, selected?.id, graph.links]);
  const openSpendingFromToolbar = () => {
    if (!selectedId) return;
    if (selectedSpenders.length === 1) select(selectedSpenders[0], { preserveCamera: true });
    else if (selectedSpenders.length > 1) {
      change(
        (current) => ({
          ...current,
          view: {
            ...current.view,
            transactionFlow: { ...current.view.transactionFlow, open: true },
          },
        }),
        false,
      );
      setNotice('Choose a spending transaction in the transaction flow panel.');
    } else void expand('spending', selectedId, { preserveCamera: true });
  };
  const selectedInputOutputAddress =
    w && selected?.kind === 'output' ? selectedAddressForHistory(selected, w.network) : undefined;
  const selectedAddressForToolbar =
    w && selected?.kind === 'address' ? selectedAddressForHistory(selected, w.network) : undefined;
  const recentUtxoCount = selectedAddressForToolbar
    ? addressUtxos
      ? recentAddressUtxoTargets.filter(
          (utxo) => !canvasIds.has(outputNodeId(utxo.txid, utxo.vout)),
        ).length
      : canQuery
        ? RECENT_ADDRESS_GRAPH_LIMIT
        : 0
    : 0;
  const recentTransactionNeedsFetch =
    !addressHistory ||
    addressHistory.source === 'loaded transactions' ||
    addressHistory.entries.length === 0;
  const recentTransactionCount = selectedAddressForToolbar
    ? recentTransactionNeedsFetch && canQuery
      ? RECENT_ADDRESS_GRAPH_LIMIT
      : recentAddressTransactionTargets.filter(
          (entry) => !canvasIds.has(txNodeId(entry.txid)),
        ).length
    : 0;
  const graphContextToolbar = w ? (
    <GraphContextToolbar
      contextTitle={
        graphFlowContext ? `Transaction ${graphFlowContext.transactionId.slice(3)}` : undefined
      }
      selectedKind={selected?.kind}
      selectedCount={toolbarSelection.length}
      canOpenAddressHistory={!!selectedInputOutputAddress}
      onOpenAddressHistory={openAddressHistory}
      canShowRecentUtxos={!!selectedAddressForToolbar && (!!addressUtxos || canQuery)}
      recentUtxoCount={recentUtxoCount}
      onShowRecentUtxos={showRecentAddressUtxos}
      canShowRecentTransactions={
        !!selectedAddressForToolbar && (!!addressHistory?.entries.length || canQuery)
      }
      recentTransactionCount={recentTransactionCount}
      onShowRecentTransactions={showRecentAddressTransactions}
      sides={contextSides}
      onAddSide={(side) => revealGraphNodes(contextSideIds?.[side] ?? [])}
      onHideSide={(side) =>
        setEntityHidden(
          (contextSideIds?.[side] ?? []).filter(
            (id) => canvasIds.has(id) && unconnectedForHide.has(id),
          ),
          true,
        )
      }
      onRemoveSide={(side) =>
        removeFromGraph(
          (contextSideIds?.[side] ?? []).filter((id) => unconnectedForRemoval.has(id)),
        )
      }
      canOpenCreatingTx={!!tx || canTrace}
      canOpenSpendingTx={selectedSpenders.length > 0 || canTrace}
      onOpenCreatingTx={() => void expand('funding', selectedId, { preserveCamera: true })}
      onOpenSpendingTx={openSpendingFromToolbar}
      canShowSelection={toolbarSelection.some((id) => !canvasIds.has(id))}
      canHideSelection={toolbarSelection.some((id) => canvasIds.has(id))}
      canRemoveSelection={toolbarSelection.some((id) => admittedIds.has(id))}
      onShowSelection={() => revealGraphNodes(toolbarSelection)}
      onHideSelection={() =>
        setEntityHidden(
          toolbarSelection.filter((id) => canvasIds.has(id)),
          true,
        )
      }
      onRemoveSelection={() => removeFromGraph(toolbarSelection)}
      canHideBranch={!!graphFlowContext && canvasIds.has(graphFlowContext.transactionId)}
      canRemoveBranch={!!graphFlowContext && admittedIds.has(graphFlowContext.transactionId)}
      onHideBranch={() =>
        setEntityHidden(graphFlowContext ? [graphFlowContext.transactionId] : [], true)
      }
      onRemoveBranch={() =>
        removeFromGraph(graphFlowContext ? [graphFlowContext.transactionId] : [])
      }
      hiddenCount={hiddenCount}
      onRestoreHidden={showAllHidden}
      unconnectedCount={unconnectedForHide.size}
      removableOutputCount={unconnectedForRemoval.size}
      showAllOutputCount={showAllOutputCount}
      onHideUnconnected={() => void updateAllGraphOutputs('hide')}
      onRemoveUnconnected={() => removeFromGraph([...unconnectedForRemoval])}
      onShowAllOutputs={() => void updateAllGraphOutputs('show')}
      busy={!!operation}
    />
  ) : null;
  const graphNavigation = w ? (
    <div className="graph-navigation">
      <button
        aria-label="Previous selection"
        title="Previous selection"
        disabled={navigation.index <= 0}
        onClick={() => navigateSelection(-1)}
      >
        <ArrowLeft size={14} />
      </button>
      <button
        aria-label="Next selection"
        title="Next selection"
        disabled={navigation.index >= navigation.ids.length - 1}
        onClick={() => navigateSelection(1)}
      >
        <ArrowRight size={14} />
      </button>
      <button
        aria-label="Center selection"
        title="Center selection"
        disabled={!selected || hiddenIds.has(selected.id)}
        onClick={() => centerNode()}
      >
        <Crosshair size={14} />
        <span className="graph-nav-caption">Center</span>
      </button>
      <button
        aria-label="Lock to selection"
        title="Keep selections centered without changing zoom"
        aria-pressed={w.view.lockToSelection ?? false}
        className={`graph-lock-selection ${w.view.lockToSelection ? 'active' : ''}`}
        onClick={() => {
          cameraPreservedSelection.current = undefined;
          change(
            (current) => ({
              ...current,
              view: { ...current.view, lockToSelection: !current.view.lockToSelection },
            }),
            false,
          );
        }}
      >
        <Focus size={14} />
        <span className="graph-nav-caption">Lock</span>
      </button>
      <button
        aria-label="Isolate selection"
        title="Show the selection and connected entities; Paths sets the hop limit"
        aria-pressed={!!graphFilters.focus}
        className={`graph-isolate-selection ${graphFilters.focus ? 'active' : ''}`}
        disabled={!graphFilters.focus && (!selected || hiddenIds.has(selected.id))}
        onClick={() => {
          if (graphFilters.focus) updateFilters({ ...graphFilters, focus: undefined });
          else if (selectedId) {
            prepareIsolation([selectedId], true);
            updateFilters({ ...graphFilters, focus: { id: selectedId, hops: 1 } });
          }
        }}
      >
        <Filter size={14} />
        <span className="graph-nav-caption">Isolate</span>
      </button>
      <label>
        <span className="graph-path-label">Paths</span>
        <select
          aria-label="Focus graph paths"
          value={graphFilters.focus?.hops ?? 0}
          disabled={!selected && !!graph.nodes.length}
          onChange={(event) => {
            const hops = Number(event.target.value);
            updateFilters(
              hops && selectedId
                ? {
                    ...graphFilters,
                    focus: { id: selectedId, hops: hops as 1 | 2 },
                    includeIds: undefined,
                  }
                : { ...graphFilters, focus: undefined, includeIds: undefined },
            );
          }}
        >
          <option value={0}>All paths</option>
          <option value={1}>1 hop</option>
          <option value={2}>2 hops</option>
        </select>
      </label>
      <GraphWalletFilter
        key={w.id}
        active={workbench === 'graph'}
        filters={graphFilters}
        wallets={w.wallets}
        onChange={updateFilters}
      />
      <GraphFilterButton
        filters={graphFilters}
        onChange={updateFilters}
        onReset={resetGraphFilters}
        extraFiltersActive={!!w.view.smallAmountThreshold}
        wallets={w.wallets}
        tags={w.tags}
      />
      <button
        className={`selection-mode-toggle ${selection.mode ? 'active' : ''}`}
        aria-label="Selection mode"
        aria-pressed={selection.mode}
        title="Choose several entities for batch labels, tags and icons. Ctrl or Cmd click also toggles an entity."
        disabled={pickingScanTargets}
        onClick={() => selection.setMode(!selection.mode)}
      >
        <CheckSquare size={14} />
        <span className="graph-nav-caption">Select</span>
      </button>
    </div>
  ) : null;
  const selectionOffCanvas = Boolean(
    selected && !visibleGraph.nodes.some((node) => node.id === selected.id),
  );
  const graphNavigationStatus =
    w &&
    (hasActiveFilters(graphFilters) ||
      w.view.smallAmountThreshold ||
      hiddenCount > 0 ||
      selectionOffCanvas) ? (
      <>
        <FilterChips
          filters={graphFilters}
          onChange={updateFilters}
          names={{
            walletName: w.wallets.find((wallet) => wallet.id === graphFilters.walletId)?.name,
            walletNames: selectedWalletFilterIds(graphFilters).map(
              (id) => w.wallets.find((wallet) => wallet.id === id)?.name ?? 'Removed wallet',
            ),
            tagName: w.tags?.find((tag) => tag.id === graphFilters.tagId)?.name,
          }}
          hiddenCount={hiddenCount}
          onShowAllHidden={showAllHidden}
          onReset={resetGraphFilters}
          extraFiltersActive={!!w.view.smallAmountThreshold}
        >
          {!!w.view.smallAmountThreshold && (
            <span className="filter-chip">
              <span title={`Above ${formatBitcoinAmount(w.view.smallAmountThreshold)}`}>
                Above <Amount value={w.view.smallAmountThreshold} />
              </span>
              <button
                aria-label="Remove graph amount filter"
                onClick={() =>
                  change(
                    (current) => ({
                      ...current,
                      view: { ...current.view, smallAmountThreshold: undefined },
                    }),
                    false,
                  )
                }
              >
                <X size={11} />
              </button>
            </span>
          )}
          <GraphConnectionsAction
            filters={graphFilters}
            onChange={updateFilters}
            extraNodeCount={canvasFilterResult.availableContextNodeCount}
            pending={graphFiltering}
          />
        </FilterChips>
        {selectionOffCanvas && (
          <span className="view-summary">
            {hiddenIds.has(selected!.id)
              ? 'selection hidden from graph'
              : !admittedIds.has(selected!.id)
                ? 'selection not on graph'
                : 'selection hidden by filters'}
          </span>
        )}
      </>
    ) : null;
  return (
    <TransactionFetchShell scope={fetchScope}>
      <a
        className="skip-link"
        href={workbench === 'graph' || !w ? '#main-workspace' : `#${workbench}-workspace`}
      >
        Skip to workspace
      </a>
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (w) activateWorkspace(undefined);
          }}
          aria-label="Chaingraph home"
        >
          <NetworkIcon size={23} />
          <span>
            chaingraph<span className="wordmark-dot">.</span>
          </span>
        </a>
        <nav
          ref={workspaceTabs}
          className="workspace-tabs"
          data-tour="workspace-tabs"
          aria-label="Open workspaces"
        >
          <button
            aria-label="Workspaces"
            className={!w ? 'home-tab active' : 'home-tab'}
            onClick={() => activateWorkspace(undefined)}
          >
            <FolderOpen size={15} />
            <span>Workspaces</span>
          </button>
          {ws.sessions.map((s) => (
            <button
              className={`workspace-tab ${s.data.id === w?.id ? 'active' : ''}`}
              key={s.data.id}
              title={s.data.name}
              aria-current={s.data.id === w?.id ? 'page' : undefined}
              onClick={() => activateWorkspace(s.data.id)}
            >
              <span className="tab-network">{s.data.network === 'mainnet' ? 'M' : 'T'}</span>
              <span>{s.data.name}</span>
              {(s.revision !== s.savedRevision || pendingGraphWorkspace === s.data.id) && (
                <span aria-label="Unsaved changes" className="dirty-dot">
                  ●
                </span>
              )}
            </button>
          ))}
          <button
            className="icon-button"
            data-testid="new-workspace-button"
            aria-label="New workspace"
            title="New workspace"
            onClick={() => setCreate('empty')}
          >
            <Plus size={16} />
          </button>
        </nav>
        <button
          onClick={() => setAboutOpen('connection')}
          aria-label="Connection details"
          className={`connection connection-action ${connected ? 'online' : ''}`}
          title={status?.error || statusError || 'Your self-hosted backend'}
        >
          <span className="status-dot" />
          <span className="connection-text">
            {connected
              ? `${status?.network} · ${status?.height?.toLocaleString() ?? 'connected'}`
              : 'Offline'}
          </span>
          <span className="connection-network">{displayNetwork ?? 'Offline'}</span>
        </button>
        <HelpMenu
          actions={[
            {
              label: w ? 'Show guided tour' : 'Getting started',
              onSelect: () => (w ? setTour(WORKBENCH_TOUR[0].id) : setAboutOpen('guide')),
            },
            {
              label: 'Example workspaces',
              disabled: !!discoveryError || !networks?.length,
              onSelect: () => setExamplesOpen(true),
            },
            { label: 'About Chaingraph', onSelect: () => setAboutOpen('about') },
          ]}
        />
      </header>

      {!w ? (
        <WorkspaceHome
          saved={ws.saved}
          sessions={ws.sessions}
          onCreate={() => setCreate('empty')}
          networks={discoveryError ? undefined : networks}
          onTemplate={setCreate}
          onExamples={() => setExamplesOpen(true)}
          onOpenFile={() => fileInput.current?.click()}
          onActivate={activateWorkspace}
          onUnlock={setUnlock}
          onDelete={setDeleteEntry}
        />
      ) : (
        <>
          <div className={`workbench-toolbar mode-${shownWorkbench}`}>
            <nav className="workbench-nav" aria-label="Workbench">
              {(['wallet', 'graph', 'analysis'] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={shownWorkbench === mode}
                  className={shownWorkbench === mode ? 'active' : ''}
                  onClick={() => switchWorkbench(mode)}
                >
                  {mode === 'wallet' ? (
                    <WalletIcon size={15} />
                  ) : mode === 'graph' ? (
                    <GitBranch size={15} />
                  ) : (
                    <Search size={15} />
                  )}
                  {WORKBENCH_LABELS[mode]}
                </button>
              ))}
              {!tourStep && returnWorkbench && returnWorkbench !== workbench && (
                <button
                  className="workbench-return"
                  onClick={() => switchWorkbench(returnWorkbench, true)}
                >
                  <ArrowLeft size={14} />
                  Back to {WORKBENCH_LABELS[returnWorkbench]}
                </button>
              )}
            </nav>
            <div className="lookup-controls" data-tour="chain-lookup">
              <LookupForm
                inputRef={searchInput}
                network={w.network}
                canQuery={canQuery}
                busy={!!operation}
                resetToken={queryReset}
                queryError={queryError}
                onQueryError={setQueryError}
                resolveLoaded={loadedLookupId}
                onSubmit={addQuery}
              />
              {!w.demo && (
                <label
                  className="lookup-prefetch"
                  title="Previous transaction levels for transaction/output lookups. Up to 500 downloads per action."
                >
                  <span>Previous levels</span>
                  <select
                    aria-label="Prefetch previous levels"
                    value={prefetchDepth}
                    onChange={(e) => setPrefetchDepth(Number(e.target.value) as 0 | 1 | 2)}
                  >
                    <option value={0}>Previous: off</option>
                    <option value={1}>Previous: 1</option>
                    <option value={2}>Previous: 2</option>
                  </select>
                </label>
              )}
            </div>
            <div className="workspace-actions" data-tour="workspace-actions">
              <button
                className="icon-button workspace-undo"
                aria-label={undoLabel}
                title={undoLabel}
                disabled={!ws.active?.history.length || !!operation}
                onClick={() => ws.undo(w.id)}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="icon-button workspace-redo"
                aria-label={redoLabel}
                title={redoLabel}
                disabled={!ws.active?.redoHistory.length || !!operation}
                onClick={() => ws.redo(w.id)}
              >
                <Redo2 size={17} />
              </button>
              <button
                className="export-button"
                title="Export encrypted workspace backup"
                aria-label="Export encrypted workspace backup"
                onClick={() => void exportWorkspace()}
                disabled={!!operation}
              >
                <Download size={16} />
                <span>Export workspace</span>
              </button>
              <div
                className="workspace-menu"
                ref={workspaceMenu}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false);
                }}
              >
                <button
                  ref={workspaceMenuTrigger}
                  className="icon-button"
                  aria-label="Workspace menu"
                  aria-expanded={menu}
                  aria-controls={menu ? 'workspace-menu-actions' : undefined}
                  onClick={() => setMenu(!menu)}
                >
                  <Ellipsis size={20} />
                </button>
                {menu && (
                  <div
                    className="dropdown"
                    id="workspace-menu-actions"
                    role="group"
                    aria-label="Workspace actions"
                  >
                    <button
                      className="mobile-workspace-undo"
                      aria-label={undoLabel}
                      title={undoLabel}
                      disabled={!ws.active?.history.length || !!operation}
                      onClick={() => {
                        setMenu(false);
                        ws.undo(w.id);
                      }}
                    >
                      <Undo2 size={15} /> Undo
                    </button>
                    <button
                      className="mobile-workspace-redo"
                      aria-label={redoLabel}
                      title={redoLabel}
                      disabled={!ws.active?.redoHistory.length || !!operation}
                      onClick={() => {
                        setMenu(false);
                        ws.redo(w.id);
                      }}
                    >
                      <Redo2 size={15} /> Redo
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        setSettingsOpen(true);
                      }}
                    >
                      Workspace details
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        void exportWorkspace();
                      }}
                    >
                      <Download size={15} />
                      Export encrypted workspace
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        labelsInput.current?.click();
                      }}
                    >
                      <Upload size={15} />
                      Import BIP329 labels
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        download('labels.jsonl', exportLabels(w), 'application/x-ndjson');
                        setNotice(
                          'BIP329 labels exported as unencrypted JSONL. Notes and graph layout use the encrypted workspace format.',
                        );
                      }}
                    >
                      <Download size={15} />
                      Export BIP329 labels · plaintext
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        operationRef.current?.abort();
                        flushActiveGraph();
                        setLockingWorkspace(true);
                        void ws
                          .lock(w.id)
                          .catch((e) => setError(e.message))
                          .finally(() => setLockingWorkspace(false));
                      }}
                    >
                      <LockKeyhole size={15} />
                      Lock workspace
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {queryError && (
            <div className="lookup-error" id="lookup-error" role="alert">
              {queryError}
            </div>
          )}
          <div className="mobile-switch" hidden={shownWorkbench !== 'graph'}>
            <button
              className={shownMobilePanel === 'left' ? 'active' : ''}
              onClick={() => setMobilePanel('left')}
            >
              <WalletIcon size={15} />
              Browse
            </button>
            <button
              className={shownMobilePanel === 'graph' ? 'active' : ''}
              onClick={() => setMobilePanel('graph')}
            >
              <GitBranch size={15} />
              Graph
            </button>
            <button
              className={shownMobilePanel === 'right' ? 'active' : ''}
              onClick={() => setMobilePanel('right')}
            >
              <List size={15} />
              {shownRightTab === 'scan'
                ? 'Scan'
                : shownRightTab === 'analysis'
                  ? 'Inspector'
                  : shownRightTab === 'addresses'
                    ? 'Addresses'
                    : shownRightTab === 'transactions'
                      ? 'Transactions'
                      : shownRightTab === 'utxos'
                        ? 'UTXOs'
                        : 'Inspector'}
            </button>
          </div>
          <main
            hidden={shownWorkbench !== 'graph'}
            ref={graphWorkspaceRef}
            id="main-workspace"
            tabIndex={-1}
            className={`workbench show-${shownMobilePanel} ${shownFocusGraph ? 'focus-graph' : ''}`}
          >
            <WorkspacePanel
              w={w}
              transactions={w.transactions}
              removableNodeIds={removableNodeIds}
              onRemoveNode={requestEntityRemoval}
              selection={pickingScanTargets ? undefined : selection}
              tagsPanel={
                <TagsPanel
                  key={w.id}
                  workspace={w}
                  graph={graph}
                  selected={selected}
                  selectedIds={pickingScanTargets ? undefined : selection.ids}
                  onChange={changeTags}
                  onSelect={(id) => {
                    select(id);
                    if (!pickingScanTargets) setMobilePanel('right');
                  }}
                  onShow={(tag) => {
                    updateFilters({ tagId: tag.id, preserveContext: true });
                    setMobilePanel('graph');
                  }}
                />
              }
              leftTab={shownLeftTab}
              setLeftTab={setLeftTab}
              selectedWalletId={wallet?.id}
              selectedId={selectedId}
              onSelectWallet={(id) => {
                selectionGeneration.current++;
                operationRef.current?.abort();
                setSelectedWallet(id);
                setSelectedId(undefined);
                setRightTab('inspect');
                setMobilePanel('right');
              }}
              onSelectNode={(id) => {
                select(id);
                if (!pickingScanTargets) setMobilePanel('right');
              }}
              onAddWallet={() => setWalletDialog(true)}
              onEditWallet={(walletId) => setWalletNameDialog({ workspaceId: w.id, walletId })}
              busy={!!operation}
              onRefreshAll={() => void scan()}
              onShowActivity={showWalletActivity}
              gap={gap}
              setGap={setGap}
              scanLimit={scanLimit}
              setScanLimit={setScanLimit}
              live={live}
              setLive={setLive}
              canQuery={canQuery}
              entityFilter={(entityFiltersLinked ? graphFilters : entityPanelFilters).query ?? ''}
              setEntityFilter={(query) =>
                entityFiltersLinked
                  ? updateFilters({ ...graphFilters, query })
                  : setEntityPanelFilters((filters) => ({ ...filters, query }))
              }
              entityKind={(entityFiltersLinked ? graphFilters : entityPanelFilters).kind ?? 'all'}
              setEntityKind={(kind) =>
                entityFiltersLinked
                  ? updateFilters({ ...graphFilters, kind: kind as GraphFilters['kind'] })
                  : setEntityPanelFilters((filters) => ({
                      ...filters,
                      kind: kind as GraphFilters['kind'],
                    }))
              }
              graphFilters={entityFiltersLinked ? graphFilters : entityPanelFilters}
              onGraphFiltersChange={entityFiltersLinked ? updateFilters : setEntityPanelFilters}
              onResetGraphFilters={entityFiltersLinked ? resetGraphFilters : resetEntityFilters}
              entityFiltersLinked={entityFiltersLinked}
              onEntityFiltersLinkedChange={setEntityFilterLink}
              entityTotalCount={
                entityVisibility === 'hidden'
                  ? hiddenCount
                  : entityVisibility === 'visible'
                    ? visibleEntityCount
                    : recoveryGraph.nodes.length
              }
              contextCount={
                entityFiltersLinked &&
                (entityVisibility === 'visible' || entityVisibility === 'graph')
                  ? visibleGraph.contextNodeIds.length
                  : 0
              }
              contextNodeCount={
                entityFiltersLinked ? canvasFilterResult.availableContextNodeCount : 0
              }
              contextPreviewPending={entityFiltersLinked && graphFiltering}
              hiddenNodeIds={w.view.hiddenNodeIds}
              onSetHidden={setEntityHidden}
              visibility={entityVisibility}
              onVisibilityChange={(entityVisibility) =>
                change(
                  (current) => ({ ...current, view: { ...current.view, entityVisibility } }),
                  false,
                )
              }
              hiddenCount={hiddenCount}
              onShowAllHidden={showAllHidden}
              entityNodes={entityNodes}
              entityBatchNodes={entityBatchNodes}
              bookmarks={bookmarks}
            />
            <section
              className="graph-stage"
              data-tour="graph-stage"
              aria-label="Graph workspace"
              tabIndex={-1}
            >
              <div className="graph-stage-content">
                {viewOwner === w.id && (
                  <TransactionView
                    walletUtxoObservation={walletUtxoObservation}
                    key={w.id}
                    state={
                      tourStep?.view?.flowOpen
                        ? { ...w.view.transactionFlow, open: true }
                        : w.view.transactionFlow
                    }
                    onStateChange={(transactionFlow) =>
                      !tourStep &&
                      ws.update(
                        w.id,
                        (current) => ({
                          ...current,
                          view: { ...current.view, transactionFlow },
                        }),
                        false,
                      )
                    }
                    renderMetadata={renderEntityMetadata}
                    onSmallAmountThresholdChange={(flowAmountThreshold) =>
                      change(
                        (current) => ({
                          ...current,
                          view: { ...current.view, flowAmountThreshold },
                        }),
                        false,
                      )
                    }
                    workspace={w}
                    addressHistory={addressHistory}
                    addressHistoryLoad={addressHistoryLoad}
                    addressBalance={addressBalance}
                    addressUtxos={addressUtxos}
                    onLoadAddressHistory={openAddressHistory}
                    onLoadAddressUtxos={loadAddressUtxos}
                    onOpenAddressHistoryTransaction={openAddressHistoryTransaction}
                    selected={selected}
                    selection={pickingScanTargets ? undefined : selection}
                    hiddenNodeIds={w.view.hiddenNodeIds}
                    graphNodeIds={w.view.graphNodeIds}
                    onSetHidden={setEntityHidden}
                    {...flowInputs}
                    onSelect={select}
                    onEdit={editNode}
                    onApplyTags={changeTags}
                    onSetIcon={(id, icon) =>
                      change((current) => applyBatchIcon(current, [id], icon, true))
                    }
                    onTrace={(direction, id) => void expand(direction, id)}
                    disabledReason={
                      operation ? 'Wait for the current operation to finish.' : queryDisabledReason
                    }
                  />
                )}
                <div className="graph-renderer-region">
                  {!graph.nodes.length && (
                    <GraphControls
                      smallAmountHiddenCount={amountGraph.hiddenCount}
                      view={w.view}
                      focusGraph={shownFocusGraph}
                      onToggleFocus={() => setFocusGraph((value) => !value)}
                      onChange={changeGraphView}
                    />
                  )}
                  {graph.nodes.length && viewOwner === w.id ? (
                    <Suspense
                      fallback={
                        <div className="graph-empty">
                          <LoaderCircle className="spin" />
                          <p>Loading graph renderer…</p>
                        </div>
                      }
                    >
                      <GraphView
                        filtering={graphFiltering}
                        key={w.id}
                        snapshot={w.view.graphSnapshot}
                        onActivity={(active) => {
                          ws.pauseAutosave(w.id, active);
                          setPendingGraphWorkspace((previous) =>
                            active ? w.id : previous === w.id ? undefined : previous,
                          );
                        }}
                        onRegisterSnapshotFlush={(flush) => {
                          if (flush) graphFlush.current = { workspaceId: w.id, flush };
                          else if (graphFlush.current?.workspaceId === w.id)
                            graphFlush.current = undefined;
                        }}
                        onSnapshot={(snapshot) =>
                          ws.update(
                            w.id,
                            (current) => ({
                              ...current,
                              view: { ...current.view, graphSnapshot: snapshot },
                            }),
                            false,
                          )
                        }
                        navigation={graphNavigation}
                        contextToolbar={graphContextToolbar}
                        navigationStatus={graphNavigationStatus}
                        legend={
                          <GraphLegend
                            flowContext={graphFlowContext}
                            dimensions={appliedGraphRequest.dimensions}
                            showAddresses={appliedGraphRequest.showAddresses}
                            demo={w.demo}
                          />
                        }
                        toolbar={({ motionToggle }) => (
                          <GraphControls
                            motionToggle={motionToggle}
                            smallAmountHiddenCount={amountGraph.hiddenCount}
                            view={w.view}
                            focusGraph={shownFocusGraph}
                            onToggleFocus={() => setFocusGraph((value) => !value)}
                            onChange={changeGraphView}
                          />
                        )}
                        nodePresentation={batchPresentation}
                        flowContext={graphFlowContext}
                        renderMetadata={renderEntityMetadata}
                        nodes={visibleGraph.nodes}
                        links={visibleGraph.links}
                        focusRequest={focusRequest}
                        selectedId={selectedId}
                        onSelect={select}
                        selectionMode={pickingScanTargets || selection.mode}
                        selectionPurpose={pickingScanTargets ? 'scan-target' : 'batch'}
                        batchSelectedIds={highlightedSelection}
                        onToggleSelection={pickingScanTargets ? toggleScanTarget : selection.toggle}
                        hiddenNodeIds={w.view.hiddenNodeIds}
                        graphNodeIds={w.view.graphNodeIds}
                        onSetHidden={setEntityHidden}
                        dimensions={appliedGraphRequest.dimensions}
                        sizeBy={appliedGraphRequest.sizeBy}
                        glow={appliedGraphRequest.glow}
                        showLabels={appliedGraphRequest.showLabels}
                        showTags={appliedGraphRequest.showTags}
                        showIcons={appliedGraphRequest.showIcons}
                        fitToken={appliedGraphRequest.fitToken}
                        transactions={w.transactions}
                        workspace={w}
                        onTrace={(id) => void expand('funding', id)}
                        onEdit={editNode}
                        busy={!!operation}
                        traceDisabledReason={queryDisabledReason}
                      />
                    </Suspense>
                  ) : (
                    <div className="graph-empty">
                      <div className="graph-empty-mark">
                        <GitBranch size={38} />
                      </div>
                      <span className="eyebrow">AN OPEN FIELD</span>
                      <h2>
                        Start with a wallet.
                        <br />
                        Or follow a transaction.
                      </h2>
                      <p>
                        Import a public key or paste a transaction, output, or address above. Expand
                        only the paths that matter to you.
                      </p>
                      <button onClick={() => setWalletDialog(true)} className="primary">
                        <Plus size={16} />
                        Add your first wallet
                      </button>
                      {!connected && (
                        <p className="small">
                          Backend offline. You can still work with saved data.
                        </p>
                      )}
                    </div>
                  )}
                  {!!graph.nodes.length && !visibleGraph.nodes.length && (
                    <div className="filtered-graph-empty">
                      <h3>
                        {!admittedGraph.nodes.length
                          ? 'Choose a node to add to the graph'
                          : hiddenCount === admittedGraph.nodes.length
                            ? 'All entities are hidden'
                            : 'No visible nodes match these filters'}
                      </h3>
                      <p>Use the transaction flow, entity list or right toolbar to show nodes.</p>
                      <div className="button-row">
                        {!!Object.keys(graphFilters).length && (
                          <button onClick={resetGraphFilters}>Clear filters</button>
                        )}
                        {!!hiddenCount && (
                          <button onClick={showAllHidden}>Show all hidden entities</button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
            <aside
              className="right-panel"
              ref={rightPanelRef}
              tabIndex={-1}
              data-tour="analysis-panel"
            >
              <div className={`panel-tabs ${wallet ? 'has-wallet-tabs' : ''}`}>
                <button
                  className={shownRightTab === 'inspect' ? 'active' : ''}
                  onClick={() => setRightTab('inspect')}
                >
                  Inspector
                </button>
                <button
                  className={shownRightTab === 'scan' ? 'active' : ''}
                  aria-pressed={shownRightTab === 'scan'}
                  onClick={() => setRightTab('scan')}
                >
                  Scan
                </button>
                {wallet && (
                  <>
                    <button
                      className={shownRightTab === 'addresses' ? 'active' : ''}
                      aria-pressed={shownRightTab === 'addresses'}
                      onClick={() => setRightTab('addresses')}
                    >
                      Addresses
                    </button>
                    <button
                      className={shownRightTab === 'transactions' ? 'active' : ''}
                      aria-pressed={shownRightTab === 'transactions'}
                      onClick={() => setRightTab('transactions')}
                    >
                      Transactions
                    </button>
                    <button
                      className={shownRightTab === 'utxos' ? 'active' : ''}
                      aria-pressed={shownRightTab === 'utxos'}
                      onClick={() => setRightTab('utxos')}
                    >
                      UTXOs
                    </button>
                  </>
                )}
              </div>
              <div className="inspector-scroll" ref={inspectorScroll}>
                {fetchScope && (
                  <ConnectionScanPanel
                    key={w.id}
                    workspace={w}
                    selectionId={pickingScanTargets ? scanTargetDraft!.source : selectedId}
                    customTargetIds={scanTargets}
                    pickingTargets={pickingScanTargets}
                    onPickTargets={(invoker) => {
                      if (!selectedId || !isScanNodeId(selectedId)) return;
                      scanTargetInvoker.current = invoker;
                      setScanTargetDraft({
                        workspaceId: w.id,
                        source: selectedId,
                        ids: scanTargets.filter((id) => id !== selectedId),
                      });
                      setMobilePanel('graph');
                    }}
                    onCancelPicking={() => setScanTargetDraft(undefined)}
                    onRemoveTarget={(id) =>
                      setScanTargets((ids) => ids.filter((target) => target !== id))
                    }
                    visibleNodeIds={visibleGraph.nodes.map((node) => node.id)}
                    addedNodeIds={[...connectionMembers]}
                    loadedSpenders={flowIndex.spenders}
                    neighbours={scanNeighbours}
                    active={
                      shownRightTab === 'scan' && shownWorkbench === 'graph' && !lockingWorkspace
                    }
                    canQuery={canQuery}
                    scope={fetchScope}
                    isCurrent={() =>
                      wRef.current?.id === w.id &&
                      ws.getSession(w.id)?.fetchScope === fetchScope &&
                      !fetchScope.closed
                    }
                    onChange={(update, undo) => {
                      if (
                        wRef.current?.id === w.id &&
                        ws.getSession(w.id)?.fetchScope === fetchScope &&
                        !fetchScope.closed
                      )
                        ws.update(w.id, update, undo);
                    }}
                    onSelect={(id, evidence) => {
                      if (evidence) {
                        change(
                          (current) =>
                            addScanNodeAddition(withScanActionEvidence(current, evidence), id),
                          true,
                          undefined,
                          id.startsWith('tx:') ? 'Add transaction' : 'Add output',
                        );
                        setGraphFilters({});
                      }
                      select(id, { preserveCamera: true });
                      setRightTab('scan');
                    }}
                    onAdd={(result, prefixLength, evidence) => {
                      change(
                        (current) =>
                          addScanPathAddition(
                            withScanActionEvidence(current, evidence),
                            result,
                            prefixLength,
                          ),
                        true,
                        undefined,
                        'Add path',
                      );
                      setGraphFilters({});
                      setFocusRequest(undefined);
                    }}
                  />
                )}
                {wallet && (
                  <WalletRecordsPanel
                    walletUtxos={walletUtxos}
                    key={`wallet-records:${w.id}:${wallet.id}`}
                    workspace={w}
                    wallet={wallet}
                    active={
                      shownRightTab === 'addresses' ||
                      shownRightTab === 'transactions' ||
                      shownRightTab === 'utxos'
                        ? shownRightTab
                        : undefined
                    }
                    canQuery={canQuery}
                    busy={!!operation}
                    selectedId={selectedId}
                    onSelect={selectWalletRecord}
                  />
                )}
                {shownRightTab === 'scan' ||
                shownRightTab === 'addresses' ||
                shownRightTab === 'transactions' ||
                shownRightTab === 'utxos' ? null : wallet &&
                  !selected &&
                  tourStep?.view?.rightTab !== 'inspect' ? (
                  <WalletInspector
                    key={`wallet-inspector:${w.id}:${wallet.id}`}
                    wallet={wallet}
                    workspace={w}
                    busy={!!operation}
                    canQuery={canQuery}
                    onScan={() => void scan(wallet)}
                    onShowActivity={() => showWalletActivity(wallet)}
                    onEdit={() => setWalletNameDialog({ workspaceId: w.id, walletId: wallet.id })}
                    onShowWallet={() => {
                      updateFilters({ walletId: wallet.id, preserveContext: true });
                      setMobilePanel('graph');
                    }}
                    onRemove={() => {
                      change((c) =>
                        pruneWalletReviews({
                          ...c,
                          wallets: c.wallets.filter((x) => x.id !== wallet.id),
                        }),
                      );
                      setSelectedWallet(undefined);
                    }}
                  />
                ) : selected ? (
                  <NodeInspector
                    walletUtxoObservation={walletUtxoObservation}
                    addressBalance={addressBalance}
                    walletMatch={walletMatches.get(selected.id)}
                    onNotify={(message) => {
                      setNotice(message);
                      setNoticeSequence((value) => value + 1);
                    }}
                    onSelectWallet={(id) => {
                      selectionGeneration.current++;
                      operationRef.current?.abort();
                      setSelectedWallet(id);
                      setSelectedId(undefined);
                      setRightTab('inspect');
                      setMobilePanel('right');
                    }}
                    tagsPanel={
                      <SelectedTags
                        key={selected.id}
                        workspace={w}
                        selected={selected}
                        openToken={editTarget === 'tags' ? editToken : 0}
                        onOpenHandled={() => setEditToken(0)}
                        onChange={changeTags}
                        onManage={() => {
                          setLeftTab('tags');
                          setMobilePanel('left');
                        }}
                      />
                    }
                    w={w}
                    selected={selected}
                    tx={tx}
                    graph={graph}
                    busy={!!operation}
                    canQuery={canTrace}
                    queryDisabledReason={queryDisabledReason}
                    editToken={editTarget === 'tags' ? undefined : editToken}
                    editTarget={editTarget === 'icon' ? 'icon' : 'label'}
                    onEditHandled={() => setEditToken(0)}
                    onSelectNode={(id) => {
                      if (id.startsWith('addr:')) revealGraphNodes([id]);
                      select(id);
                    }}
                    onCenter={() => centerNode()}
                    onShowAndCenter={() => centerNode(selected.id, undefined, true)}
                    hiddenNodeIds={w.view.hiddenNodeIds}
                    graphNodeIds={w.view.graphNodeIds}
                    onSetHidden={setEntityHidden}
                    annotationKey={`${w.id}:${selected.id}`}
                    onExpand={(direction) => void expand(direction)}
                    onRefresh={() =>
                      void run(async (signal) => {
                        const transaction = await getTransaction(selected.txid!, signal);
                        signal.throwIfAborted();
                        mergeTransactions(w.id, [transaction]);
                      })
                    }
                    onRefreshAddressBalance={refreshAddressBalance}
                    canRemove={!!selectedRemovalPlan}
                    onRemove={() => requestEntityRemoval()}
                    onSave={(annotation, group) => {
                      const previous = w.annotations[selected.id] ?? {
                        label: '',
                        note: '',
                        icon: '',
                        bookmarked: false,
                      };
                      const field =
                        (Object.keys(annotation) as (keyof typeof annotation)[]).find(
                          (key) => annotation[key] !== previous?.[key],
                        ) ?? 'label';
                      change(
                        (current) => ({
                          ...current,
                          annotations: { ...current.annotations, [selected.id]: annotation },
                        }),
                        true,
                        `annotation:${selected.id}:${field}:${group}`,
                      );
                    }}
                  />
                ) : (
                  <div className="inspector-empty">
                    <Eye size={29} />
                    <h3>A closer look</h3>
                    {w.description && <p className="workspace-description">{w.description}</p>}
                    <p>
                      Select a node in the graph or an item in Entities to inspect it, add labels
                      and notes, and follow its paths.
                    </p>
                    <button className="text-button" onClick={() => switchWorkbench('analysis')}>
                      Scan loaded data <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </main>
          <section
            className="workbench-page"
            hidden={shownWorkbench !== 'wallet'}
            ref={walletWorkspaceRef}
            id="wallet-workspace"
            tabIndex={-1}
            aria-label="Wallet workspace"
          >
            <WalletWorkbench
              walletUtxos={walletUtxos}
              preparationCache={ws.getSession(w.id)?.walletPreparation}
              tourPreview={
                tourStep?.view?.workbench === 'wallet'
                  ? { tab: tourStep.view.walletTab ?? 'review', example: tourExample }
                  : undefined
              }
              active={
                viewOwner === w.id && workbench === 'wallet' && !lockingWorkspace && !tourStep
              }
              workspace={w}
              analysisScan={analysisSessions.current.get(w.id)?.scan}
              updateEvidence={ws.update}
              onScanComplete={(scan) => {
                analysisSessions.current.set(w.id, {
                  scopeMode: analysisSessions.current.get(w.id)?.scopeMode,
                  options: scan.options,
                  scan,
                  selectedId: scan.findings[0]?.id,
                  kind: 'all',
                  limit: 40,
                });
                setWalletScanRevision((value) => value + 1);
              }}
              wallet={wallet ?? w.wallets[0]}
              canQuery={canQuery}
              busy={!!operation}
              queryDisabledReason={queryDisabledReason}
              onSelectWallet={(id) => {
                selectionGeneration.current++;
                operationRef.current?.abort();
                setSelectedWallet(id);
                setSelectedId(undefined);
                setRightTab('inspect');
              }}
              onAddWallet={() => setWalletDialog(true)}
              onChange={(update, group) => change(update, true, group)}
              onEditWallet={(walletId) => setWalletNameDialog({ workspaceId: w.id, walletId })}
              onRefresh={() => void scan(wallet ?? w.wallets[0])}
              onShowInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'graph')}
              onIsolateInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'isolate')}
              onShowSelection={(ids, isolate) => {
                if (ids.length)
                  openWalletRecord(ids[0], undefined, isolate ? 'isolate' : 'graph', ids);
              }}
              onInspect={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'inspect')}
              onAnalyze={analyzeFromWallet}
            />
          </section>
          <section
            className="workbench-page"
            hidden={workbench !== 'analysis' || !!tourStep}
            ref={analysisWorkspaceRef}
            id="analysis-workspace"
            tabIndex={-1}
            aria-label="Analysis workspace"
          >
            <AnalysisWorkbench
              key={`${w.id}:${walletScanRevision}`}
              cache={analysisSessions.current}
              workspace={w}
              active={workbench === 'analysis' && !lockingWorkspace}
              selected={selected}
              wallet={wallet}
              onFindings={(findings) => change((current) => ({ ...current, findings }))}
              onRecovered={(before, next) => {
                if (
                  wRef.current?.id !== before.id ||
                  wRef.current.network !== before.network ||
                  lockingWorkspace
                )
                  return;
                let applied = false;
                change((current) => {
                  if (current.transactions !== before.transactions) return current;
                  applied = true;
                  return { ...current, transactions: next.transactions };
                });
                // Evidence writes mark old findings stale. Install the rerun in the
                // same synchronous action, retaining the single data-enrichment Undo.
                if (applied) change((current) => ({ ...current, findings: next.findings }), false);
              }}
              onGraph={showFindingOnGraph}
            />
          </section>
          <SelectionToolbar
            active={workbench === 'graph' && !tourStep && !pickingScanTargets}
            workspace={w}
            selection={selection}
            visibleSelectedCount={selectionOnCanvas}
            hiddenSelectedCount={selection.count - selectionOnCanvas}
            matching={matchingScope}
            matchingPending={graphFiltering}
            onApply={applyBatch}
            undoToken={undoToken}
            undoDescription={undoDescription}
            onSetHidden={setEntityHidden}
            onIsolate={(ids) => {
              prepareIsolation(ids);
              updateFilters({ includeIds: ids, preserveContext: true });
              setMobilePanel('graph');
              setNotice(
                `Isolated ${ids.length.toLocaleString()} selected entities. The isolation chip restores the full canvas.`,
              );
            }}
            onUndo={() => ws.undo(w.id)}
          />
          {pickingScanTargets && scanTargetDraft && (
            <ScanTargetToolbar
              ids={scanTargetDraft.ids}
              onRemove={toggleScanTarget}
              onDone={() => finishScanTargetPicking(true)}
              onCancel={() => finishScanTargetPicking(false)}
              {...scanTargetPreview}
            />
          )}
          <footer className="statusbar">
            <span>
              {operation ? (
                <>
                  <LoaderCircle className="spin" size={13} />
                  {operation}
                  <button onClick={() => operationRef.current?.abort()}>Cancel</button>
                </>
              ) : backgroundAddressHistoryLoad ? (
                <>
                  <LoaderCircle className="spin" size={13} />
                  {backgroundAddressHistoryLoad.phase === 'history'
                    ? 'Checking address history…'
                    : backgroundAddressHistoryLoad.phase === 'details'
                      ? `Loading address history ${backgroundAddressHistoryLoad.done}/${backgroundAddressHistoryLoad.total}`
                      : 'Checking address balance…'}
                </>
              ) : (
                <>
                  <span className="status-dot" />
                  <span data-testid="graph-node-count">
                    {visibleGraph.nodes.length.toLocaleString()}{' '}
                    {visibleGraph.nodes.length === 1 ? 'node' : 'nodes'}
                  </span>
                  <span className="status-separator">/</span>
                  {visibleGraph.links.length.toLocaleString()} connections
                  <span className="status-separator">/</span>
                  {Object.keys(w.transactions).length.toLocaleString()}{' '}
                  {Object.keys(w.transactions).length === 1 ? 'transaction' : 'transactions'}
                </>
              )}
            </span>
            <span className="save-status">
              <LockKeyhole size={12} />
              {ws.storageError
                ? 'Save failed'
                : pendingGraphWorkspace === w.id
                  ? 'View pending'
                  : ws.saving
                    ? 'Encrypting…'
                    : ws.active?.revision === ws.active?.savedRevision
                      ? 'Encrypted · saved'
                      : 'Unsaved changes'}
            </span>
          </footer>
        </>
      )}
      {w && settingsOpen && (
        <WorkspaceDetailsDialog
          key={w.id}
          workspace={w}
          onClose={() => setSettingsOpen(false)}
          onSave={(name, description) =>
            change(
              (c) =>
                c.name === name && c.description === description ? c : { ...c, name, description },
              true,
              'workspace-details',
            )
          }
        />
      )}
      {examplesOpen && (
        <ExamplesDialog
          networks={discoveryError ? undefined : networks}
          onClose={() => setExamplesOpen(false)}
          onTemplate={(id) => {
            setExamplesOpen(false);
            setCreate(id);
          }}
        />
      )}
      {aboutOpen && (
        <AboutDialog
          initialTab={aboutOpen}
          onClose={() => setAboutOpen(false)}
          onTour={w ? () => setTour(WORKBENCH_TOUR[0].id) : undefined}
          status={status}
          networks={networks}
          statuses={statuses}
          statusError={statusError}
          onReconnect={() => setConnectionCheck((value) => value + 1)}
        />
      )}
      {deleteEntry && (
        <Modal title="Delete saved workspace?" onClose={() => setDeleteEntry(undefined)}>
          <p>
            Delete <strong>{deleteEntry.publicName ?? 'this encrypted workspace'}</strong> from this
            browser? Keep an encrypted export if you may need it again. This deletion cannot be
            undone.
          </p>
          <div className="button-row">
            <button onClick={() => setDeleteEntry(undefined)}>Keep workspace</button>
            <button
              className="danger"
              onClick={() =>
                void ws
                  .removeSaved(deleteEntry.id)
                  .then(() => {
                    setDeleteEntry(undefined);
                    setNotice('Saved workspace deleted from this browser.');
                  })
                  .catch((error) => setError(error.message))
              }
            >
              Delete from this browser
            </button>
          </div>
        </Modal>
      )}
      {(error || ws.storageError || notice) && (
        <div
          className={`toast ${error || ws.storageError ? 'error' : ''}`}
          role={error || ws.storageError ? 'alert' : 'status'}
        >
          <span>{error || ws.storageError || notice}</span>
          {!error &&
            !ws.storageError &&
            notice === ADDRESS_DISPLAY_NOTICE &&
            w &&
            !w.view.showAddresses && (
              <button
                onClick={() => {
                  change((current) => ({
                    ...current,
                    view: { ...current.view, showAddresses: true },
                  }));
                  setNotice('');
                }}
              >
                Enable address display
              </button>
            )}
          {!ws.storageError && (
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => {
                setError('');
                setNotice('');
              }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {w && !w.demo && !canQuery && (
        <div
          className="connection-banner"
          role={unsupportedNetwork || discoveryError || (status && !connected) ? 'alert' : 'status'}
        >
          {queryDisabledReason} Saved data remains available for offline analysis.
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".chaingraph,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            if (file.size > MAX_ENCRYPTED_FILE_BYTES) setError('Workspace file is too large.');
            else setFileDialog(file);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={labelsInput}
        type="file"
        accept=".jsonl,.json,.txt"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !w) return;
          try {
            if (file.size > 5_000_000) throw new Error('Label file exceeds 5 MB.');
            const result = importLabels(await file.text());
            change((c) => {
              const annotations = { ...c.annotations };
              for (const [id, a] of Object.entries(result.annotations))
                annotations[id] = {
                  ...(annotations[id] ?? emptyAnnotation),
                  label: a.label,
                };
              return {
                ...c,
                annotations,
                wallets: c.wallets.map((wallet) => ({
                  ...wallet,
                  name: result.annotations[`xpub:${wallet.key}`]?.label.trim() || wallet.name,
                })),
              };
            });
            setNotice(
              `Imported ${Object.keys(result.annotations).length} labels. ${result.skipped} records skipped (unsupported type or no label).`,
            );
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Label import failed.');
          }
        }}
      />
      {entityRemoval && removalPlan && (
        <Modal
          title={
            removalPlan.kind === 'transaction' ? 'Remove transaction?' : 'Stop watching address?'
          }
          onClose={() => setEntityRemoval(undefined)}
        >
          <p>{removalPlan.title}</p>
          <div className="selection-facts">
            <span>{removalPlan.kind === 'transaction' ? 'Transaction ID' : 'Address'}</span>
            <code className="mono wrap" style={{ userSelect: 'all', display: 'block' }}>
              {removalPlan.nodeId.slice(removalPlan.kind === 'transaction' ? 3 : 5)}
            </code>
            <CopyButton
              value={removalPlan.nodeId.slice(removalPlan.kind === 'transaction' ? 3 : 5)}
              label={
                removalPlan.kind === 'transaction'
                  ? 'Copy transaction ID to remove'
                  : 'Copy address to stop watching'
              }
            />
          </div>
          <p>
            {removalPlan.kind === 'transaction'
              ? 'Remove the cached transaction and its transaction/output annotations and tag memberships from this workspace. Unused input context is removed too; shared, independently added or annotated context is retained. Outputs referenced by retained transactions may remain as placeholders.'
              : 'Stop watching this address and clear its annotation and tag memberships. Loaded transaction data remains in the workspace.'}
          </p>
          <p>
            This removes {removalPlan.annotationCount} annotated{' '}
            {removalPlan.annotationCount === 1 ? 'entity' : 'entities'} and{' '}
            {removalPlan.tagMembershipCount} tag{' '}
            {removalPlan.tagMembershipCount === 1 ? 'membership' : 'memberships'}. Tag definitions
            remain. Undo can restore this change during the current session.
          </p>
          <div className="button-row">
            <button onClick={() => setEntityRemoval(undefined)}>Keep in workspace</button>
            <button
              className="danger"
              onClick={() => applyEntityRemoval(entityRemoval.workspaceId, entityRemoval.nodeId)}
            >
              {removalPlan.kind === 'transaction' ? 'Remove transaction' : 'Stop watching address'}
            </button>
          </div>
        </Modal>
      )}
      {create && (
        <CreateDialog
          networks={discoveryError ? undefined : networks}
          key={create}
          template={WORKSPACE_TEMPLATES.find((template) => template.id === create)}
          onCreate={openWorkspace}
          onClose={() => setCreate(undefined)}
        />
      )}
      {unlock && (
        <UnlockDialog
          entry={unlock}
          onUnlock={async (entry, password, signal) => {
            await saveBeforeLeaving();
            signal.throwIfAborted();
            const current = ws.getSaved(entry.id);
            if (!current) throw new Error('Saved workspace changed; reload before unlocking.');
            return ws.unlock(current, password, signal);
          }}
          onClose={() => setUnlock(undefined)}
        />
      )}
      {w && editingWallet && !lockingWorkspace && (
        <WalletNameDialog
          key={`${w.id}:${editingWallet.id}`}
          wallet={editingWallet}
          onChange={(name) =>
            change(
              (current) => {
                const target = current.wallets.find((item) => item.id === editingWallet.id);
                if (current.id !== walletNameDialog?.workspaceId || !target || target.name === name)
                  return current;
                return {
                  ...current,
                  wallets: current.wallets.map((item) =>
                    item.id === target.id ? { ...item, name } : item,
                  ),
                };
              },
              true,
              `wallet-name:${editingWallet.id}`,
            )
          }
          onClose={() => setWalletNameDialog(undefined)}
        />
      )}
      {walletDialog && w && (
        <WalletDialog
          network={w.network}
          onAdd={(newWallet) => {
            if (
              w.wallets.some(
                (x) => x.key === newWallet.key && x.scriptType === newWallet.scriptType,
              )
            ) {
              setError('That wallet is already in this workspace.');
              return;
            }
            change((c) => ({ ...c, wallets: [...c.wallets, newWallet] }));
            setSelectedWallet(newWallet.id);
            setSelectedId(undefined);
            setRightTab('inspect');
            setMobilePanel('right');
            switchWorkbench('wallet', true);
          }}
          onClose={() => setWalletDialog(false)}
        />
      )}
      {fileDialog && (
        <ImportDialog
          file={fileDialog}
          onImport={(data, password) => {
            const existing =
              ws.sessions.find((s) => s.data.id === data.id) ||
              ws.saved.find((s) => s.id === data.id);
            if (existing)
              data = {
                ...data,
                id: crypto.randomUUID(),
                name: `${data.name.slice(0, 93)} (copy)`,
              };
            openWorkspace(data, password);
          }}
          onClose={() => setFileDialog(undefined)}
        />
      )}
      {tour !== undefined && !!w && (
        <GuidedTour
          steps={tourSteps}
          activeId={tour}
          onStepChange={setTour}
          previewLabel={needsTourExample ? 'Public example · preview only (mainnet)' : undefined}
          previewStatus={
            needsTourExample
              ? {
                  loading: walletTourExample.loading,
                  error: walletTourExample.error,
                  onRetry: walletTourExample.retry,
                }
              : undefined
          }
        />
      )}
    </TransactionFetchShell>
  );
}
