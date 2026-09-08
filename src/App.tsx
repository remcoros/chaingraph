import { WalletRecordsPanel } from './components/WalletRecordsPanel';
import { verifyWalletUtxo, type WalletUtxoRecord } from './domain/walletRecords';
import { useAnalysisUiState, type AnalysisUiRunReport } from './lib/useAnalysisUiState';
import { useFlowInputs } from './lib/useFlowInputs';
import { ExamplesDialog } from './components/ExamplesDialog';
import type { NodePresentation } from './components/graph/presentation';
import { GraphLegend } from './components/GraphLegend';
import { GraphControls } from './components/GraphControls';
import { EntityBadges } from './components/EntityBadges';
import { CopyButton } from './components/CopyButton';
import TagsPanel, { SelectedTags } from './components/TagsPanel';
import { buildWalletMatches, tagNodeIds, buildTagIndex, parseWorkspaceTags } from './domain/tags';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Crosshair,
  Focus,
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
} from 'lucide-react';
const GraphView = lazy(() => import('./components/GraphView'));

import {
  CreateDialog,
  ImportDialog,
  UnlockDialog,
  WalletDialog,
  WorkspaceDetailsDialog,
  Modal,
} from './components/Dialogs';
import { TransactionView } from './components/TransactionView';
import { emptyAnnotation, NodeInspector, WalletInspector } from './components/Inspector';
import { HelpMenu } from './components/HelpMenu';
import { AboutDialog } from './components/AboutDialog';
import { filterGraph, valueFilterError, type GraphFilters } from './domain/graphFilters';
import { setNodesHidden, showAllNodes } from './domain/visibility';
import { planEntityRemoval, removeWorkspaceEntity } from './domain/entityRemoval';
import {
  applyWalletScan,
  walletActivitySummary,
  walletEvidenceChanged,
} from './domain/walletActivity';
import { AnalysisPanel } from './components/AnalysisPanel';
import { WorkspaceHome } from './components/WorkspaceHome';
import { WorkspacePanel } from './components/WorkspacePanel';
import { GuidedTour } from './components/GuidedTour';
import {
  buildGraph,
  clearContextProvenance,
  markContextTransactions,
  promoteInputContext,
} from './domain/workspace';
import { filterSmallAmounts, omitAmountOrphans } from './domain/smallAmounts';
import { defaultsFor, analysisTools, type AnalysisOptions } from './domain/analysis';
import {
  outputNodeId,
  addressNodeId,
  txNodeId,
  type Transaction,
  type Wallet,
  type Workspace,
  type WorkspaceTag,
} from './domain/types';
import { fetchTransaction, loadAddress, loadSpending, scanWallet } from './lib/api';
import { useBackendNetworks } from './lib/useBackendNetworks';
import { ancestryNotice, loadAncestors, traceSourceExists } from './lib/tracing';
import { WORKBENCH_TOUR, availableTourSteps } from './features/tour/steps';
import { WORKSPACE_TEMPLATES } from './domain/workspaceTemplates';
import { MAX_ENCRYPTED_FILE_BYTES } from './lib/crypto';
import { exportLabels, importLabels } from './lib/labels';
import { useWorkspaces, type SavedWorkspace } from './lib/useWorkspaces';

const ADDRESS_DISPLAY_NOTICE = 'This address is no longer hidden. Address nodes are switched off.';

