import { Amount } from '../../../../Shared/Display/Amount';
import { memo, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Coins,
  ListChecks,
  LogIn,
  LogOut,
  MapPin,
  Filter,
  Network,
  Wallet as WalletIcon,
  LoaderCircle,
} from 'lucide-react';
import type { Wallet, Workspace } from '../../../../Domain/types';
import type { WalletUtxoRecord } from '../../../../Domain/Wallet/walletRecords';
import {
  applyReviewDecisions,
  isCompletedReview,
  REASON_LABELS,
  spendGuidance,
  type WalletReviewItem,
} from '../../../../Domain/Wallet/walletReview';
import {
  buildWalletRecordRows,
  buildWalletRelationshipRows,
  matchesWalletStatus,
  reviewRow,
  walletSelectAll,
  walletRowWithContext,
  resolveWalletRow,
  type WalletRow,
  type WalletStatusFilter,
  type WalletTab,
} from '../../../../Domain/Wallet/walletWorkbenchRows';
import {
  walletReviewCategories,
  matchesReviewCategories,
  walletReviewCategoryScanState,
  type WalletReviewCategoryWorkspace,
} from '../../../../Domain/Wallet/walletReviewCategories';
import type { AnalysisScan } from '../../../../Domain/Analysis/analysisScan';
import { useRecordSelection } from './useRecordSelection';
import type { WalletUtxoController } from './useWalletUtxos';
import type { WalletWorkbenchContext } from './walletWorkbenchContext';
import type { WorkspaceController } from '../../useWorkspace';
import { useWalletAnalysis } from './useWalletAnalysis';
import { useWalletCounterparties } from './useWalletCounterparties';
import { useTransactionFetch } from '../../useTransactionFetch';
import { WALLET_FLOW_INPUT_WAVE_LIMIT } from './Review/walletFlowInputs';
import { BatchMetadataBar } from './Review/BatchMetadataBar';
import { WalletOverview } from './WalletOverview';
import { WalletCategoryFilter } from './WalletCategoryFilter';
import {
  WalletItemDetail,
  WalletDecisionButtons,
  type WalletDecisionAction,
} from './Review/WalletItemDetail';
import { WalletRelatedSelection } from './WalletRelatedSelection';
import { matchRelatedEntities } from '../../../../Domain/Wallet/walletReviewContext';
import { WalletHelp } from '../../../../Shared/Display/WalletHelp';
import { WalletReference } from './WalletReference';
import { TransactionBlockTime } from '../../../../Shared/Display/TransactionBlockTime';
import { walletRecordBlockObservation } from '../../../../Domain/Chain/transactionTime';
import { CopyButton } from '../../../../Shared/Controls/CopyButton';
import { buildTagIndex } from '../../../../Domain/Metadata/tags';
import { ResponsiveIdentifier } from '../../../../Shared/Display/ResponsiveIdentifier';
import { WalletPreparationCache } from './walletPreparation';
import './wallet-workbench.css';

export interface WalletWorkbenchViewProps extends WalletWorkbenchContext {
  walletUtxos: WalletUtxoController;
  preparationCache?: WalletPreparationCache;
  sessionAnalysis?: AnalysisScan;
  onAnalysisComplete?: (scan: AnalysisScan) => void;
}

const TABS = [
  { id: 'review', label: 'To review', Icon: ListChecks },
  { id: 'utxos', label: 'UTXOs', Icon: Coins },
  { id: 'transactions', label: 'Transactions', Icon: ArrowLeftRight },
  { id: 'addresses', label: 'Addresses', Icon: MapPin },
  { id: 'sources', label: 'Sources', Icon: LogIn },
  { id: 'destinations', label: 'Destinations', Icon: LogOut },
] as const;
const PAGE = 40;
const STATUS_LABELS = {
  open: 'To review',
  later: 'Review later',
  decided: 'Reviewed',
  all: 'All items',
} as const;

// Even programmatic events in a preview cannot reach workspace edits or network actions.
const noop = () => {};
const PREVIEW_ACTIONS = {
  walletUtxos: { loading: false, error: '', check: async () => {} },
  updateEvidence: noop,
  onAnalysisComplete: noop,
  onSelectWallet: noop,
  onAddWallet: noop,
  onEditWallet: noop,
  onChange: noop,
  onRefresh: noop,
  onShowInGraph: noop,
  onIsolateInGraph: noop,
  onShowSelection: noop,
  onInspect: noop,
  onAnalyze: noop,
};

function buildWalletRows(
  workspace: Pick<Workspace, 'network' | 'transactions' | 'walletReviews'>,
  wallet: Pick<Wallet, 'id' | 'addresses'>,
  currentUtxos: readonly WalletUtxoRecord[],
  reviewItems: readonly WalletReviewItem[],
  relationships: ReturnType<WalletPreparationCache['prepare']>['relationships'],
  tab: WalletTab,
): Record<WalletTab, WalletRow[]> {
  const records =
    tab === 'utxos' || tab === 'transactions' || tab === 'addresses'
      ? buildWalletRecordRows(workspace, wallet, currentUtxos, reviewItems, tab)
      : { utxos: [], transactions: [], addresses: [] };
  const sourceContexts = new Map(
    [
      ...relationships.sourceExceptions,
      ...relationships.sources.flatMap((group) => group.outpoints),
    ].map((entry) => [entry.id, entry.transactionIds]),
  );
  return {
    review: reviewItems.map((item) => {
      const row = reviewRow(item);
      if (item.reason === 'funding-source')
        row.contextTransactionIds = sourceContexts.get(item.nodeId) ?? row.contextTransactionIds;
      return row;
    }),
    ...records,
    ...(tab === 'sources' || tab === 'destinations'
      ? buildWalletRelationshipRows(workspace, relationships, reviewItems)
      : { sources: [], destinations: [] }),
  };
}

