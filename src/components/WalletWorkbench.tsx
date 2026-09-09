import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { formatSats, short, type Wallet, type Workspace } from '../domain/types';
import { verifyWalletUtxo, type WalletUtxoRecord } from '../domain/walletRecords';
import {
  applyReviewDecisions,
  buildWalletReview,
  REASON_LABELS,
  spendGuidance,
  type WalletReviewItem,
} from '../domain/walletReview';
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
} from '../domain/walletWorkbenchRows';
import { groupWalletRelationships } from '../domain/walletRelationships';
import {
  walletReviewCategories,
  matchesReviewCategories,
  walletReviewCategoryScanState,
} from '../domain/walletReviewCategories';
import type { AnalysisScan } from '../domain/analysisScan';
import { useRecordSelection } from '../lib/useRecordSelection';
import { useWalletUtxos } from '../lib/useWalletUtxos';
import { useWalletScan } from '../lib/useWalletScan';
import { useWalletCounterparties } from '../lib/useWalletCounterparties';
import { fetchTransaction } from '../lib/api';
import { WALLET_FLOW_INPUT_WAVE_LIMIT } from '../lib/walletFlowInputs';
import { BatchMetadataBar } from './BatchMetadataBar';
import { WalletOverview } from './WalletOverview';
import { WalletCategoryFilter } from './WalletCategoryFilter';
import {
  WalletItemDetail,
  WalletDecisionButtons,
  type WalletDecisionAction,
} from './WalletItemDetail';
import { WalletRelatedSelection } from './WalletRelatedSelection';
import { WalletHelp } from './WalletHelp';
import { WalletReference } from './WalletReference';
import { CopyButton } from './CopyButton';
import { buildTagIndex } from '../domain/tags';
import './wallet-workbench.css';