function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const ws = useWorkspaces();
  const w = ws.active?.data;
  const [create, setCreate] = useState<string>();
  const [unlock, setUnlock] = useState<SavedWorkspace>();
  const [entityRemoval, setEntityRemoval] = useState<{ workspaceId: string; nodeId: string }>();
  const [walletDialog, setWalletDialog] = useState(false);
  const [fileDialog, setFileDialog] = useState<File>();
  const [menu, setMenu] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const inspectorScroll = useRef<HTMLDivElement>(null);
  const [viewOwner, setViewOwner] = useState<string>();
  const [selectedWallet, setSelectedWallet] = useState<string>();
  const selectionGeneration = useRef(0);
  const [leftTab, setLeftTab] = useState<'wallets' | 'entities' | 'bookmarks' | 'tags'>('wallets');
  const [graphFilters, setGraphFilters] = useState<GraphFilters>({});
  const [navigation, setNavigation] = useState<{ ids: string[]; index: number }>({
    ids: [],
    index: -1,
  });
  const [focusGraph, setFocusGraph] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number }>();
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
  const { state: analysisUiState, update: updateAnalysisUiState } = useAnalysisUiState(
    w?.id,
    ws.sessions.map((session) => session.data.id),
  );
  const [reportState, setReportState] = useState<{
    workspaceId?: string;
    reports: Record<string, AnalysisUiRunReport>;
  }>({ reports: {} });
  const runReports = reportState.workspaceId === w?.id ? reportState.reports : {};
  const setRunReports = (
    update:
      | Record<string, AnalysisUiRunReport>
      | ((current: Record<string, AnalysisUiRunReport>) => Record<string, AnalysisUiRunReport>),
  ) =>
    setReportState((current) => ({
      workspaceId: w?.id,
      reports:
        typeof update === 'function'
          ? update(current.workspaceId === w?.id ? current.reports : {})
          : update,
    }));
  const [rightTab, setRightTab] = useState<NonNullable<Workspace['view']['rightTab']>>('inspect');
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'left' | 'right'>('graph');
  const [prefetchDepth, setPrefetchDepth] = useState<0 | 1 | 2>(0);
  const [editToken, setEditToken] = useState(0);
  const [editTarget, setEditTarget] = useState<'label' | 'tags' | 'icon'>('label');
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice || /partial|cancelled|could not/i.test(notice)) return;
    const timer = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState('');
  const [fitToken, setFitToken] = useState(0);
  const [tour, setTour] = useState<string>();
  const tourSteps = availableTourSteps(WORKBENCH_TOUR, {
    hasSelection: !!selectedId,
    hasTransactions: !!w && Object.keys(w.transactions).length > 0,
    features: [],
  });
  const tourStep =
    tour === undefined ? undefined : (tourSteps.find((step) => step.id === tour) ?? tourSteps[0]);
  // Tour previews never feed the persisted presentation effect or selection history.
  const shownLeftTab = tourStep?.view?.leftTab ?? leftTab;
  const shownRightTab =
    tourStep?.view?.rightTab ??
    ((rightTab === 'transactions' || rightTab === 'utxos') &&
    !w?.wallets.some((item) => item.id === selectedWallet)
      ? 'inspect'
      : rightTab);
  const shownMobilePanel = tourStep?.view?.panel ?? mobilePanel;
  const shownFocusGraph = tourStep ? false : focusGraph;
  const [live, setLive] = useState(false);
  const [pendingGraphWorkspace, setPendingGraphWorkspace] = useState<string>();
  const [scanLimit, setScanLimit] = useState(200);
  const [gap, setGap] = useState(20);
  const spendingOffsets = useRef(new Map<string, number>());
  const operationRef = useRef<AbortController | undefined>(undefined);
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
  wRef.current = w;
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
  const graph = useMemo(
    () => (w ? buildGraph(w) : { nodes: [], links: [] }),
    [w?.id, w?.transactions, w?.inputContext, w?.annotations, w?.findings, w?.view.showAddresses],
  );
  const walletMatches = useMemo(
    () => (w ? buildWalletMatches(w, graph) : new Map()),
    [w?.network, w?.transactions, w?.wallets, graph],
  );
  const tagIndex = useMemo(
    () => (w ? buildTagIndex(w, graph) : new Map<string, WorkspaceTag[]>()),
    [w?.tags, graph],
  );
  const nodePresentation = useMemo(() => {
    const presentation = new Map<string, NodePresentation>();
    if (!w) return presentation;
    const mode = w.view.highlightMode ?? 'all';
    for (const node of graph.nodes) {
      const tags = mode === 'all' || mode === 'tags' ? (tagIndex.get(node.id) ?? []) : [];
      const match = mode === 'all' || mode === 'wallets' ? walletMatches.get(node.id) : undefined;
      const walletColor = match
        ? w.wallets.find((wallet) => match.walletIds.includes(wallet.id))?.color
        : undefined;
      presentation.set(node.id, {
        color: tags.length || match ? (tags[0]?.color ?? walletColor) : undefined,
        highlight: tags.length || match ? true : undefined,
        tags: (tagIndex.get(node.id) ?? []).map((tag) => tag.name),
        label: w.annotations[node.id]?.label ?? '',
        icon: w.annotations[node.id]?.icon ?? '',
      });
    }
    return presentation;
  }, [w?.annotations, w?.wallets, w?.view.highlightMode, graph, walletMatches, tagIndex]);
  const effectiveFilters = useMemo(() => {
    if (graphFilters.walletId)
      return {
        ...graphFilters,
        includeIds: [...walletMatches]
          .filter(([, match]) => match.walletIds.includes(graphFilters.walletId!))
          .map(([id]) => id),
      };
    if (!graphFilters.tagId) return graphFilters;
    const tag = w?.tags?.find((tag) => tag.id === graphFilters.tagId);
    return { ...graphFilters, includeIds: tag ? tagNodeIds(tag, graph) : [] };
  }, [graphFilters, w?.tags, graph, walletMatches]);
  const automaticContextIds = useMemo(
    () => [
      ...new Set([...(w?.contextTransactionIds ?? []), ...Object.keys(w?.inputContext ?? {})]),
    ],
    [w?.contextTransactionIds, w?.inputContext],
  );
  const amountGraph = useMemo(
    () => filterSmallAmounts(graph, w?.view.smallAmountThreshold, selectedId, automaticContextIds),
    [graph, w?.view.smallAmountThreshold, selectedId, automaticContextIds],
  );
  const visibleGraph = useMemo(() => {
    const filtered = filterGraph(
      amountGraph,
      { ...effectiveFilters, showAddresses: w?.view.showAddresses },
      w?.annotations,
      { hiddenNodeIds: w?.view.hiddenNodeIds, mode: 'visible' },
    );
    return w?.view.smallAmountThreshold ||
      effectiveFilters.minSats !== undefined ||
      effectiveFilters.maxSats !== undefined
      ? omitAmountOrphans(filtered, selectedId)
      : filtered;
  }, [
    amountGraph,
    effectiveFilters,
    w?.view.smallAmountThreshold,
    w?.view.showAddresses,
    w?.view.hiddenNodeIds,
    w?.annotations,
    selectedId,
  ]);
  const hiddenIds = useMemo(() => new Set(w?.view.hiddenNodeIds ?? []), [w?.view.hiddenNodeIds]);
  // Address visibility is a canvas preference. Manually hidden addresses must
  // remain recoverable without enabling every address node in the renderer.
  const recoveryGraph = useMemo(() => {
    if (!w || w.view.showAddresses || !w.view.hiddenNodeIds?.some((id) => id.startsWith('addr:')))
      return graph;
    const expanded = buildGraph({ ...w, view: { ...w.view, showAddresses: true } });
    const nodes = expanded.nodes.filter(
      (node) => node.kind !== 'address' || hiddenIds.has(node.id),
    );
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      links: expanded.links.filter((link) => ids.has(link.source) && ids.has(link.target)),
    };
  }, [graph, hiddenIds, w?.view.showAddresses]);
  const hiddenCount = useMemo(
    () => recoveryGraph.nodes.filter((node) => hiddenIds.has(node.id)).length,
    [recoveryGraph, hiddenIds],
  );
  const visibleEntityCount = useMemo(
    () => graph.nodes.filter((node) => !hiddenIds.has(node.id)).length,
    [graph, hiddenIds],
  );
  const entityVisibility = w?.view.entityVisibility ?? 'visible';
  const entityGraph = useMemo(() => {
    if (entityVisibility === 'graph') return { ...visibleGraph, matchedNodes: visibleGraph.nodes };
    const source = entityVisibility === 'visible' ? graph : recoveryGraph;
    let filters = effectiveFilters;
    if (source !== graph && graphFilters.walletId && w) {
      filters = {
        ...effectiveFilters,
        includeIds: [...buildWalletMatches(w, source)]
          .filter(([, match]) => match.walletIds.includes(graphFilters.walletId!))
          .map(([id]) => id),
      };
    } else if (source !== graph && graphFilters.tagId) {
      const tag = w?.tags?.find((tag) => tag.id === graphFilters.tagId);
      filters = { ...effectiveFilters, includeIds: tag ? tagNodeIds(tag, source) : [] };
    }
    return filterGraph(
      source,
      { ...filters, showAddresses: entityVisibility === 'visible' ? w?.view.showAddresses : true },
      w?.annotations,
      { hiddenNodeIds: w?.view.hiddenNodeIds, mode: entityVisibility },
    );
  }, [
    graph,
    recoveryGraph,
    effectiveFilters,
    graphFilters.walletId,
    graphFilters.tagId,
    w?.wallets,
    w?.tags,
    w?.annotations,
    w?.view.showAddresses,
    w?.view.hiddenNodeIds,
    entityVisibility,
    visibleGraph,
  ]);
  const graphIds = useMemo(
    () => recoveryGraph.nodes.map((node) => node.id).join('|'),
    [recoveryGraph],
  );
  useEffect(() => {
    const available = new Set(recoveryGraph.nodes.map((node) => node.id));
    setNavigation((current) => {
      const ids = current.ids.filter((id) => available.has(id));
      if (ids.length === current.ids.length) return current;
      const index =
        current.ids.slice(0, current.index + 1).filter((id) => available.has(id)).length - 1;
      return { ids, index };
    });
    if (selectedId && !available.has(selectedId)) setSelectedId(undefined);
  }, [graphIds, selectedId]);
  const renderEntityMetadata = (id: string) => {
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
  };
  const selected = recoveryGraph.nodes.find((n) => n.id === selectedId);
  useLayoutEffect(() => {
    if (inspectorScroll.current) inspectorScroll.current.scrollTop = 0;
  }, [w?.id, selectedId, selectedWallet, rightTab]);
  const wallet = w?.wallets.find((x) => x.id === selectedWallet);
  const tx = selected?.txid ? w?.transactions[selected.txid] : undefined;
  const select = useCallback(
    (id: string) => {
      selectionGeneration.current++;
      const active = wRef.current;
      const target = /^(tx|out):([0-9a-f]{64})(?::([0-9]+))?$/.exec(id);
      const scope = target && active?.inputContext?.[target[2]];
      // An already visible input output stays compact. Opening its transaction or
      // a hidden sibling explicitly reveals the complete parent before selecting.
      if (active && target && scope && (target[1] === 'tx' || !scope.includes(Number(target[3]))))
        ws.update(active.id, (current) => promoteInputContext(current, [target[2]]), false);
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
      setRightTab('inspect');
    },
    [ws.update],
  );
  useEffect(() => {
    operationRef.current?.abort();
    setTour(undefined);
    setOperation('');
    setSelectedId(w?.view.selectionId);
    setSelectedWallet(w?.view.selectedWallet);
    setLeftTab(w?.view.leftTab ?? 'wallets');
    setRightTab(w?.view.rightTab ?? 'inspect');
    setMobilePanel(w?.view.mobilePanel ?? 'graph');
    setPrefetchDepth(w?.view.prefetchDepth ?? 0);
    setViewOwner(w?.id);
    setError('');
    setNotice('');
    setLive(false);
    setSettingsOpen(false);
    setExamplesOpen(false);
    setEntityRemoval(undefined);
    setEditToken(0);
    setQuery('');
    setFocusRequest(undefined);
    setGraphFilters(w?.view.filters ?? {});
    setNavigation(
      w?.view.selectionId ? { ids: [w.view.selectionId], index: 0 } : { ids: [], index: -1 },
    );
    setFocusGraph(w?.view.focusGraph ?? false);
    setRunReports({});
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
    (fn: (data: Workspace) => Workspace, undo = true, group?: string) => {
      if (w) ws.update(w.id, fn, undo, group);
    },
    [w, ws.update],
  );
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
      mobilePanel,
      focusGraph,
      prefetchDepth,
    };
    ws.update(
      w.id,
      (current) => {
        const nextView = { ...current.view, ...presentation };
        return JSON.stringify(current.view) === JSON.stringify(nextView)
          ? current
          : { ...current, view: nextView };
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
    mobilePanel,
    focusGraph,
    prefetchDepth,
  ]);
  const setEntityHidden = (ids: string[], hidden: boolean) => {
    try {
      change((current) => setNodesHidden(current, ids, hidden));
      if (hidden && selectedId && ids.includes(selectedId)) setFocusRequest(undefined);
      if (!hidden && !w?.view.showAddresses && ids.some((id) => id.startsWith('addr:')))
        setNotice(ADDRESS_DISPLAY_NOTICE);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Entity visibility could not be updated.');
    }
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
  const getTransaction = async (id: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!w) throw new Error('Open a workspace first.');
    if (w.demo) throw new Error('Live lookups are disabled for legacy synthetic workspaces.');
    return fetchTransaction(w.network, id, signal);
  };
  const flowInputs = useFlowInputs({
    workspace: w,
    selected,
    enabled: canTrace && !operation,
    fetch: getTransaction,
    update: ws.update,
  });
  const editNode = (id: string, target: 'label' | 'tags' | 'icon' = 'label') => {
    setEditTarget(target);
    setNotice('');
    select(id);
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
        const promoted = contextIds
          ? promoteInputContext(current, promotionIds)
          : clearContextProvenance(current, promotionIds);
        const merged = !transactions.length
          ? promoted
          : {
              ...promoted,
              transactions: {
                ...current.transactions,
                ...Object.fromEntries(
                  transactions.map((transaction) => [transaction.txid, transaction]),
                ),
              },
            };
        return contextIds ? markContextTransactions(merged, contextIds) : merged;
      },
      false,
    );
    return accepted;
  };
  function selectWalletRecord(nodeId: string, utxo?: WalletUtxoRecord) {
    if (!w || !wallet) return;
    const ownerId = w.id;
    const walletId = wallet.id;
    const tab = shownRightTab;
    const transactionId = nodeId.split(':')[1];
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const transaction =
        w.transactions[transactionId] ?? (await fetchTransaction(w.network, transactionId, signal));
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
      mergeTransactions(ownerId, [transaction]);
      ws.update(ownerId, (value) => setNodesHidden(value, [nodeId], false), false);
      select(nodeId);
      setRightTab(tab);
      setGraphFilters({});
      setFocusRequest({ id: nodeId, token: Date.now() });
    });
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    await addQuery(query.trim());
  }
  async function addQuery(text: string) {
    if (!w || !canQuery) return;
    if (!text) return;
    await run(async (signal) => {
      if (/^[0-9a-f]{64}(:\d+)?$/i.test(text)) {
        const [id, index] = text.split(':');
        setOperation('Loading transaction…');
        const t = await fetchTransaction(w.network, id, signal);
        if (index !== undefined && !t.vout.some((o) => o.n === Number(index)))
          throw new Error('This output index does not exist in the transaction.');
        signal.throwIfAborted();
        mergeTransactions(w.id, [t]);
        const requestedId =
          index === undefined ? txNodeId(t.txid) : outputNodeId(t.txid, Number(index));
        ws.update(w.id, (current) => setNodesHidden(current, [requestedId], false));
        select(requestedId);
        setGraphFilters({});
        setFocusRequest({ id: requestedId, token: Date.now() });
        setLeftTab('entities');
        if (prefetchDepth) {
          const before = ws.getSession(w.id)!.data;
          const result = await loadAncestors([t], before.transactions, prefetchDepth, {
            fetch: getTransaction,
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
            setNotice(ancestryNotice(result, before));
        }
      } else {
        setOperation('Discovering address history…');
        const result = await loadAddress(text, w.network, w.transactions, signal, (p) =>
          setOperation(p.message),
        );
        signal.throwIfAborted();
        ws.update(
          w.id,
          (c) => ({
            ...clearContextProvenance(c, result.observedTransactionIds),
            watchedAddresses: [...new Set([...c.watchedAddresses, text])],
            transactions: {
              ...c.transactions,
              ...Object.fromEntries(result.transactions.map((t) => [t.txid, t])),
            },
          }),
          false,
        );
        ws.update(w.id, (current) => setNodesHidden(current, [addressNodeId(text)], false));
        ws.update(
          w.id,
          (current) => ({ ...current, view: { ...current.view, showAddresses: true } }),
          false,
        );
        select(addressNodeId(text));
        setGraphFilters({});
        setFocusRequest({ id: addressNodeId(text), token: Date.now() });
        setLeftTab('entities');
        setNotice(
          result.truncated
            ? 'Partial address history: 500-transaction limit reached. Search again to load more.'
            : `Loaded ${result.transactions.length} transactions for this address.`,
        );
      }
      setQuery('');
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
      partial ||= !result.wallet.scanComplete;
    }
    return { snapshot, added, refreshed, partial, missing };
  }
  async function scan(target?: Wallet) {
    if (!w || !canQuery) return;
    await run(async (signal) => {
      const result = await refreshWallets(target ? [target] : w.wallets, w, signal);
      setNotice(
        `${target ? walletActivitySummary(result.snapshot.wallets.find((item) => item.id === target.id)!) : `${result.added} new to workspace · ${result.refreshed} transactions refreshed`}.${result.partial ? ' Partial scan: increase the address limit or refresh again to continue queued transactions.' : ` Gap limit reached on both branches (${gap} unused addresses).`}${result.missing ? ` ${result.missing} previously observed transactions absent from checked histories; saved graph retained.` : ''}`,
      );
      // Only the first discovery frames an empty canvas. Returning checks leave
      // the user's camera, selection, filters and annotations alone.
      if (!Object.keys(w.transactions).length && result.added) setFitToken((token) => token + 1);
    });
  }
  function showWalletActivity(target: Wallet) {
    const ids = new Set(target.unreviewedTransactionIds ?? []);
    updateFilters({
      includeIds: graph.nodes
        .filter((node) => node.txid && ids.has(node.txid))
        .map((node) => node.id),
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
  async function expand(direction: 'funding' | 'spending', nodeId = selectedId) {
    if (!w) return;
    const node = recoveryGraph.nodes.find((n) => n.id === nodeId);
    if (!node?.txid || node.kind === 'address') return;
    if (
      !canTrace &&
      !(direction === 'funding' && node.kind === 'output' && w.transactions[node.txid])
    )
      return;
    await run(async (signal) => {
      setOperation(
        direction === 'funding'
          ? 'Loading previous transactions…'
          : 'Checking outputs for spending transactions…',
      );
      const loaded = w.transactions[node.txid!];
      const traceSourceId = loaded ? txNodeId(node.txid!) : node.id;
      const transaction = loaded ?? (await getTransaction(node.txid!, signal));
      signal.throwIfAborted();
      if (!traceSourceExists(ws.getSession(w.id)!.data, traceSourceId)) return;
      if (direction === 'funding') {
        if (node.kind === 'output') {
          mergeTransactions(w.id, [transaction]);
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
          select(id);
          setGraphFilters({});
          setFocusRequest({ id, token: Date.now() });
          setNotice(
            'Creating transaction opened. Load its input details explicitly to trace further.',
          );
        } else if (!loaded) {
          signal.throwIfAborted();
          mergeTransactions(w.id, [transaction]);
          setNotice(
            'Creating transaction loaded. The output now has its value and script details. Trace again to load its previous inputs.',
          );
        } else {
          const before = ws.getSession(w.id)!.data;
          const result = await loadAncestors([transaction], before.transactions, 1, {
            signal,
            fetch: getTransaction,
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          if (
            mergeTransactions(
              w.id,
              result.transactions,
              result.resolvedTransactionIds,
              result.transactions.map((tx) => tx.txid),
              traceSourceId,
            )
          )
            setNotice(ancestryNotice(result, before));
        }
      } else {
        const outputIndex = node.kind === 'output' ? node.vout : undefined;
        const searchKey = `${transaction.txid}:${outputIndex ?? 'all'}`;
        const result = await loadSpending(
          transaction,
          w,
          outputIndex,
          signal,
          spendingOffsets.current.get(searchKey) ?? 0,
        );
        signal.throwIfAborted();
        const added = result.transactions.filter((t) => !w.transactions[t.txid]).length;
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
        if ('nextOffset' in result && result.nextOffset !== undefined)
          spendingOffsets.current.set(searchKey, result.nextOffset);
        else spendingOffsets.current.delete(searchKey);

        setNotice(
          `${result.transactions.length} spending transaction${result.transactions.length === 1 ? '' : 's'} found; ${added} added to the graph.${result.truncated ? ('nextOffset' in result && result.nextOffset !== undefined ? ' Partial search: click Find spending transactions again to check the next batch.' : ' Partial search: some output scripts could not be searched.') : ''}${!result.transactions.length ? ' No spending transaction found in the checked history; this does not prove the output is unspent.' : ''}`,
        );
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
        for (const address of current.watchedAddresses) {
          const result = await loadAddress(address, current.network, snapshot.transactions, signal);
          signal.throwIfAborted();
          mergeTransactions(current.id, result.transactions, result.observedTransactionIds);
          added += result.transactions.filter((tx) => !snapshot.transactions[tx.txid]).length;
          refreshed += result.transactions.filter((tx) => !!snapshot.transactions[tx.txid]).length;
          snapshot = {
            ...clearContextProvenance(snapshot, result.observedTransactionIds),
            transactions: {
              ...snapshot.transactions,
              ...Object.fromEntries(result.transactions.map((tx) => [tx.txid, tx])),
            },
          };
          partial ||= result.truncated;
        }
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
  const visibleAnalysisTxids = useMemo(
    () => [
      ...new Set(
        visibleGraph.nodes.flatMap((node) =>
          node.txid && w?.transactions[node.txid] ? [node.txid] : [],
        ),
      ),
    ],
    [visibleGraph.nodes, w?.transactions],
  );
  const entityNodes = entityGraph.matchedNodes;
  const bookmarks = Object.entries(w?.annotations ?? {}).filter(([, a]) => a.bookmarked);
  const analysisEvidence = useRef<{ transactions?: Workspace['transactions']; wallets: Wallet[] }>({
    wallets: [],
  });
  useEffect(() => {
    const previous = analysisEvidence.current;
    const next = { transactions: w?.transactions, wallets: w?.wallets ?? [] };
    if (
      previous.transactions !== next.transactions ||
      walletEvidenceChanged(previous.wallets, next.wallets)
    )
      setRunReports({});
    analysisEvidence.current = next;
  }, [w?.transactions, w?.wallets]);
  useEffect(() => {
    if (
      !w ||
      viewOwner !== w.id ||
      !w.view.lockToSelection ||
      !selectedId ||
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
    setFocusRequest({ id: selectedId, token: Date.now() });
  }, [w?.id, viewOwner, w?.view.lockToSelection, selectedId, hiddenIds]);
  function centerNode(id = selectedId, filters?: GraphFilters, showHidden = false) {
    if (!id) return;
    if (hiddenIds.has(id) && !showHidden) {
      setNotice('This entity is hidden from the graph. Show it in the inspector to center it.');
      return;
    }
    if (showHidden) change((current) => setNodesHidden(current, [id], false));
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
      setNotice('View filters cleared to reveal this selection.');
    }
    setMobilePanel('graph');
    setFocusRequest({ id, token: Date.now() });
  }
  function navigateSelection(delta: number) {
    const index = navigation.index + delta;
    const id = navigation.ids[index];
    if (!id) return;
    const filters: GraphFilters = graphFilters.focus
      ? { focus: { ...graphFilters.focus, id } }
      : {};
    setGraphFilters(filters);
    setNavigation({ ...navigation, index });
    setSelectedId(id);
    setRightTab('inspect');
    centerNode(id, filters);
  }
  function updateFilters(filters: GraphFilters) {
    setGraphFilters(filters);
    setFitToken((token) => token + 1);
  }
  function findingRun(
    id: string,
    options: AnalysisOptions = {},
    scope: 'graph' | 'selection' = 'graph',
  ) {
    if (!w) return;
    const tool = analysisTools.find((t) => t.id === id)!;
    const ids = scope === 'selection' ? (tx ? [tx.txid] : []) : visibleAnalysisTxids;
    try {
      const report = tool.analyze(w, ids, options);
      setRunReports((current) => ({
        ...current,
        [id]: {
          ...report,
          inputScope: scope,
          inputOptions: { ...defaultsFor(tool), ...options },
          runAt: new Date().toISOString(),
        },
      }));
      change((c) => ({
        ...c,
        findings: [
          ...c.findings.filter((finding) => !finding.algorithm.startsWith(id)),
          ...report.findings.map((finding) => {
            const previous = c.findings.find(
              (old) => old.id === finding.id && old.algorithm === finding.algorithm,
            );
            const sameEvidence =
              previous &&
              JSON.stringify([...previous.nodeIds].sort()) ===
                JSON.stringify([...finding.nodeIds].sort()) &&
              JSON.stringify([...previous.txids].sort()) ===
                JSON.stringify([...finding.txids].sort());
            return sameEvidence ? { ...finding, excluded: previous.excluded } : finding;
          }),
        ],
      }));
      setNotice(
        `${tool.name}: ${report.findings.length} findings. ${report.emptyReason ?? report.summary}`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Analysis failed.');
    }
  }
  const graphNavigation = w ? (
    <div className="graph-navigation" role="toolbar" aria-label="Graph navigation">
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
        <span className="graph-nav-caption">Center selection</span>
      </button>
      <button
        aria-label="Lock to selection"
        title="Keep the graph centered on selections from any panel"
        aria-pressed={w.view.lockToSelection ?? false}
        className={`graph-lock-selection ${w.view.lockToSelection ? 'active' : ''}`}
        onClick={() =>
          change(
            (current) => ({
              ...current,
              view: { ...current.view, lockToSelection: !current.view.lockToSelection },
            }),
            false,
          )
        }
      >
        <Focus size={14} />
        <span className="graph-nav-caption">Lock to selection</span>
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
      {Object.values(graphFilters).some((value) => value !== undefined) && (
        <button onClick={() => updateFilters({})} title="Clear active graph filters">
          All paths
        </button>
      )}
      <span className="view-summary">
        {graphFilters.walletId && (
          <span className="group-filter">
            Wallet:{' '}
            {w.wallets.find((wallet) => wallet.id === graphFilters.walletId)?.name ?? 'Removed'}
            <button className="text-button" onClick={() => updateFilters({})}>
              Clear
            </button>
          </span>
        )}
        {graphFilters.tagId && (
          <span className="group-filter">
            Tag: {w.tags?.find((tag) => tag.id === graphFilters.tagId)?.name ?? 'Removed'}
            <button className="text-button" onClick={() => updateFilters({})}>
              Clear
            </button>
          </span>
        )}
        {selected && !visibleGraph.nodes.some((node) => node.id === selected.id)
          ? hiddenIds.has(selected.id)
            ? ' · selection hidden from graph'
            : ' · selection hidden by filters'
          : ''}
      </span>
    </div>
  ) : null;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-workspace">
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
          <div className="workbench-toolbar">
            <div className="lookup-controls" data-tour="chain-lookup">
              <form className="search-form" onSubmit={search}>
                <Search size={17} />
                <input
                  ref={searchInput}
                  aria-label="Transaction, output, or address"
                  placeholder="Transaction ID, txid:vout, or Bitcoin address"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  spellCheck={false}
                />
                <button
                  type="submit"
                  className="search-go"
                  disabled={!canQuery || !!operation || !query.trim()}
                >
                  Add to graph <Plus size={14} />
                </button>
              </form>
              {!w.demo && (
                <label
                  className="lookup-prefetch"
                  title="Previous transaction levels for transaction/output lookups. Up to 500 downloads per action."
                >
                  <span>Previous</span>
                  <select
                    aria-label="Prefetch previous levels"
                    value={prefetchDepth}
                    onChange={(e) => setPrefetchDepth(Number(e.target.value) as 0 | 1 | 2)}
                  >
                    <option value={0}>Off</option>
                    <option value={1}>1 level</option>
                    <option value={2}>2 levels</option>
                  </select>
                </label>
              )}
            </div>
            <div className="workspace-actions" data-tour="workspace-actions">
              <button
                className="icon-button workspace-undo"
                aria-label="Undo workspace change"
                title="Undo label, analysis, or view change"
                disabled={!ws.active?.history.length || !!operation}
                onClick={() => ws.undo(w.id)}
              >
                <Undo2 size={17} />
              </button>
              <button
                className="export-button"
                onClick={() => void exportWorkspace()}
                disabled={!!operation}
              >
                <Download size={16} />
                <span>Export</span>
              </button>
              <button
                className="icon-button"
                aria-label="Workspace menu"
                onClick={() => setMenu(!menu)}
              >
                <Ellipsis size={20} />
              </button>
              {menu && (
                <div className="dropdown">
                  <button
                    className="mobile-workspace-undo"
                    aria-label="Undo workspace change"
                    disabled={!ws.active?.history.length || !!operation}
                    onClick={() => {
                      setMenu(false);
                      ws.undo(w.id);
                    }}
                  >
                    <Undo2 size={15} /> Undo workspace change
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
                    Export labels · plaintext
                  </button>
                  <button
                    onClick={() => {
                      setMenu(false);
                      operationRef.current?.abort();
                      flushActiveGraph();
                      void ws.lock(w.id).catch((e) => setError(e.message));
                    }}
                  >
                    <LockKeyhole size={15} />
                    Lock workspace
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mobile-switch">
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
              {shownRightTab === 'analysis'
                ? 'Analysis'
                : shownRightTab === 'transactions'
                  ? 'Transactions'
                  : shownRightTab === 'utxos'
                    ? 'UTXOs'
                    : 'Inspector'}
            </button>
          </div>
          <main
            id="main-workspace"
            tabIndex={-1}
            className={`workbench show-${shownMobilePanel} ${shownFocusGraph ? 'focus-graph' : ''}`}
          >
            <WorkspacePanel
              w={w}
              transactions={w.transactions}
              removableNodeIds={removableNodeIds}
              onRemoveNode={requestEntityRemoval}
              tagsPanel={
                <TagsPanel
                  key={w.id}
                  workspace={w}
                  graph={graph}
                  selected={selected}
                  onChange={changeTags}
                  onSelect={(id) => {
                    select(id);
                    setMobilePanel('right');
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
                setMobilePanel('right');
              }}
              onAddWallet={() => setWalletDialog(true)}
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
              entityFilter={graphFilters.query ?? ''}
              setEntityFilter={(query) => updateFilters({ ...graphFilters, query })}
              entityKind={graphFilters.kind ?? 'all'}
              setEntityKind={(kind) =>
                updateFilters({ ...graphFilters, kind: kind as GraphFilters['kind'] })
              }
              graphFilters={graphFilters}
              onGraphFiltersChange={updateFilters}
              entityTotalCount={
                entityVisibility === 'hidden'
                  ? hiddenCount
                  : entityVisibility === 'visible'
                    ? visibleEntityCount
                    : recoveryGraph.nodes.length
              }
              contextCount={entityVisibility === 'visible' ? visibleGraph.contextNodeIds.length : 0}
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
              bookmarks={bookmarks}
            />
            <section className="graph-stage" data-tour="graph-stage" aria-label="Graph workspace">
              <div className="graph-stage-content">
                {viewOwner === w.id && (
                  <TransactionView
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
                        (current) => ({ ...current, view: { ...current.view, transactionFlow } }),
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
                    selected={selected}
                    hiddenNodeIds={w.view.hiddenNodeIds}
                    onSetHidden={setEntityHidden}
                    {...flowInputs}
                    onSelect={select}
                    onEdit={editNode}
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
                      onChange={(update) =>
                        change((current) => ({ ...current, view: update(current.view) }), false)
                      }
                      onFit={() => setFitToken((token) => token + 1)}
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
                        legend={
                          <GraphLegend
                            dimensions={w.view.dimensions}
                            showAddresses={w.view.showAddresses}
                            demo={w.demo}
                          />
                        }
                        toolbar={
                          <GraphControls
                            smallAmountHiddenCount={amountGraph.hiddenCount}
                            view={w.view}
                            focusGraph={shownFocusGraph}
                            onToggleFocus={() => setFocusGraph((value) => !value)}
                            onChange={(update) =>
                              change(
                                (current) => ({ ...current, view: update(current.view) }),
                                false,
                              )
                            }
                            onFit={() => setFitToken((token) => token + 1)}
                          />
                        }
                        nodePresentation={nodePresentation}
                        renderMetadata={renderEntityMetadata}
                        nodes={visibleGraph.nodes}
                        links={visibleGraph.links}
                        focusRequest={focusRequest}
                        selectedId={selectedId}
                        onSelect={select}
                        hiddenNodeIds={w.view.hiddenNodeIds}
                        onSetHidden={setEntityHidden}
                        dimensions={w.view.dimensions}
                        sizeBy={w.view.sizeBy}
                        glow={w.view.glow}
                        showLabels={w.view.showLabels ?? true}
                        showTags={w.view.showTags ?? true}
                        showIcons={w.view.showIcons ?? true}
                        fitToken={fitToken}
                        transactions={w.transactions}
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
                        {hiddenCount === graph.nodes.length
                          ? 'All entities are hidden'
                          : 'No visible nodes match these filters'}
                      </h3>
                      <p>Hidden entities remain saved and can be inspected in the entity list.</p>
                      <div className="button-row">
                        {!!Object.keys(graphFilters).length && (
                          <button onClick={() => updateFilters({})}>Clear filters</button>
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
            <aside className="right-panel" data-tour="analysis-panel">
              <div className={`panel-tabs ${wallet ? 'has-wallet-tabs' : ''}`}>
                <button
                  className={shownRightTab === 'inspect' ? 'active' : ''}
                  onClick={() => setRightTab('inspect')}
                >
                  Inspector
                </button>
                <button
                  className={shownRightTab === 'analysis' ? 'active' : ''}
                  onClick={() => setRightTab('analysis')}
                >
                  Analysis <span>{w.findings.length}</span>
                </button>
                {wallet && (
                  <>
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
                {wallet && (
                  <WalletRecordsPanel
                    key={`${w.id}:${wallet.id}`}
                    workspace={w}
                    wallet={wallet}
                    active={
                      shownRightTab === 'transactions' || shownRightTab === 'utxos'
                        ? shownRightTab
                        : undefined
                    }
                    canQuery={canQuery}
                    busy={!!operation}
                    selectedId={selectedId}
                    onSelect={selectWalletRecord}
                  />
                )}
                {shownRightTab === 'transactions' ||
                shownRightTab === 'utxos' ? null : shownRightTab === 'analysis' ? (
                  <AnalysisPanel
                    uiState={analysisUiState}
                    onUiStateChange={updateAnalysisUiState}
                    findings={w.findings}
                    hasNodes={!!visibleGraph.nodes.length}
                    selectedTxids={tx ? [tx.txid] : []}
                    graphTxids={visibleAnalysisTxids}
                    runReports={runReports}
                    onIsolate={(ids) => {
                      updateFilters({ includeIds: ids, preserveContext: true });
                      setMobilePanel('graph');
                    }}
                    busy={!!operation}
                    onRun={findingRun}
                    onSelect={select}
                    onClear={() => change((c) => ({ ...c, findings: [] }))}
                    onFocus={(id) => {
                      select(id);
                      setRightTab('analysis');
                      centerNode(id);
                    }}
                    onToggle={(id) =>
                      change((c) => ({
                        ...c,
                        findings: c.findings.map((f) =>
                          f.id === id ? { ...f, excluded: !f.excluded } : f,
                        ),
                      }))
                    }
                  />
                ) : wallet && !selected && tourStep?.view?.rightTab !== 'inspect' ? (
                  <WalletInspector
                    wallet={wallet}
                    workspace={w}
                    busy={!!operation}
                    canQuery={canQuery}
                    onScan={() => void scan(wallet)}
                    onShowActivity={() => showWalletActivity(wallet)}
                    onShowWallet={() => {
                      updateFilters({ walletId: wallet.id, preserveContext: true });
                      setMobilePanel('graph');
                    }}
                    onRemove={() => {
                      change((c) => ({
                        ...c,
                        wallets: c.wallets.filter((x) => x.id !== wallet.id),
                      }));
                      setSelectedWallet(undefined);
                    }}
                  />
                ) : selected ? (
                  <NodeInspector
                    tagsPanel={
                      <SelectedTags
                        key={selected.id}
                        workspace={w}
                        selected={selected}
                        openToken={editTarget === 'tags' ? editToken : 0}
                        onOpenHandled={() => setEditToken(0)}
                        graph={graph}
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
                    onSelectNode={select}
                    onCenter={() => centerNode()}
                    onShowAndCenter={() => centerNode(selected.id, undefined, true)}
                    hiddenNodeIds={w.view.hiddenNodeIds}
                    onSetHidden={setEntityHidden}
                    annotationKey={`${w.id}:${selected.id}`}
                    onExpand={(direction) => void expand(direction)}
                    onRefresh={() =>
                      void run(async (signal) => {
                        const transaction = await getTransaction(selected.txid!, signal);
                        signal.throwIfAborted();
                        mergeTransactions(w.id, [transaction]);
                        setNotice('Transaction refreshed from your node.');
                      })
                    }
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
                    <button className="text-button" onClick={() => setRightTab('analysis')}>
                      Explore analysis tools <ChevronRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </main>
          <footer className="statusbar">
            <span>
              {operation ? (
                <>
                  <LoaderCircle className="spin" size={13} />
                  {operation}
                  <button onClick={() => operationRef.current?.abort()}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="status-dot" />
                  {graph.nodes.length.toLocaleString()} nodes
                  <span className="status-separator">/</span>
                  {graph.links.length.toLocaleString()} connections
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
                  setNotice('Address display enabled. Other graph filters still apply.');
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
          onUnlock={async (entry, password) => {
            await saveBeforeLeaving();
            const current = ws.getSaved(entry.id);
            if (!current) throw new Error('Saved workspace changed; reload before unlocking.');
            return ws.unlock(current, password);
          }}
          onClose={() => setUnlock(undefined)}
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
        <GuidedTour steps={tourSteps} activeId={tour} onStepChange={setTour} />
      )}
    </div>
  );
}