function buildWalletRowTagIndex(tags: Workspace['tags'], rows: readonly WalletRow[]) {
  return buildTagIndex(
    { tags },
    {
      nodes: rows.map((row) => ({
        id: row.nodeId,
        kind: row.kind,
        address: row.address,
        label: '',
      })),
      links: [],
    },
  );
}

function walletCategoryScanState(
  findings: Workspace['findings'],
  currentAnalysis: AnalysisScan | undefined,
) {
  return walletReviewCategoryScanState({ findings }, currentAnalysis);
}

function walletCategories(
  workspace: WalletReviewCategoryWorkspace,
  items: readonly WalletReviewItem[],
) {
  return walletReviewCategories(workspace, items);
}

function matchesWalletCategory(
  item: WalletReviewItem,
  selectedTypes: readonly string[],
  workspace: WalletReviewCategoryWorkspace,
) {
  return matchesReviewCategories(item, selectedTypes, workspace);
}

export const WalletWorkbenchView = memo(
  function WalletWorkbenchView(props: WalletWorkbenchViewProps) {
    const previewWorkspace = props.tourPreview?.example ?? props.workspace;
    const previewWallet = props.tourPreview?.example?.wallets[0] ?? props.wallet;
    const walletIdentity = props.wallet ? `${props.workspace.id}:${props.wallet.id}` : undefined;
    const [mountedWallet, setMountedWallet] = useState<string>();
    const prepared =
      props.wallet &&
      props.preparationCache?.peek(props.workspace, props.wallet, props.walletUtxos.utxos);
    const nextMountedWallet =
      prepared || mountedWallet === walletIdentity ? walletIdentity : undefined;
    if (mountedWallet !== nextMountedWallet) setMountedWallet(nextMountedWallet);
    const retainWallet = nextMountedWallet !== undefined;
    useEffect(() => {
      if (!props.active || props.tourPreview || !walletIdentity || retainWallet) return;
      // Let the active tab and preparation message paint before building the review.
      // Keep the mounted review when leaving this workbench; cancel unopened reviews.
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          startTransition(() => setMountedWallet(walletIdentity));
        });
      });
      return () => cancelAnimationFrame(frame);
    }, [props.active, props.tourPreview, walletIdentity, retainWallet]);
    if (!props.wallet && !previewWallet)
      return (
        <section className="wallet-workbench" aria-label="Wallet review workbench">
          <div className="wallet-empty" data-tour="wallet-empty">
            <WalletIcon size={30} />
            <h1>Wallet review</h1>
            <p>
              Import a watch-only extended public key to review coins and their direct transaction
              relationships.
            </p>
            <button className="primary" onClick={props.onAddWallet} disabled={props.workspace.demo}>
              Add a wallet
            </button>
          </div>
        </section>
      );
    return (
      <>
        {!retainWallet && props.active && !props.tourPreview && props.wallet && (
          <section className="wallet-workbench is-preparing" aria-label="Wallet review workbench">
            <div className="wallet-preparing" role="status">
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
              <span>Preparing wallet…</span>
            </div>
          </section>
        )}
        {retainWallet && props.wallet && (
          <WalletReview
            key={walletIdentity}
            {...props}
            tourPreview={undefined}
            hidden={!!props.tourPreview}
            wallet={props.wallet}
          />
        )}
        {props.tourPreview && previewWallet && (
          <WalletReview
            key={`tour:${previewWorkspace.id}:${previewWallet.id}:${props.tourPreview.tab}`}
            {...props}
            {...PREVIEW_ACTIONS}
            preparationCache={undefined}
            active={false}
            workspace={previewWorkspace}
            wallet={previewWallet}
            sessionAnalysis={props.tourPreview.example ? undefined : props.sessionAnalysis}
            canQuery={props.tourPreview.example ? false : props.canQuery}
            queryDisabledReason={
              props.tourPreview.example
                ? 'Public example · preview only'
                : props.queryDisabledReason
            }
          />
        )}
      </>
    );
  },
  (before, after) =>
    before.tourPreview === after.tourPreview &&
    !before.active &&
    !after.active &&
    before.workspace.id === after.workspace.id &&
    before.wallet?.id === after.wallet?.id,
);