export interface WalletWorkbenchProps {
  active: boolean;
  workspace: Workspace;
  wallet?: Wallet;
  canQuery: boolean;
  busy: boolean;
  queryDisabledReason?: string;
  analysisScan?: AnalysisScan;
  onScanComplete?: (scan: AnalysisScan) => void;
  updateEvidence: (id: string, update: (current: Workspace) => Workspace, undo?: boolean) => void;
  onSelectWallet: (id: string) => void;
  onAddWallet: () => void;
  onEditWallet?: (id: string) => void;
  onChange: (update: (workspace: Workspace) => Workspace) => void;
  onRefresh: () => void;
  onShowInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onIsolateInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onShowSelection: (ids: string[], isolate: boolean) => void;
  onInspect: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onAnalyze: (nodeId?: string) => void;
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

export const WalletWorkbench = memo(
  function WalletWorkbench(props: WalletWorkbenchProps) {
    if (!props.wallet)
      return (
        <section className="wallet-workbench" aria-label="Wallet review workbench">
          <div className="wallet-empty">
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
      <WalletReview
        key={`${props.workspace.id}:${props.wallet.id}`}
        {...props}
        wallet={props.wallet}
      />
    );
  },
  (before, after) =>
    !before.active &&
    !after.active &&
    before.workspace.id === after.workspace.id &&
    before.wallet?.id === after.wallet?.id,
);

function WalletReview(props: WalletWorkbenchProps & { wallet: Wallet }) {
  const { workspace, wallet, active, busy, canQuery, onChange } = props;
  const walletScan = useWalletScan({
    workspace,
    wallet,
    active,
    onChange,
    onComplete: props.onScanComplete,
  });
  const [tab, setTab] = useState<WalletTab>('review');
  const [status, setStatus] = useState<WalletStatusFilter>('open');
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
  const {
    utxos,
    loading: utxoLoading,
    error: utxoError,
    check,
  } = useWalletUtxos({ workspace, wallet, enabled: active && canQuery });
  const currentUtxos = useMemo(
    () =>
      (utxos?.records ?? [])
        .filter(
          (record) =>
            !workspace.transactions[record.txid] ||
            verifyWalletUtxo(record, workspace.transactions[record.txid], workspace.network),
        )
        .sort(
          (a, b) => b.valueSats - a.valueSats || a.txid.localeCompare(b.txid) || a.vout - b.vout,
        ),
    [utxos, workspace.transactions, workspace.network],
  );
  const invalidCount = (utxos?.records.length ?? 0) - currentUtxos.length;
  const review = useMemo(
    () =>
      buildWalletReview(workspace, wallet, {
        utxos: utxos ? currentUtxos : undefined,
        utxoCheckedAt: utxos?.checkedAt,
        utxoCheckedAddresses: utxos?.checkedAddresses,
        utxoTotalAddresses: utxos?.totalAddresses,
        utxoPartial: utxos?.nextCursor !== undefined || (utxos?.failed ?? 0) > 0,
        page: itemPage,
      }),
    [
      workspace.id,
      workspace.network,
      workspace.transactions,
      workspace.annotations,
      workspace.tags,
      workspace.walletReviews,
      workspace.findings,
      wallet,
      utxos,
      currentUtxos,
      itemPage,
    ],
  );
  const relationships = useMemo(
    () => groupWalletRelationships(workspace, wallet),
    [
      workspace.network,
      workspace.transactions,
      wallet.id,
      wallet.addresses,
      wallet.pendingTransactionIds,
      wallet.scanComplete,
      wallet.scannedAt,
    ],
  );
  const counterparties = useWalletCounterparties({
    workspace,
    wallet,
    groups: relationships,
    active: active && tab === 'sources',
    enabled: canQuery && !busy,
    fetch: fetchTransaction,
    update: props.updateEvidence,
  });
  const [counterpartyReady, setCounterpartyReady] = useState(false);
  useEffect(() => setCounterpartyReady(active && tab === 'sources'), [active, tab]);
  const rowsByTab = useMemo<Record<WalletTab, WalletRow[]>>(() => {
    const records =
      tab === 'utxos' || tab === 'transactions' || tab === 'addresses'
        ? buildWalletRecordRows(workspace, wallet, currentUtxos, review.items, tab)
        : { utxos: [], transactions: [], addresses: [] };
    const sourceContexts = new Map(
      [
        ...relationships.sourceExceptions,
        ...relationships.sources.flatMap((group) => group.outpoints),
      ].map((entry) => [entry.id, entry.transactionIds]),
    );
    return {
      review: review.items.map((item) => {
        const row = reviewRow(item);
        if (item.reason === 'funding-source')
          row.contextTransactionIds = sourceContexts.get(item.nodeId) ?? row.contextTransactionIds;
        return row;
      }),
      ...records,
      ...buildWalletRelationshipRows(workspace, relationships, review.items),
    };
  }, [
    workspace.network,
    workspace.transactions,
    workspace.annotations,
    workspace.tags,
    workspace.walletReviews,
    wallet.id,
    wallet.addresses,
    currentUtxos,
    review.items,
    relationships,
    tab,
  ]);
  const rows = rowsByTab[tab];
  const rowTags = useMemo(
    () =>
      buildTagIndex(workspace, {
        nodes: rows.map((row) => ({
          id: row.nodeId,
          kind: row.kind,
          address: row.address,
          label: '',
        })),
        links: [],
      }),
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
  const currentScan = walletScan.scan ?? props.analysisScan;
  const scanState = useMemo(
    () => walletReviewCategoryScanState(workspace, currentScan),
    [workspace.findings, currentScan],
  );
  const categories = useMemo(
    () =>
      tab !== 'review'
        ? []
        : walletReviewCategories(
            workspace,
            statusFiltered.flatMap((row) => row.reviews),
          ).map((category) => {
            const tool = scanState.tools.find((entry) => entry.id === category.algorithm);
            const note = !category.heuristic
              ? undefined
              : tool?.status === 'not-scanned'
                ? 'Not scanned in this session; zero means no listed results, not a completed scan.'
                : tool?.status === 'saved-findings'
                  ? 'Saved findings; original scan coverage is unavailable.'
                  : tool?.status === 'skipped'
                    ? 'Skipped in the last session scan.'
                    : tool?.status === 'error'
                      ? 'The last session scan could not complete this tool.'
                      : `Last session scan: ${currentScan?.scope.label ?? 'scope unavailable'}. Counts here are filtered review items.`;
            return { ...category, note };
          }),
    [
      tab,
      workspace.annotations,
      workspace.tags,
      workspace.findings,
      statusFiltered,
      scanState,
      currentScan,
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
            row.reviews.some((item) => matchesReviewCategories(item, selectedTypes, workspace)),
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
    ],
  );
  const displayedRows = filteredRows.slice(0, limit);
  const initialReviewLoading =
    tab === 'review' && !selectedKey && !previousRow.current && canQuery && !utxos && !utxoError;
  const currentRow = initialReviewLoading
    ? undefined
    : resolveWalletRow(filteredRows, selectedKey, previousRow.current);
  const selectedRow = useMemo(
    () => (currentRow ? walletRowWithContext(workspace, currentRow) : undefined),
    [workspace.transactions, workspace.network, currentRow],
  );
  const selectionKeys = useMemo(() => new Set(selection.ids), [selection.ids]);
  const rowKeys = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const filteredKeys = useMemo(() => new Set(filteredRows.map((row) => row.key)), [filteredRows]);
  const allSelection = walletSelectAll(selection.ids, [...filteredKeys]);
  const selectedRows = selection.ids.length ? rows.filter((row) => selectionKeys.has(row.key)) : [];
  const selectedIds = [...new Set(selectedRows.map((row) => row.nodeId))];
  const selectedKinds = new Map(selectedRows.map((row) => [row.nodeId, row.kind]));
  const selectionSummary = (['address', 'transaction', 'output'] as const)
    .flatMap((kind) => {
      const count = [...selectedKinds.values()].filter((value) => value === kind).length;
      const noun = kind === 'output' ? (tab === 'utxos' ? 'UTXO' : 'outpoint') : kind;
      return count ? [`${count} ${noun}${count === 1 ? '' : 's'}`] : [];
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
      previous?.kind === 'output' &&
      !previous.address &&
      currentRow?.kind === 'address' &&
      currentRow.outpointIds?.includes(previous.nodeId) &&
      (!selectedKey || selectedKey === previous.key)
    )
      setSelectedKey(currentRow.key);
    previousRow.current = currentRow;
  }, [batching, currentRow, selectedKey]);
  const tabLabel = TABS.find((item) => item.id === tab)!.label;
  const statusCounts = (value: WalletStatusFilter) =>
    metadataFiltered.filter((row) => matchesWalletStatus(row, value)).length;

  useEffect(() => setLimit(PAGE), [tab, query, labelFilter, tagFilter, status, typeIds]);
  useEffect(() => {
    if (selectedKey && window.matchMedia('(max-width: 760px)').matches)
      detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, batching]);

  function changeTab(next: WalletTab) {
    setTab(next);
    selection.clear();
    setSelectedKey(undefined);
    previousRow.current = undefined;
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
      setStatus('open');
      if (tab === 'review') setSelectedKey(items[0]?.key);
    } else if (selectedRow) {
      const decided = new Set(items.map((item) => item.key));
      const index = filteredRows.findIndex((row) => row.key === selectedRow.key);
      const following = [...filteredRows.slice(index + 1), ...filteredRows.slice(0, index)];
      setSelectedKey(
        following.find((row) => !row.reviews.some((item) => decided.has(item.key)))?.key,
      );
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
  const relatedSelection =
    selectedRows.length > 0 || selectedRow ? (
      <WalletRelatedSelection
        active={active}
        candidates={filteredRows.map(related)}
        seeds={(batching ? selectedRows : selectedRow ? [selectedRow] : []).map(related)}
        onSelect={selection.setIds}
      />
    ) : undefined;
  return (
    <section className="wallet-workbench" aria-label="Wallet review workbench">
      <WalletOverview
        {...props}
        coverage={review.coverage}
        utxos={utxos}
        utxoLoading={utxoLoading}
        onCheck={(cursor) => void check(cursor)}
        onScan={() => void walletScan.run()}
        scanLoading={walletScan.loading}
        scanStatus={
          walletScan.message ||
          (currentScan?.scope.kind === 'wallet' &&
          currentScan.scope.label === `Wallet ${wallet.name}`
            ? `${currentScan.findings.length} findings`
            : 'Ready to scan')
        }
        scanIssues={currentScan?.reports
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
        {walletScan.error && (
          <p role="alert" className="small warning">
            {walletScan.error}
          </p>
        )}
        {invalidCount > 0 && (
          <p role="alert" className="small warning">
            {invalidCount} UTXO observations disagree with their loaded transactions and are
            excluded. Check again to retry.
          </p>
        )}
      </div>
      <nav className="wallet-review-tabs" aria-label="Wallet sections">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => changeTab(id)}
          >
            <Icon size={14} /> {label}
            {id === 'review' && (
              <span className="wallet-count">
                {rowsByTab.review.filter((row) => matchesWalletStatus(row, 'open')).length}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div aria-live="polite" className="wallet-review-status-line">
        {notice && <p className="small wallet-review-notice">{notice}</p>}
      </div>
      <div className="wallet-review-body">
        <div className="wallet-record-filters">
          {tab !== 'addresses' && (
            <label>
              {tab === 'review' ? 'Show' : 'Review'}
              <select
                aria-label={tab === 'review' ? 'Review filter' : 'Review state filter'}
                value={status}
                onChange={(event) => setStatus(event.target.value as WalletStatusFilter)}
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
            Labels
            <select
              aria-label="Label filter"
              value={labelFilter}
              onChange={(event) => setLabelFilter(event.target.value)}
            >
              <option value="all">All</option>
              <option value="unlabeled">Unlabeled</option>
              <option value="labeled">Labelled</option>
            </select>
          </label>
          <label>
            Tags
            <select
              aria-label="Tag filter"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
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
              onChange={setTypeIds}
            />
          )}
          <label className="wallet-record-search">
            Search
            <input
              type="search"
              aria-label="Filter wallet records"
              placeholder="Labels, tags or address"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="wallet-record-summary">
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
                            {short(row.identifier, 12)}
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
                        {row.amountSats !== undefined && <span>{formatSats(row.amountSats)}</span>}
                        {row.address && row.kind !== 'address' && (
                          <WalletReference value={row.address} kind="address" length={8} />
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
                    {selectedRows.length} rows · {selectedReviews.length} review decisions
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
