import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
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
  Maximize2,
  Minimize2,
  Info,
  CircleHelp,
  Download,
  Ellipsis,
  Expand,
  Eye,
  FolderOpen,
  GitBranch,
  Layers,
  List,
  LoaderCircle,
  LockKeyhole,
  Network as NetworkIcon,
  Plus,
  Search,
  Sparkles,
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
import { emptyAnnotation, NodeInspector, WalletInspector } from './components/Inspector';
import { AboutDialog } from './components/AboutDialog';
import { filterGraph, type GraphFilters } from './domain/graphFilters';
import { AnalysisPanel } from './components/AnalysisPanel';
import { WorkspaceHome } from './components/WorkspaceHome';
import { WorkspacePanel } from './components/WorkspacePanel';
import { GuidedTour } from './components/GuidedTour';
import { buildGraph, parseWorkspace } from './domain/workspace';
import { analysisTools, type AnalysisOptions } from './domain/analysis';
import {
  outputNodeId,
  txNodeId,
  type Transaction,
  type Wallet,
  type Workspace,
} from './domain/types';
import {
  backendStatus,
  fetchTransaction,
  loadAddress,
  loadSpending,
  scanWallet,
  type BackendStatus,
} from './lib/api';
import { loadAncestors } from './lib/tracing';
import { demoWorkspace } from './domain/demo';
import { TESTNET4_EXAMPLES } from './domain/examples';
import { encryptWorkspace, MAX_ENCRYPTED_FILE_BYTES } from './lib/crypto';
import { exportLabels, importLabels } from './lib/labels';
import { useWorkspaces, type SavedWorkspace } from './lib/useWorkspaces';

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
  const [status, setStatus] = useState<BackendStatus>();
  const [statusError, setStatusError] = useState('');
  const [create, setCreate] = useState<'empty' | 'demo'>();
  const [unlock, setUnlock] = useState<SavedWorkspace>();
  const [walletDialog, setWalletDialog] = useState(false);
  const [fileDialog, setFileDialog] = useState<File>();
  const [menu, setMenu] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedWallet, setSelectedWallet] = useState<string>();
  const [leftTab, setLeftTab] = useState<'wallets' | 'entities' | 'bookmarks'>('wallets');
  const [graphFilters, setGraphFilters] = useState<GraphFilters>({});
  const [navigation, setNavigation] = useState<{ ids: string[]; index: number }>({
    ids: [],
    index: -1,
  });
  const [focusGraph, setFocusGraph] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number }>();
  const [aboutOpen, setAboutOpen] = useState<false | 'guide' | 'about' | 'connection'>(false);
  const [connectionCheck, setConnectionCheck] = useState(0);
  const [deleteEntry, setDeleteEntry] = useState<SavedWorkspace>();
  const [runReports, setRunReports] = useState<
    Record<string, ReturnType<(typeof analysisTools)[number]['analyze']>>
  >({});
  const [rightTab, setRightTab] = useState<'inspect' | 'analysis'>('inspect');
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'left' | 'right'>('graph');
  const [prefetchDepth, setPrefetchDepth] = useState<0 | 1 | 2>(0);
  const [editToken, setEditToken] = useState(0);
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
  const [tour, setTour] = useState<number>();
  const [live, setLive] = useState(false);
  const [scanLimit, setScanLimit] = useState(200);
  const [gap, setGap] = useState(20);
  const spendingOffsets = useRef(new Map<string, number>());
  const operationRef = useRef<AbortController | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const labelsInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const wRef = useRef(w);
  wRef.current = w;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const current = wRef.current;
      if (event.key.toLowerCase() === 's' && current) {
        event.preventDefault();
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
  }, [ws.persist]);
  const graph = useMemo(() => (w ? buildGraph(w) : { nodes: [], links: [] }), [w]);
  const visibleGraph = useMemo(
    () =>
      filterGraph(graph, { ...graphFilters, showAddresses: w?.view.showAddresses }, w?.annotations),
    [graph, graphFilters, w?.view.showAddresses, w?.annotations],
  );
  useEffect(() => {
    const available = new Set(graph.nodes.map((node) => node.id));
    setNavigation((current) => {
      const ids = current.ids.filter((id) => available.has(id));
      if (ids.length === current.ids.length) return current;
      const index =
        current.ids.slice(0, current.index + 1).filter((id) => available.has(id)).length - 1;
      return { ids, index };
    });
    if (selectedId && !available.has(selectedId)) setSelectedId(undefined);
  }, [graph.nodes, selectedId]);
  const selected = graph.nodes.find((n) => n.id === selectedId);
  const wallet = w?.wallets.find((x) => x.id === selectedWallet);
  const tx = selected?.txid ? w?.transactions[selected.txid] : undefined;
  const select = useCallback((id: string) => {
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
    setSelectedWallet(undefined);
    setRightTab('inspect');
  }, []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const refresh = () =>
      backendStatus(controller.signal)
        .then((s) => {
          if (!disposed) {
            setStatus(s);
            setStatusError('');
          }
        })
        .catch(() => {
          if (!disposed) setStatusError('Backend unavailable');
        });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [connectionCheck]);
  useEffect(() => {
    operationRef.current?.abort();
    setOperation('');
    setSelectedId(undefined);
    setSelectedWallet(undefined);
    setError('');
    setNotice('');
    setLive(false);
    setSettingsOpen(false);
    setExamplesOpen(false);
    setEditToken(0);
    setQuery('');
    setFocusRequest(undefined);
    setGraphFilters({});
    setNavigation({ ids: [], index: -1 });
    setFocusGraph(false);
    setRunReports({});
    spendingOffsets.current.clear();
    setFitToken((t) => t + 1);
  }, [ws.activeId]);
  useEffect(() => {
    if (!w) return;
    try {
      if (!localStorage.getItem('chaingraph.tour.seen')) {
        setTour(0);
        localStorage.setItem('chaingraph.tour.seen', '1');
      }
    } catch {
      // A denied/full store must not crash an unlocked workspace or block export.
      setTour(0);
    }
  }, [w?.id]);
  useEffect(() => {
    if (tour === undefined) return;
    if (tour === 1) setMobilePanel('left');
    else if (tour === 2) setMobilePanel('graph');
    else if (tour === 3) {
      setMobilePanel('right');
      setRightTab('analysis');
    }
  }, [tour]);
  const change = useCallback(
    (fn: (data: Workspace) => Workspace, undo = true) => {
      if (w) ws.update(w.id, fn, undo);
    },
    [w, ws.update],
  );
  const connected = !!status?.connected && !statusError;
  const canQuery = connected && w?.network === status?.network && !w?.demo;
  const queryDisabledReason = w?.demo
    ? undefined
    : !connected
      ? 'Connect your backend to load chain data.'
      : w?.network !== status?.network
        ? `This workspace uses ${w?.network}; the backend serves ${status?.network}.`
        : undefined;
  const canTrace = !!w?.demo || canQuery;
  const fixture = useMemo(() => (w?.demo ? demoWorkspace().transactions : undefined), [w?.demo]);
  const getTransaction = async (id: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!fixture) return fetchTransaction(id, signal);
    const transaction = fixture[id];
    if (!transaction)
      throw new Error('This transaction is outside the synthetic laboratory fixture.');
    return transaction;
  };
  const editNode = (id: string) => {
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
  const mergeTransactions = (id: string, transactions: Transaction[]) => {
    if (!transactions.length) return;
    ws.update(
      id,
      (current) => ({
        ...current,
        transactions: {
          ...current.transactions,
          ...Object.fromEntries(transactions.map((t) => [t.txid, t])),
        },
      }),
      false,
    );
  };
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
        const t = await fetchTransaction(id, signal);
        if (index !== undefined && !t.vout.some((o) => o.n === Number(index)))
          throw new Error('This output index does not exist in the transaction.');
        signal.throwIfAborted();
        mergeTransactions(w.id, [t]);
        select(index === undefined ? txNodeId(t.txid) : outputNodeId(t.txid, Number(index)));
        setLeftTab('entities');
        if (prefetchDepth) {
          const result = await loadAncestors([t], w.transactions, prefetchDepth, {
            signal,
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          mergeTransactions(w.id, result.transactions);
          setNotice(ancestryNotice(result));
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
            ...c,
            watchedAddresses: [...new Set([...c.watchedAddresses, text])],
            transactions: {
              ...c.transactions,
              ...Object.fromEntries(result.transactions.map((t) => [t.txid, t])),
            },
          }),
          false,
        );
        setNotice(
          result.truncated
            ? 'Partial address history: 500-transaction limit reached. Search again to load more.'
            : `Loaded ${result.transactions.length} transactions for this address.`,
        );
      }
      setQuery('');
      setFitToken((t) => t + 1);
    });
  }
  async function scan(target: Wallet) {
    if (!w) return;
    await run(async (signal) => {
      setOperation(`Scanning ${target.name}…`);
      const result = await scanWallet(target, w.network, w.transactions, {
        gap,
        maxIndex: scanLimit,
        signal,
        onProgress: (p) => setOperation(p.message),
      });
      signal.throwIfAborted();
      ws.update(
        w.id,
        (c) => ({
          ...c,
          wallets: c.wallets.map((x) =>
            x.id === target.id
              ? {
                  ...x,
                  addresses: result.wallet.addresses,
                  scannedAt: result.wallet.scannedAt,
                  scanComplete: result.wallet.scanComplete,
                  scanLimit: result.wallet.scanLimit,
                  pendingTransactionIds: result.wallet.pendingTransactionIds,
                }
              : x,
          ),
          transactions: {
            ...c.transactions,
            ...Object.fromEntries(result.transactions.map((t) => [t.txid, t])),
          },
        }),
        false,
      );
      setNotice(
        result.wallet.scanComplete
          ? `Scan complete within the ${gap}-address gap assumption. ${result.transactions.length} transactions loaded.`
          : `Partial scan: reached an address or transaction limit. Increase the address limit or scan again to continue.`,
      );
      setFitToken((t) => t + 1);
    });
  }
  function ancestryNotice(result: Awaited<ReturnType<typeof loadAncestors>>) {
    return `${result.transactions.length} previous transactions added.${result.truncated ? ' Partial expansion: 500-transaction limit reached. Trace individual paths to continue.' : ''}${result.failed ? ` ${result.failed} transactions could not be loaded. Retry the path to continue.` : ''}${!result.transactions.length && !result.failed && !result.truncated ? ' Previous transactions are already loaded, or this is a coinbase transaction with no previous inputs.' : ''}`;
  }
  async function expand(direction: 'funding' | 'spending', nodeId = selectedId) {
    if (!w || !canTrace) return;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node?.txid || node.kind === 'address') return;
    await run(async (signal) => {
      setOperation(
        direction === 'funding'
          ? 'Loading previous transactions…'
          : 'Checking outputs for spending transactions…',
      );
      const loaded = w.transactions[node.txid!];
      const transaction = loaded ?? (await getTransaction(node.txid!, signal));
      if (direction === 'funding') {
        if (!loaded) {
          signal.throwIfAborted();
          mergeTransactions(w.id, [transaction]);
          setNotice(
            'Creating transaction loaded. The output now has its value and script details. Trace again to load its previous inputs.',
          );
        } else {
          const result = await loadAncestors([transaction], w.transactions, 1, {
            signal,
            fetch: getTransaction,
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          mergeTransactions(w.id, result.transactions);
          setNotice(ancestryNotice(result));
        }
      } else {
        const outputIndex = node.kind === 'output' ? node.vout : undefined;
        const searchKey = `${transaction.txid}:${outputIndex ?? 'all'}`;
        const result = fixture
          ? {
              transactions: Object.values(fixture).filter((t) =>
                t.vin.some(
                  (input) =>
                    input.txid === transaction.txid &&
                    (outputIndex === undefined || input.vout === outputIndex),
                ),
              ),
              truncated: false,
            }
          : await loadSpending(
              transaction,
              w,
              outputIndex,
              signal,
              spendingOffsets.current.get(searchKey) ?? 0,
            );
        signal.throwIfAborted();
        const added = result.transactions.filter((t) => !w.transactions[t.txid]).length;
        mergeTransactions(w.id, [...(!loaded ? [transaction] : []), ...result.transactions]);
        if ('nextOffset' in result && result.nextOffset !== undefined)
          spendingOffsets.current.set(searchKey, result.nextOffset);
        else spendingOffsets.current.delete(searchKey);

        setNotice(
          `${result.transactions.length} spending transaction${result.transactions.length === 1 ? '' : 's'} found; ${added} added to the graph.${result.truncated ? ('nextOffset' in result && result.nextOffset !== undefined ? ' Partial search: click Find spending transactions again to check the next batch.' : ' Partial search: some output scripts could not be searched.') : ''}${!result.transactions.length ? ' No spending transaction found in the checked history; this does not prove the output is unspent.' : ''}${fixture ? ' Searched the synthetic fixture only.' : ''}`,
        );
      }
      setFitToken((t) => t + 1);
    });
  }
  async function exportWorkspace() {
    if (!ws.active) return;
    await run(async () => {
      setOperation('Encrypting workspace export…');
      parseWorkspace(ws.active!.data, false);
      const envelope = await encryptWorkspace(ws.active!.data, ws.active!.password);
      download(
        `${ws.active!.data.name.replace(/[^a-z0-9_-]/gi, '-')}.chaingraph`,
        JSON.stringify(envelope),
      );
      setNotice('Encrypted workspace exported. Keep the file and password safe.');
    });
  }
  // Poll from the client, only while this workspace is unlocked. Backend never owns scan state.
  useEffect(() => {
    if (!live || !canQuery || !w) return;
    const timer = setInterval(() => {
      if (operationRef.current) return;
      const current = wRef.current;
      if (!current) return;
      void run(async (signal) => {
        setOperation('Checking watched activity…');
        let added = 0;
        let partial = false;
        for (const target of current.wallets) {
          const result = await scanWallet(target, current.network, current.transactions, {
            gap,
            maxIndex: scanLimit,
            signal,
          });
          signal.throwIfAborted();
          ws.update(
            current.id,
            (c) => ({
              ...c,
              wallets: c.wallets.map((x) =>
                x.id === target.id
                  ? {
                      ...x,
                      addresses: result.wallet.addresses,
                      scannedAt: result.wallet.scannedAt,
                      scanComplete: result.wallet.scanComplete,
                      scanLimit: result.wallet.scanLimit,
                      pendingTransactionIds: result.wallet.pendingTransactionIds,
                    }
                  : x,
              ),
              transactions: {
                ...c.transactions,
                ...Object.fromEntries(result.transactions.map((t) => [t.txid, t])),
              },
            }),
            false,
          );
          added += result.transactions.length;
          partial ||= !result.wallet.scanComplete;
        }
        for (const address of current.watchedAddresses) {
          const result = await loadAddress(address, current.network, current.transactions, signal);
          signal.throwIfAborted();
          mergeTransactions(current.id, result.transactions);
          added += result.transactions.length;
          partial ||= result.truncated;
        }
        setNotice(
          `Activity check finished · ${added} transactions loaded or refreshed.${partial ? ' Some history remains partial; review scan limits.' : ''}`,
        );
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [live, canQuery, w?.id, gap, scanLimit]);
  const entityNodes = visibleGraph.matchedNodes;
  const bookmarks = Object.entries(w?.annotations ?? {}).filter(([, a]) => a.bookmarked);
  useEffect(() => setRunReports({}), [w?.transactions, w?.wallets]);
  function centerNode(id = selectedId, filters?: GraphFilters) {
    if (!id) return;
    const rendered = filters
      ? filterGraph(graph, { ...filters, showAddresses: w?.view.showAddresses }, w?.annotations)
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
    setSelectedWallet(undefined);
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
    const ids =
      scope === 'selection'
        ? tx
          ? [tx.txid]
          : []
        : [
            ...new Set(
              visibleGraph.nodes.flatMap((node) =>
                node.txid && w.transactions[node.txid] ? [node.txid] : [],
              ),
            ),
          ];
    try {
      const report = tool.analyze(w, ids, options);
      setRunReports((current) => ({ ...current, [id]: report }));
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
            if (w) ws.setActiveId(undefined);
          }}
          aria-label="Chaingraph home"
        >
          <NetworkIcon size={23} />
          <span>
            chaingraph<span className="wordmark-dot">.</span>
          </span>
        </a>
        <div className="top-context">Wallet analysis workbench</div>
        <button
          onClick={() => setAboutOpen('connection')}
          aria-label="Connection details"
          className={`connection connection-action ${connected ? 'online' : ''}`}
          title={status?.error || statusError || 'Your self-hosted backend'}
        >
          <span className="status-dot" />
          {connected
            ? `${status?.network} · ${status?.height?.toLocaleString() ?? 'connected'}`
            : 'Offline'}
          <span className="connection-caption"> / own node</span>
        </button>
        <button
          className="icon-button"
          title="Guided tour"
          aria-label="Help and guided tour"
          onClick={() => (w ? setTour(0) : setAboutOpen('guide'))}
        >
          <CircleHelp size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="About Chaingraph"
          title={`Chaingraph ${__APP_VERSION__}`}
          onClick={() => setAboutOpen('about')}
        >
          <Info size={18} />
        </button>
      </header>
      <nav className="workspace-tabs" data-tour="workspace-tabs" aria-label="Open workspaces">
        <button
          className={!w ? 'home-tab active' : 'home-tab'}
          onClick={() => ws.setActiveId(undefined)}
        >
          <FolderOpen size={15} />
          <span>Workspaces</span>
        </button>
        {ws.sessions.map((s) => (
          <button
            className={`workspace-tab ${s.data.id === w?.id ? 'active' : ''}`}
            key={s.data.id}
            onClick={() => ws.setActiveId(s.data.id)}
          >
            <span className="tab-network">{s.data.network === 'mainnet' ? 'M' : 'T'}</span>
            <span>{s.data.name}</span>
            {s.revision !== s.savedRevision && (
              <span aria-label="Unsaved changes" className="dirty-dot">
                ●
              </span>
            )}
            <LockKeyhole size={12} />
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
      {!w ? (
        <WorkspaceHome
          saved={ws.saved}
          sessions={ws.sessions}
          onCreate={() => setCreate('empty')}
          onDemo={() => setCreate('demo')}
          onOpenFile={() => fileInput.current?.click()}
          onActivate={ws.setActiveId}
          onUnlock={setUnlock}
          onDelete={setDeleteEntry}
        />
      ) : (
        <>
          <div className="workbench-toolbar">
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
            <div className="workspace-actions">
              <button
                className="icon-button"
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
                      void ws.lock(w.id).catch((e) => setError(e.message));
                    }}
                  >
                    <LockKeyhole size={15} />
                    Save and lock workspace
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="trace-options">
            {w.demo ? (
              <>
                <span>Practice tracing the synthetic CoinJoins:</span>
                <button
                  disabled={!!operation}
                  onClick={() => {
                    mergeTransactions(w.id, Object.values(fixture!));
                    setFitToken((t) => t + 1);
                  }}
                >
                  Show all fixture paths
                </button>
                <button
                  disabled={!!operation}
                  onClick={() => {
                    change((c) => ({
                      ...c,
                      transactions: demoWorkspace(false).transactions,
                      findings: [],
                    }));
                    setSelectedId(undefined);
                    setFitToken((t) => t + 1);
                  }}
                >
                  Reset practice paths
                </button>
              </>
            ) : (
              <>
                <label>
                  Prefetch previous
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
                <span className="small muted">
                  For transaction and output lookups · up to 500 previous transactions
                </span>
                <button onClick={() => setExamplesOpen(true)}>Testnet4 examples</button>
              </>
            )}
          </div>
          <div className="mobile-switch">
            <button
              className={mobilePanel === 'left' ? 'active' : ''}
              onClick={() => setMobilePanel('left')}
            >
              <WalletIcon size={15} />
              Wallets
            </button>
            <button
              className={mobilePanel === 'graph' ? 'active' : ''}
              onClick={() => setMobilePanel('graph')}
            >
              <GitBranch size={15} />
              Graph
            </button>
            <button
              className={mobilePanel === 'right' ? 'active' : ''}
              onClick={() => setMobilePanel('right')}
            >
              <List size={15} />
              Inspector
            </button>
          </div>
          <div className="graph-navigation" aria-label="Graph navigation">
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
            <button disabled={!selected} onClick={() => centerNode()}>
              <Crosshair size={14} />
              Center selection
            </button>
            <label>
              Paths
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
                <option value={0}>All neighborhoods</option>
                <option value={1}>1 connection from selection</option>
                <option value={2}>2 connections from selection</option>
              </select>
            </label>
            <button onClick={() => updateFilters({})} disabled={!Object.keys(graphFilters).length}>
              All paths
            </button>
            <button
              aria-pressed={focusGraph}
              onClick={() => {
                setFocusGraph(!focusGraph);
                setMobilePanel('graph');
              }}
            >
              {focusGraph ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {focusGraph ? 'Show panels' : 'Focus graph'}
            </button>
            <span className="view-summary">
              {visibleGraph.nodes.length.toLocaleString()} / {graph.nodes.length.toLocaleString()}{' '}
              nodes visible
              {visibleGraph.contextNodeIds.length
                ? ` · ${visibleGraph.contextNodeIds.length} context`
                : ''}
              {selected && !visibleGraph.nodes.some((node) => node.id === selected.id)
                ? ' · selection hidden by filters'
                : ''}
            </span>
          </div>
          <main
            id="main-workspace"
            tabIndex={-1}
            className={`workbench show-${mobilePanel} ${focusGraph ? 'focus-graph' : ''}`}
          >
            <WorkspacePanel
              w={w}
              leftTab={leftTab}
              setLeftTab={setLeftTab}
              selectedWalletId={wallet?.id}
              selectedId={selectedId}
              onSelectWallet={(id) => {
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
              entityTotalCount={graph.nodes.length}
              contextCount={visibleGraph.contextNodeIds.length}
              entityNodes={entityNodes}
              bookmarks={bookmarks}
            />
            <section className="graph-stage" data-tour="graph-stage" aria-label="Graph workspace">
              <div className="graph-controls">
                <div className="view-toggle">
                  <button
                    className={w.view.dimensions === 3 ? 'active' : ''}
                    onClick={() =>
                      change((c) => ({
                        ...c,
                        view: { ...c.view, dimensions: 3 },
                      }))
                    }
                  >
                    3D
                  </button>
                  <button
                    className={w.view.dimensions === 2 ? 'active' : ''}
                    onClick={() =>
                      change((c) => ({
                        ...c,
                        view: { ...c.view, dimensions: 2 },
                      }))
                    }
                  >
                    Flat
                  </button>
                </div>
                <label className="size-control">
                  <span>Size by</span>
                  <select
                    aria-label="Size nodes by"
                    value={w.view.sizeBy}
                    onChange={(e) =>
                      change((c) => ({
                        ...c,
                        view: {
                          ...c.view,
                          sizeBy: e.target.value as Workspace['view']['sizeBy'],
                        },
                      }))
                    }
                  >
                    <option value="uniform">Uniform</option>
                    <option value="value">Value</option>
                    <option value="degree">Connections</option>
                  </select>
                </label>
                <button
                  className={`icon-button ${w.view.glow ? 'active' : ''}`}
                  title="Toggle highlight glow"
                  aria-label="Toggle highlight glow"
                  onClick={() =>
                    change((c) => ({
                      ...c,
                      view: { ...c.view, glow: !c.view.glow },
                    }))
                  }
                >
                  <Sparkles size={16} />
                </button>
                <button
                  className={`icon-button ${w.view.showAddresses ? 'active' : ''}`}
                  title="Show address nodes"
                  aria-label="Show address nodes"
                  onClick={() =>
                    change((c) => ({
                      ...c,
                      view: { ...c.view, showAddresses: !c.view.showAddresses },
                    }))
                  }
                >
                  <Layers size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Fit graph"
                  aria-label="Fit graph"
                  onClick={() => setFitToken((t) => t + 1)}
                >
                  <Expand size={16} />
                </button>
              </div>
              {graph.nodes.length ? (
                <Suspense
                  fallback={
                    <div className="graph-empty">
                      <LoaderCircle className="spin" />
                      <p>Loading graph renderer…</p>
                    </div>
                  }
                >
                  <GraphView
                    nodes={visibleGraph.nodes}
                    links={visibleGraph.links}
                    focusRequest={focusRequest}
                    selectedId={selectedId}
                    onSelect={select}
                    dimensions={w.view.dimensions}
                    sizeBy={w.view.sizeBy}
                    glow={w.view.glow}
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
                    <p className="small">Backend offline. You can still work with saved data.</p>
                  )}
                </div>
              )}
              {!!graph.nodes.length && !visibleGraph.nodes.length && (
                <div className="filtered-graph-empty">
                  <h3>No nodes match these filters</h3>
                  <p>Adjust the entity filters or restore the complete loaded graph.</p>
                  <button onClick={() => updateFilters({})}>Show all loaded paths</button>
                </div>
              )}
              {w.demo && (
                <div className="demo-badge">
                  LABORATORY <span>Synthetic CoinJoin fixture</span>
                </div>
              )}
              <div className="graph-legend">
                <span>
                  <i className="entity-dot transaction" />
                  Transaction
                </span>
                <span>
                  <i className="entity-dot output" />
                  Output
                </span>
                {w.view.showAddresses && (
                  <span>
                    <i className="entity-dot address" />
                    Address
                  </span>
                )}
                <span className="graph-help">
                  {w.view.dimensions === 3
                    ? 'Drag to orbit · scroll to zoom'
                    : 'Drag to pan · scroll to zoom'}
                </span>
              </div>
            </section>
            <aside className="right-panel" data-tour="analysis-panel">
              <div className="panel-tabs">
                <button
                  className={rightTab === 'inspect' ? 'active' : ''}
                  onClick={() => setRightTab('inspect')}
                >
                  Inspector
                </button>
                <button
                  className={rightTab === 'analysis' ? 'active' : ''}
                  onClick={() => setRightTab('analysis')}
                >
                  Analysis <span>{w.findings.length}</span>
                </button>
              </div>
              <div className="inspector-scroll">
                {rightTab === 'analysis' ? (
                  <AnalysisPanel
                    findings={w.findings}
                    hasNodes={!!visibleGraph.nodes.length}
                    selectedTxids={tx ? [tx.txid] : []}
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
                ) : wallet ? (
                  <WalletInspector
                    wallet={wallet}
                    workspace={w}
                    busy={!!operation}
                    canQuery={canQuery}
                    onScan={() => void scan(wallet)}
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
                    w={w}
                    selected={selected}
                    tx={tx}
                    graph={graph}
                    busy={!!operation}
                    canQuery={canTrace}
                    queryDisabledReason={queryDisabledReason}
                    editToken={editToken}
                    onEditHandled={() => setEditToken(0)}
                    onSelectNode={select}
                    onCenter={() => centerNode()}
                    annotationKey={`${w.id}:${selected.id}`}
                    onExpand={(direction) => void expand(direction)}
                    onRefresh={() =>
                      void run(async (signal) => {
                        const transaction = await getTransaction(selected.txid!, signal);
                        signal.throwIfAborted();
                        mergeTransactions(w.id, [transaction]);
                        setNotice(
                          w.demo
                            ? 'Transaction restored from the synthetic fixture.'
                            : 'Transaction refreshed from your node.',
                        );
                      })
                    }
                    onRemove={() => {
                      change((current) => {
                        const transactions = { ...current.transactions };
                        delete transactions[tx!.txid];
                        return {
                          ...current,
                          transactions,
                          findings: current.findings.filter((f) => !f.txids.includes(tx!.txid)),
                        };
                      });
                      setSelectedId(undefined);
                    }}
                    onSave={(annotation) =>
                      change((current) => ({
                        ...current,
                        annotations: { ...current.annotations, [selected.id]: annotation },
                      }))
                    }
                  />
                ) : (
                  <div className="inspector-empty">
                    <Eye size={29} />
                    <h3>A closer look</h3>
                    {w.description && <p className="workspace-description">{w.description}</p>}
                    <p>
                      Select a node in the graph or an item in Entities to inspect it, add context,
                      and follow its paths.
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
          onSave={(name, description) => change((c) => ({ ...c, name, description }))}
        />
      )}
      {w && examplesOpen && (
        <Modal title="Testnet4 tracing examples" onClose={() => setExamplesOpen(false)}>
          <p className="muted">
            Real on-chain outputs with verified incoming and spending paths. Load an output, then
            use the inspector to trace it. No wallet ownership is inferred.
          </p>
          {(w.network !== 'testnet4' || !canQuery) && (
            <p className="warning">
              Open a testnet4 workspace with a connected testnet4 backend to load these examples.
            </p>
          )}
          <div className="example-list">
            {TESTNET4_EXAMPLES.map((example) => (
              <article key={example.id}>
                <h3>{example.title}</h3>
                <p>{example.description}</p>
                <p className="mono small wrap">
                  {example.txid}:{example.vout}
                </p>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={w.network !== 'testnet4' || !canQuery || !!operation}
                    onClick={() => {
                      setExamplesOpen(false);
                      void addQuery(`${example.txid}:${example.vout}`);
                    }}
                  >
                    Load example output
                  </button>
                  <a href={example.sources[0].url} target="_blank" rel="noreferrer">
                    Explorer reference
                  </a>
                </div>
              </article>
            ))}
          </div>
        </Modal>
      )}
      {aboutOpen && (
        <AboutDialog
          initialTab={aboutOpen}
          onClose={() => setAboutOpen(false)}
          onTour={w ? () => setTour(0) : undefined}
          status={status}
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
        <div className="connection-banner">
          {connected
            ? `This workspace uses ${w.network}; the backend serves ${status?.network}. Connect a matching backend to load chain data.`
            : 'Backend offline. Saved workspaces remain available; configure your node connection to load chain data.'}
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
      {create && (
        <CreateDialog
          network={status?.network ?? 'testnet4'}
          demo={create === 'demo'}
          onCreate={ws.open}
          onClose={() => setCreate(undefined)}
        />
      )}
      {unlock && (
        <UnlockDialog entry={unlock} onUnlock={ws.unlock} onClose={() => setUnlock(undefined)} />
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
            ws.open(data, password);
          }}
          onClose={() => setFileDialog(undefined)}
        />
      )}
      {tour !== undefined && <GuidedTour tour={tour} setTour={setTour} />}
    </div>
  );
}