function WalletReview(props: WalletWorkbenchViewProps & { wallet: Wallet; hidden?: boolean }) {
  const { workspace, wallet, active, busy, canQuery, onChange } = props;
  const [localPreparation] = useState(() => new WalletPreparationCache());
  const preparation = props.preparationCache ?? localPreparation;
  const walletAnalysis = useWalletAnalysis({
    workspace,
    wallet,
    active,
    onChange,
    onComplete: props.onAnalysisComplete,
  });
  const [tab, setTab] = useState<WalletTab>(props.tourPreview?.tab ?? 'review');
  const [status, setStatus] = useState<WalletStatusFilter>(
    props.tourPreview?.tab === 'sources' ? 'all' : 'open',
  );
  const [selectedKey, setSelectedKey] = useState<string>();
  const selection = useRecordSelection();
  const [limit, setLimit] = useState(PAGE);
  const [itemPage, setItemPage] = useState(1);
  const [query, setQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [typeIds, setTypeIds] = useState<string[]>();
  const [notice, setNotice] = useState('');
  const detailRef = useRef<HTMLElement>(null);
  const previousRow = useRef<WalletRow | undefined>(undefined);
  const previousFilterScope = useRef<string | undefined>(undefined);
  const filterScopeFor = (reviewStatus: WalletStatusFilter) =>
    JSON.stringify([
      workspace.id,
      wallet.id,
      tab,
      query,
      labelFilter,
      tagFilter,
      reviewStatus,
      typeIds,
    ]);
  const filterScope = filterScopeFor(status);
  const { utxos, loading: utxoLoading, error: utxoError, check } = props.walletUtxos;
  const { selectionIndex, walletAddresses, relationships, review, currentUtxos, invalidCount } =
    preparation.prepare(workspace, wallet, utxos, itemPage);
  const fetchTransaction = useTransactionFetch('background');
  const counterparties = useWalletCounterparties({
    workspace,
    wallet,
    groups: relationships,
    active: active && tab === 'sources',
    enabled: canQuery && !busy,
    fetch: fetchTransaction,
    update: props.updateEvidence,
  });
  const counterpartyReady = active && tab === 'sources';
  const rowsByTab = useMemo(
    () =>
      buildWalletRows(
        {
          network: workspace.network,
          transactions: workspace.transactions,
          walletReviews: workspace.walletReviews,
        },
        { id: wallet.id, addresses: wallet.addresses },
        currentUtxos,
        review.items,
        relationships,
        tab,
      ),
    [
      workspace.network,
      workspace.transactions,
      workspace.walletReviews,
      wallet.id,
      wallet.addresses,
      currentUtxos,
      review.items,
      relationships,
      tab,
    ],
  );
  const rows = rowsByTab[tab];
  const rowTags = useMemo(
    () => buildWalletRowTagIndex(workspace.tags, rows),
    [workspace.tags, rows],
  );
  const search = query.trim().toLowerCase();
  const metadataFiltered = useMemo(
    () =>
      rows.filter((row) => {
        const annotation = workspace.annotations[row.nodeId];
        const tags = rowTags.get(row.nodeId) ?? [];
        if (
          search &&
          ![
            row.identifier,
            row.address,
            row.title,
            annotation?.label,
            annotation?.note,
            ...tags.map((tag) => tag.name),
            ...row.contextTransactionIds,
          ].some((text) => text?.toLowerCase().includes(search))
        )
          return false;
        if (labelFilter === 'unlabeled' && annotation?.label?.trim()) return false;
        if (labelFilter === 'labeled' && !annotation?.label?.trim()) return false;
        if (tagFilter === 'untagged' && tags.length) return false;
        if (
          tagFilter !== 'all' &&
          tagFilter !== 'untagged' &&
          !tags.some((tag) => tag.id === tagFilter)
        )
          return false;
        return true;
      }),
    [rows, rowTags, workspace.annotations, search, labelFilter, tagFilter],
  );
  const statusFiltered = useMemo(
    () => metadataFiltered.filter((row) => matchesWalletStatus(row, status)),
    [metadataFiltered, status],
  );
  const currentAnalysis = walletAnalysis.scan ?? props.sessionAnalysis;
  const scanState = useMemo(
    () => walletCategoryScanState(workspace.findings, currentAnalysis),
    [workspace.findings, currentAnalysis],
  );
  const categories = useMemo(
    () =>
      tab !== 'review'
        ? []
        : walletCategories(
            {
              annotations: workspace.annotations,
              tags: workspace.tags,
              findings: workspace.findings,
              walletReviews: workspace.walletReviews,
            },
            statusFiltered.flatMap((row) => row.reviews),
          ).map((category) => {
            const tool = scanState.tools.find((entry) => entry.id === category.algorithm);
            const note = !category.heuristic
              ? undefined
              : tool?.status === 'not-scanned'
                ? 'No scan results are available for this type yet.'
                : tool?.status === 'saved-findings'
                  ? 'These findings were saved earlier; the details of that scan are unavailable.'
                  : tool?.status === 'skipped'
                    ? 'The last scan skipped this check.'
                    : tool?.status === 'error'
                      ? 'The last scan could not finish this check. Choose Analyze to try again.'
                      : `Last scan: ${currentAnalysis?.scope.label ?? 'selection unavailable'}.`;
            return { ...category, note };
          }),
    [
      tab,
      workspace.annotations,
      workspace.tags,
      workspace.findings,
      workspace.walletReviews,
      statusFiltered,
      scanState,
      currentAnalysis,
    ],
  );
  const selectedTypes = useMemo(
    () => typeIds ?? categories.map((category) => category.id),
    [typeIds, categories],
  );
  const allTypes = categories.every((category) => selectedTypes.includes(category.id));
  const filteredRows = useMemo(
    () =>
      tab === 'review' && !allTypes
        ? statusFiltered.filter((row) =>
            row.reviews.some((item) =>
              matchesWalletCategory(item, selectedTypes, {
                annotations: workspace.annotations,
                tags: workspace.tags,
                findings: workspace.findings,
                walletReviews: workspace.walletReviews,
              }),
            ),
          )
        : statusFiltered,
    [
      tab,
      allTypes,
      statusFiltered,
      selectedTypes,
      workspace.annotations,
      workspace.tags,
      workspace.findings,
      workspace.walletReviews,
    ],
  );
  const displayedRows = filteredRows.slice(0, limit);
  const initialReviewLoading =
    !props.tourPreview &&
    tab === 'review' &&
    filteredRows.length === 0 &&
    !selectedKey &&
    !previousRow.current &&
    canQuery &&
    !utxos &&
    !utxoError;
  // Metadata edits can remove a row from the current filters. Keep its live
  // details available until the user navigates, changes filters, or decides.
  const retainedRow =
    previousFilterScope.current === filterScope &&
    (!selectedKey || selectedKey === previousRow.current?.key)
      ? rows.find((row) => row.key === previousRow.current?.key)
      : undefined;
  const currentRow = initialReviewLoading
    ? undefined
    : (retainedRow ?? resolveWalletRow(filteredRows, selectedKey, previousRow.current));
  const selectedRow = useMemo(
    () =>
      currentRow
        ? walletRowWithContext(
            { network: workspace.network, transactions: workspace.transactions },
            currentRow,
            selectionIndex,
          )
        : undefined,
    [workspace.network, workspace.transactions, selectionIndex, currentRow],
  );
  const selectionKeys = useMemo(() => new Set(selection.ids), [selection.ids]);
  const rowKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const filteredKeys = useMemo(() => new Set(filteredRows.map((row) => row.key)), [filteredRows]);
  const allSelection = useMemo(
    () => walletSelectAll(selection.ids, [...filteredKeys]),
    [selection.ids, filteredKeys],
  );
  const selectedRows = selection.ids.length ? rows.filter((row) => selectionKeys.has(row.key)) : [];
  const selectedIds = [...new Set(selectedRows.map((row) => row.nodeId))];
  const selectedKinds = new Map(selectedRows.map((row) => [row.nodeId, row.kind]));
  const selectionSummary = (['address', 'transaction', 'output'] as const)
    .flatMap((kind) => {
      const count = [...selectedKinds.values()].filter((value) => value === kind).length;
      const noun = kind === 'output' ? (tab === 'utxos' ? 'UTXO' : 'outpoint') : kind;
      return count ? [`${count} ${noun}${count === 1 ? '' : kind === 'address' ? 'es' : 's'}`] : [];
    })
    .join(' · ');
  const selectedReviews = [
    ...new Map(
      selectedRows
        .flatMap((row) => row.reviews)
        .filter((item) => !item.legacyOutputReview)
        .map((item) => [item.key, item]),
    ).values(),
  ];
  const hiddenSelected = selectedRows.filter((row) => !filteredKeys.has(row.key)).length;
  const missingSelected = selection.ids.filter((id) => !rowKeys.has(id)).length;
  const batching = selection.ids.length > 0;
  useEffect(() => {
    if (batching) return;
    const previous = previousRow.current;
    if (
      currentRow &&
      ((selectedKey && selectedKey !== currentRow.key) ||
        (previous?.kind === 'output' &&
          !previous.address &&
          currentRow.kind === 'address' &&
          currentRow.outpointIds?.includes(previous.nodeId) &&
          (!selectedKey || selectedKey === previous.key)))
    )
      setSelectedKey(currentRow.key);
    previousRow.current = currentRow;
    previousFilterScope.current = filterScope;
  }, [batching, currentRow, selectedKey, filterScope]);
  const tabLabel = TABS.find((item) => item.id === tab)!.label;
  const statusTotals = useMemo(
    () =>
      Object.fromEntries(
        (['all', 'open', 'later', 'decided'] as const).map((value) => [
          value,
          metadataFiltered.filter((row) => matchesWalletStatus(row, value)).length,
        ]),
      ),
    [metadataFiltered],
  );
  const statusCounts = (value: WalletStatusFilter) => statusTotals[value];
  const openReviewCount = useMemo(
    () => rowsByTab.review.filter((row) => matchesWalletStatus(row, 'open')).length,
    [rowsByTab.review],
  );

  useEffect(() => {
    if (selectedKey && window.matchMedia('(max-width: 760px)').matches)
      detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, batching]);

  function changeTab(next: WalletTab) {
    setLimit(PAGE);
    setTab(next);
    selection.clear();
    setSelectedKey(undefined);
    previousRow.current = undefined;
    previousFilterScope.current = undefined;
    setQuery('');
    setLabelFilter('all');
    setTagFilter('all');
    setStatus(next === 'review' ? 'open' : 'all');
    setNotice('');
  }

  function decide(items: readonly WalletReviewItem[], action: WalletDecisionAction) {
    onChange((current) => applyReviewDecisions(current, wallet, items, action));
    selection.clear();
    if (action === 'reopen') {
      setLimit(PAGE);
      setStatus('open');
      const reopened =
        tab === 'review' ? rows.find((row) => row.key === items[0]?.key) : selectedRow;
      setSelectedKey(reopened?.key);
      previousRow.current = reopened;
      previousFilterScope.current = filterScopeFor('open');
    } else if (selectedRow) {
      const decided = new Set(items.map((item) => item.key));
      const index = filteredRows.findIndex((row) => row.key === selectedRow.key);
      const following =
        index < 0
          ? filteredRows
          : [...filteredRows.slice(index + 1), ...filteredRows.slice(0, index)];
      setSelectedKey(
        following.find((row) => !row.reviews.some((item) => decided.has(item.key)))?.key,
      );
      previousRow.current = undefined;
      previousFilterScope.current = undefined;
    }
    setNotice(
      `${action === 'reopen' ? 'Reopened' : action === 'reviewed' ? 'Reviewed' : 'Set aside'} ${items.length} review item${items.length === 1 ? '' : 's'}.`,
    );
  }

  const related = (row: WalletRow) => ({
    id: row.key,
    address: row.address,
    txid: row.txid,
    transactionIds:
      row.kind === 'address' && row.relationshipDirection ? row.contextTransactionIds : undefined,
  });
  const relatedCandidates = useMemo(() => filteredRows.map(related), [filteredRows]);
  const relatedSeeds = (batching ? selectedRows : selectedRow ? [selectedRow] : []).map(related);
  const hasRelatedMatches =
    matchRelatedEntities(relatedCandidates, relatedSeeds, 'address').length > 0 ||
    matchRelatedEntities(relatedCandidates, relatedSeeds, 'transaction').length > 0;
  const relatedSelection = hasRelatedMatches ? (
    <WalletRelatedSelection
      active={active}
      candidates={relatedCandidates}
      seeds={relatedSeeds}
      onSelect={selection.setIds}
    />
  ) : undefined;
  return (
    <section
      className="wallet-workbench"
      aria-label="Wallet review workbench"
      hidden={props.hidden}
      inert={!!props.tourPreview}
      data-tour={props.tourPreview ? 'wallet-preview' : undefined}
    >
      <WalletOverview
        {...props}
        coverage={review.coverage}
        utxos={utxos}
        utxoLoading={utxoLoading}
        onCheck={(cursor) => {
          if (active) void check(cursor);
        }}
        onAnalyze={() => void walletAnalysis.run()}
        analyzing={walletAnalysis.loading}
        analysisStatus={
          walletAnalysis.message ||
          (currentAnalysis?.scope.kind === 'wallet' &&
          currentAnalysis.scope.label === `Wallet ${wallet.name}`
            ? `${currentAnalysis.findings.length} findings`
            : '')
        }
        analysisIssues={currentAnalysis?.reports
          .filter((report) => report.status === 'error')
          .map((report) => `${report.toolId}: ${report.message}`)
          .join(' ')}
      />
      <div aria-live="polite" className="wallet-review-messages">
        {utxoError && (
          <p role="alert" className="small warning">
            {utxoError}
          </p>
        )}
        {walletAnalysis.error && (
          <p role="alert" className="small warning">
            {walletAnalysis.error}
          </p>
        )}
        {invalidCount > 0 && (
          <p role="alert" className="small warning">
            {invalidCount} UTXO observations disagree with their loaded transactions and are
            excluded. Check again to retry.
          </p>
        )}
      </div>
      <nav className="wallet-review-tabs" aria-label="Wallet sections" data-tour="wallet-sections">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => changeTab(id)}
          >
            <Icon size={14} /> {label}
            {id === 'review' && <span className="wallet-count">{openReviewCount}</span>}
          </button>
        ))}
      </nav>
      <div className="wallet-review-body">
        <div className="wallet-record-filters" data-tour="wallet-filters">
          {tab !== 'addresses' && (
            <label>
              <span className="sr-only">{tab === 'review' ? 'Show' : 'Review'}</span>
              <select
                aria-label={tab === 'review' ? 'Review filter' : 'Review state filter'}
                value={status}
                onChange={(event) => {
                  setLimit(PAGE);
                  setStatus(event.target.value as WalletStatusFilter);
                }}
              >
                {(Object.keys(STATUS_LABELS) as WalletStatusFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]} ({statusCounts(value)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>Labels</span>
            <select
              aria-label="Label filter"
              value={labelFilter}
              onChange={(event) => {
                setLimit(PAGE);
                setLabelFilter(event.target.value);
              }}
            >
              <option value="all">All</option>
              <option value="unlabeled">Unlabeled</option>
              <option value="labeled">Labelled</option>
            </select>
          </label>
          <label>
            <span>Tags</span>
            <select
              aria-label="Tag filter"
              value={tagFilter}
              onChange={(event) => {
                setLimit(PAGE);
                setTagFilter(event.target.value);
              }}
            >
              <option value="all">Any tag state</option>
              <option value="untagged">No tags</option>
              {(workspace.tags ?? []).map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
          {tab === 'review' && (
            <WalletCategoryFilter
              active={active}
              categories={categories}
              selected={selectedTypes}
              onChange={(ids) => {
                setLimit(PAGE);
                setTypeIds(ids);
              }}
            />
          )}
          <label className="wallet-record-search">
            <span className="sr-only">Search</span>
            <input
              type="search"
              aria-label="Filter wallet records"
              placeholder="Labels, tags or address"
              value={query}
              onChange={(event) => {
                setLimit(PAGE);
                setQuery(event.target.value);
              }}
            />
          </label>
        </div>
        <div className="wallet-record-summary">
          {(query ||
            labelFilter !== 'all' ||
            tagFilter !== 'all' ||
            status !== 'all' ||
            typeIds !== undefined) && (
            <button
              className="text-button"
              aria-label="Clear wallet filters"
              onClick={() => {
                setLimit(PAGE);
                setQuery('');
                setLabelFilter('all');
                setTagFilter('all');
                setStatus('all');
                setTypeIds(undefined);
              }}
            >
              Clear filters
            </button>
          )}
          <span
            className="small muted"
            aria-label={`${Math.min(limit, filteredRows.length)} of ${filteredRows.length} matching results shown`}
          >
            {Math.min(limit, filteredRows.length)}/{filteredRows.length} shown
          </span>
          <button
            disabled={!filteredRows.length}
            title={
              allSelection.allSelected
                ? 'Unselect these matching rows, keeping selections outside the filter'
                : 'Select every matching row, including rows below Show more'
            }
            onClick={() => selection.setIds(allSelection.next)}
          >
            {allSelection.allSelected ? 'Unselect all' : 'Select all'} ({filteredRows.length})
          </button>
          {tab === 'review' && review.omittedItems > 0 && (
            <button onClick={() => setItemPage((current) => current + 1)}>
              Show more review items ({review.omittedItems})
            </button>
          )}
          <span className="wallet-review-notice" role="status" title={notice}>
            {notice}
          </span>
        </div>
        {tab === 'sources' && (
          <div className="wallet-input-status" role="status">
            {counterparties.loading ? (
              <span>Loading source addresses...</span>
            ) : (
              <>
                {counterparties.failedCount > 0 && (
                  <>
                    <span>{counterparties.failedCount} input lookups failed</span>
                    <button
                      disabled={!canQuery || busy}
                      title={props.queryDisabledReason}
                      onClick={counterparties.retry}
                    >
                      Retry
                    </button>
                  </>
                )}
                {counterparties.missingCount > counterparties.failedCount && (
                  <>
                    <span>
                      {counterparties.missingCount - counterparties.failedCount} input transactions
                      waiting
                    </span>
                    <button
                      disabled={!canQuery || busy}
                      onClick={counterparties.loadMore}
                      title={
                        props.queryDisabledReason ??
                        'Load the next batch of direct input transactions'
                      }
                    >
                      Load next{' '}
                      {Math.min(
                        WALLET_FLOW_INPUT_WAVE_LIMIT,
                        counterparties.missingCount - counterparties.failedCount,
                      )}
                    </button>
                  </>
                )}
              </>
            )}
            {counterparties.unavailableCount > 0 && (
              <span title="These input references could not be matched to an output in the loaded transactions. They are not listed as addresses.">
                {counterparties.unavailableCount} unmatched input references
              </span>
            )}
          </div>
        )}
        {(tab === 'sources' || tab === 'destinations') &&
          (() => {
            const nonAddress = (
              tab === 'sources'
                ? relationships.sourceExceptions
                : relationships.destinationExceptions
            ).filter((entry) => !entry.missing).length;
            return nonAddress ? (
              <p
                className="wallet-input-status"
                title="Scripts such as OP_RETURN do not have an address and are excluded from this list."
              >
                {nonAddress} non-address outputs excluded
              </p>
            ) : null;
          })()}
        <div className="wallet-review-grid">
          <div
            className={`wallet-review-list ${tab === 'review' ? '' : 'wallet-review-records'}`}
            role="list"
            aria-label={tab === 'review' ? 'Review queue' : `${tabLabel} records`}
          >
            {displayedRows.map((row) => {
              const annotation = workspace.annotations[row.nodeId];
              const checked = selectionKeys.has(row.key);
              const current = !batching && selectedRow?.key === row.key;
              const tags = rowTags.get(row.nodeId) ?? [];
              return (
                <div
                  className={`wallet-review-item ${tab === 'review' ? '' : 'wallet-review-record'} ${checked ? 'batch-selected selected' : ''}`}
                  role="listitem"
                  key={row.key}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {}}
                    aria-label={
                      tab === 'review'
                        ? `Select review item ${row.title}`
                        : `Select ${row.identifier}`
                    }
                    onClick={(event) =>
                      selection.choose(
                        row.key,
                        displayedRows.map((entry) => entry.key),
                        event,
                        true,
                      )
                    }
                  />
                  <div
                    className="wallet-row-content"
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('.copy-control'))
                        return;
                      if (event.ctrlKey || event.metaKey || event.shiftKey)
                        selection.choose(
                          row.key,
                          displayedRows.map((entry) => entry.key),
                          event,
                        );
                      else {
                        selection.clear();
                        selection.anchorAt(row.key);
                        setSelectedKey(row.key);
                      }
                    }}
                  >
                    <div className="wallet-row-heading">
                      <button
                        className={`wallet-row-button ${current ? 'active' : ''} ${tab === 'review' ? '' : 'wallet-review-record-body'}`}
                        aria-pressed={current || checked}
                      >
                        <span className="wallet-review-reason">
                          {tab === 'review' ? REASON_LABELS[row.reviews[0].reason] : row.meta}
                          {(tab === 'review' || row.status !== 'open') && (
                            <span className={`wallet-review-status status-${row.status}`}>
                              {row.changed
                                ? 'Evidence changed'
                                : row.status === 'unknown'
                                  ? 'Source unknown'
                                  : row.status === 'reviewed'
                                    ? 'Reviewed'
                                    : row.status === 'later'
                                      ? 'Review later'
                                      : 'To review'}
                            </span>
                          )}
                        </span>
                        <strong className="wallet-item-title" title={row.identifier}>
                          {annotation?.icon && (
                            <span className="wallet-entity-icon" aria-hidden="true">
                              {annotation.icon}
                            </span>
                          )}
                          {annotation?.label || row.title}
                        </strong>
                        {(annotation?.label || tab === 'review') && (
                          <span
                            className="mono muted wallet-review-record-id"
                            title={row.identifier}
                          >
                            <ResponsiveIdentifier value={row.identifier} />
                          </span>
                        )}
                      </button>
                      <span className="wallet-row-copy">
                        <CopyButton
                          value={row.identifier}
                          label={`Copy ${row.kind === 'transaction' ? 'transaction ID' : row.kind === 'output' ? 'outpoint' : 'address'}`}
                        />
                      </span>
                    </div>
                    <div className="wallet-row-footer">
                      {tags.length > 0 && (
                        <span className="wallet-item-tags">
                          {tags.map((tag) => (
                            <span
                              className="wallet-review-record-tag"
                              key={tag.id}
                              title={tag.name}
                            >
                              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                              {tag.name}
                            </span>
                          ))}
                        </span>
                      )}
                      {annotation?.note && (
                        <span className="wallet-item-note" title={annotation.note}>
                          {annotation.note}
                        </span>
                      )}
                      <div className="wallet-row-values muted">
                        {row.kind !== 'address' && row.txid && (
                          <TransactionBlockTime
                            timestampOnly
                            workspace={workspace}
                            showFee={row.kind === 'transaction'}
                            transaction={
                              row.utxo
                                ? walletRecordBlockObservation(
                                    row.txid,
                                    workspace.transactions[row.txid],
                                    row.utxo.height,
                                    row.utxo.height <= 0,
                                  )
                                : workspace.transactions[row.txid]
                            }
                          />
                        )}
                        {row.amountSats !== undefined && <Amount value={row.amountSats} />}
                        {row.address && row.kind !== 'address' && (
                          <WalletReference value={row.address} kind="address" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {!filteredRows.length && (
              <p className="wallet-empty-note">
                {tab === 'review' && !selectedTypes.length
                  ? 'No finding types selected. Choose types or reset to all.'
                  : query || labelFilter !== 'all' || tagFilter !== 'all'
                    ? 'No records match these filters.'
                    : tab === 'utxos' && !utxos
                      ? 'Check current UTXOs to load this list.'
                      : tab === 'review' && status === 'later'
                        ? 'No items set aside for later.'
                        : tab === 'review' && status === 'decided'
                          ? 'Nothing has been reviewed yet.'
                          : tab === 'sources' || tab === 'destinations'
                            ? counterparties.loading && tab === 'sources'
                              ? 'Loading source addresses...'
                              : 'No counterparty addresses in the loaded transactions.'
                            : 'No matching observations in this view. Other filters or missing loaded data may limit the list.'}
              </p>
            )}
            {filteredRows.length > limit && (
              <button onClick={() => setLimit((current) => current + PAGE)}>
                Show more ({filteredRows.length - limit} remaining)
              </button>
            )}
          </div>
          <article
            ref={detailRef}
            className={`wallet-review-detail ${batching ? 'wallet-batch-detail' : ''}`}
            aria-label={
              batching
                ? 'Batch selection details'
                : tab === 'review'
                  ? 'Selected review item'
                  : 'Selected wallet item'
            }
          >
            {batching ? (
              <>
                <div className="wallet-detail-toolbar" aria-label="Selected batch actions">
                  <BatchMetadataBar
                    active={active}
                    workspace={workspace}
                    ids={selectedIds}
                    scopeLabel="selected"
                    guidedActions={
                      selectedReviews.some(
                        (item) =>
                          item.reason === 'link' &&
                          (item.changed ||
                            item.status === 'open' ||
                            !isCompletedReview({ status: item.status })),
                      )
                        ? ['tags']
                        : undefined
                    }
                    disabled={busy || missingSelected > 0}
                    onChange={onChange}
                    onNotice={setNotice}
                  />
                  {selectedReviews.length > 0 && (
                    <div className="wallet-action-group" aria-label="Batch review decisions">
                      <WalletDecisionButtons
                        items={selectedReviews}
                        busy={busy || missingSelected > 0}
                        onDecide={decide}
                      />
                    </div>
                  )}
                  {relatedSelection && (
                    <div className="wallet-action-group">{relatedSelection}</div>
                  )}
                  <div className="wallet-action-group" aria-label="Graph actions">
                    <button
                      disabled={!selectedIds.length || busy || missingSelected > 0}
                      title="Show these selections in Graph and zoom to the first"
                      onClick={() => props.onShowSelection(selectedIds, false)}
                    >
                      <Network size={14} /> Show
                    </button>
                    <button
                      disabled={!selectedIds.length || busy || missingSelected > 0}
                      title="Isolate these selections and their connected graph context"
                      onClick={() => props.onShowSelection(selectedIds, true)}
                    >
                      <Filter size={14} /> Isolate
                    </button>
                  </div>
                </div>
                <h2>
                  {selectionSummary ? `${selectionSummary} selected` : 'Selection no longer listed'}
                </h2>
                <div className="wallet-compact-status">
                  <span>
                    {selectedRows.length} {selectedRows.length === 1 ? 'row' : 'rows'} ·{' '}
                    {selectedReviews.length} review{' '}
                    {selectedReviews.length === 1 ? 'decision' : 'decisions'}
                  </span>
                  <button className="text-button" onClick={selection.clear}>
                    Clear selection
                  </button>
                  {tab === 'utxos' && spendGuidance(workspace, selectedIds) && (
                    <WalletHelp title="Combining these UTXOs" active={active}>
                      {spendGuidance(workspace, selectedIds)}
                    </WalletHelp>
                  )}
                </div>
                {hiddenSelected > 0 && (
                  <p className="wallet-review-bound" role="note">
                    {hiddenSelected} selected outside this filter
                  </p>
                )}
                {missingSelected > 0 && (
                  <p className="warning" role="alert">
                    {missingSelected} selections are no longer in this view. Clear and reselect.
                  </p>
                )}
              </>
            ) : selectedRow ? (
              <WalletItemDetail
                key={`${tab}:${selectedRow.key}`}
                {...props}
                row={selectedRow}
                selectionIndex={selectionIndex}
                walletAddresses={walletAddresses}
                tags={rowTags.get(selectedRow.nodeId)}
                onNotice={setNotice}
                onDecide={decide}
                resolveInputs={tab !== 'sources' || (counterpartyReady && !counterparties.loading)}
                relatedSelection={relatedSelection}
              />
            ) : (
              <p className="wallet-empty-note">
                {initialReviewLoading
                  ? 'Checking current UTXOs...'
                  : tab === 'transactions'
                    ? 'Select a transaction.'
                    : tab === 'utxos'
                      ? 'Select a UTXO.'
                      : tab === 'review'
                        ? 'Select a review item.'
                        : 'Select an address.'}
              </p>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}

/** Binds the workspace controller to the view Workspace mounts. */
export function WalletWorkbench({ workspace }: { workspace: WorkspaceController }) {
  const {
    w,
    ws,
    tourStep,
    tourExample,
    viewOwner,
    workbench,
    lockingWorkspace,
    canQuery,
    operation,
    queryDisabledReason,
    operationRef,
    setRightTab,
    dialogs,
    change,
    shownWorkbench,
  } = workspace;
  const {
    utxos: walletUtxos,
    selected: wallet,
    discovery: walletDiscovery,
    sectionRef: walletWorkspaceRef,
  } = workspace.wallet;
  const analysis = workspace.analysis;
  const { invalidate: invalidateSelection, setSelectedWallet, setSelectedId } = workspace.selection;
  const { openWalletRecord, analyzeFromWallet } = workspace.wallet.actions;

  if (!w) return null;
  return (
    <section
      className="workbench-page"
      hidden={shownWorkbench !== 'wallet'}
      ref={walletWorkspaceRef}
      id="wallet-workspace"
      tabIndex={-1}
      aria-label="Wallet workspace"
    >
      <WalletWorkbenchView
        walletUtxos={walletUtxos}
        preparationCache={ws.getSession(w.id)?.walletPreparation}
        tourPreview={
          tourStep?.view?.workbench === 'wallet'
            ? { tab: tourStep.view.walletTab ?? 'review', example: tourExample }
            : undefined
        }
        active={viewOwner === w.id && workbench === 'wallet' && !lockingWorkspace && !tourStep}
        workspace={w}
        sessionAnalysis={analysis.sessions.current.get(w.id)?.scan}
        updateEvidence={ws.update}
        onAnalysisComplete={(scan) => {
          analysis.sessions.current.set(w.id, {
            scopeMode: analysis.sessions.current.get(w.id)?.scopeMode,
            options: scan.options,
            scan,
            selectedId: scan.findings[0]?.id,
            kind: 'all',
            limit: 40,
          });
          analysis.noteWalletAnalysis();
        }}
        wallet={wallet ?? w.wallets[0]}
        canQuery={canQuery}
        busy={!!operation}
        queryDisabledReason={queryDisabledReason}
        onSelectWallet={(id) => {
          invalidateSelection();
          operationRef.current?.abort();
          setSelectedWallet(id);
          setSelectedId(undefined);
          setRightTab('inspect');
        }}
        onAddWallet={() => dialogs.openAddWallet()}
        onChange={(update, group) => change(update, true, group)}
        onEditWallet={(walletId) => dialogs.openWalletRename(w.id, walletId)}
        onRefresh={() => void walletDiscovery.run(wallet ?? w.wallets[0])}
        onShowInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'graph')}
        onIsolateInGraph={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'isolate')}
        onShowSelection={(ids, isolate) => {
          if (ids.length) openWalletRecord(ids[0], undefined, isolate ? 'isolate' : 'graph', ids);
        }}
        onInspect={(nodeId, utxo) => openWalletRecord(nodeId, utxo, 'inspect')}
        onAnalyze={analyzeFromWallet}
      />
    </section>
  );
}
