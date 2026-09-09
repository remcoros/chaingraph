import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Check,
  CircleHelp,
  Eye,
  ListChecks,
  Network,
  RefreshCw,
  Search,
  Undo2,
  Wallet as WalletIcon,
} from 'lucide-react';
import {
  addressNodeId,
  formatSats,
  outputNodeId,
  short,
  txNodeId,
  type Wallet,
  type Workspace,
} from '../domain/types';
import { walletCheckAge } from '../domain/walletActivity';
import {
  listWalletAddresses,
  listWalletTransactions,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from '../domain/walletRecords';
import {
  buildWalletReview,
  applyReviewDecisions,
  isCompletedReview,
  REASON_LABELS,
  reviewKey,
  spendGuidance,
  type ReviewStatus,
  type WalletReviewItem,
} from '../domain/walletReview';
import { listTagsForNode } from '../domain/tags';
import { useRecordSelection } from '../lib/useRecordSelection';
import { useWalletUtxos } from '../lib/useWalletUtxos';
import { BatchMetadataBar } from './BatchMetadataBar';
import './wallet-workbench.css';

export interface WalletWorkbenchProps {
  active: boolean;
  workspace: Workspace;
  wallet?: Wallet;
  canQuery: boolean;
  busy: boolean;
  queryDisabledReason?: string;
  onSelectWallet: (id: string) => void;
  onAddWallet: () => void;
  onChange: (update: (workspace: Workspace) => Workspace) => void;
  onRefresh: () => void;
  onShowInGraph: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onInspect: (nodeId: string, utxo?: WalletUtxoRecord) => void;
  onAnalyze: (nodeId?: string) => void;
}

type RecordTab = 'utxos' | 'transactions' | 'addresses';
interface RecordRow {
  id: string;
  identifier: string;
  amountSats?: number;
  meta: string;
  detail?: string;
  utxo?: WalletUtxoRecord;
  reviewKey?: string;
  address?: string;
}
const PAGE = 40;

function statusLabel(item: WalletReviewItem): string {
  if (item.changed) return 'Evidence changed';
  return item.status === 'open'
    ? 'To review'
    : item.status === 'reviewed'
      ? 'Reviewed'
      : item.status === 'unknown'
        ? 'Source unknown'
        : 'Review later';
}

/** One selected wallet at a time. Review decisions, labels and tags stay inside the
 * encrypted workspace; UTXO observations remain transient.
 */
export function WalletWorkbench({
  active,
  workspace,
  wallet,
  canQuery,
  busy,
  queryDisabledReason,
  onSelectWallet,
  onAddWallet,
  onChange,
  onRefresh,
  onShowInGraph,
  onInspect,
  onAnalyze,
}: WalletWorkbenchProps) {
  if (!wallet)
    return (
      <section className="wallet-workbench" aria-label="Wallet review workbench">
        <div className="wallet-empty">
          <WalletIcon size={30} />
          <h1>Wallet review</h1>
          <p>
            Import a watch-only extended public key to review its current coins, recover context for
            old receipts and label them in place.
          </p>
          <div className="button-row">
            <button className="primary" onClick={onAddWallet} disabled={workspace.demo}>
              Add a wallet
            </button>
          </div>
        </div>
      </section>
    );
  return (
    <WalletReview
      key={`${workspace.id}:${wallet.id}`}
      active={active}
      workspace={workspace}
      wallet={wallet}
      canQuery={canQuery}
      busy={busy}
      queryDisabledReason={queryDisabledReason}
      onSelectWallet={onSelectWallet}
      onAddWallet={onAddWallet}
      onChange={onChange}
      onRefresh={onRefresh}
      onShowInGraph={onShowInGraph}
      onInspect={onInspect}
      onAnalyze={onAnalyze}
    />
  );
}

function WalletReview({
  active,
  workspace,
  wallet,
  canQuery,
  busy,
  queryDisabledReason,
  onSelectWallet,
  onChange,
  onRefresh,
  onShowInGraph,
  onInspect,
  onAnalyze,
}: WalletWorkbenchProps & { wallet: Wallet }) {
  const [tab, setTab] = useState<'review' | 'records'>('review');
  const [recordTab, setRecordTab] = useState<RecordTab>('utxos');
  const [reviewFilter, setReviewFilter] = useState<'open' | 'later' | 'decided' | 'all'>('open');
  const [selectedKey, setSelectedKey] = useState<string>();
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState('');
  const [labelFilter, setLabelFilter] = useState<'all' | 'unlabeled' | 'labeled'>('all');
  const [recordReview, setRecordReview] = useState<'all' | 'open' | 'later' | 'decided'>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const recordSelection = useRecordSelection();
  const { ids: selection, setIds: setSelection } = recordSelection;
  const reviewSelection = useRecordSelection();
  const [itemPage, setItemPage] = useState(1);
  const [notice, setNotice] = useState('');
  const {
    utxos,
    loading: utxoLoading,
    error: utxoError,
    check,
  } = useWalletUtxos({ workspace, wallet, enabled: active && canQuery });

  const invalidUtxos = useMemo(
    () =>
      new Set(
        (utxos?.records ?? [])
          .filter(
            (record) =>
              workspace.transactions[record.txid] &&
              !verifyWalletUtxo(record, workspace.transactions[record.txid], workspace.network),
          )
          .map((record) => `${record.txid}:${record.vout}`),
      ),
    [utxos, workspace.transactions, workspace.network],
  );
  const currentUtxos = useMemo(
    () =>
      (utxos?.records ?? [])
        .filter((record) => !invalidUtxos.has(`${record.txid}:${record.vout}`))
        .sort(
          (a, b) => b.valueSats - a.valueSats || a.txid.localeCompare(b.txid) || a.vout - b.vout,
        ),
    [utxos, invalidUtxos],
  );
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
    [workspace, wallet, utxos, currentUtxos, itemPage],
  );
  const openItems = review.items.filter((item) => item.status === 'open' || item.changed);
  const visibleItems =
    reviewFilter === 'open'
      ? openItems
      : reviewFilter === 'later'
        ? review.items.filter((item) => item.status === 'later' && !item.changed)
        : reviewFilter === 'decided'
          ? // Deferred items are outstanding work, so they never read as reviewed.
            review.items.filter(
              (item) => isCompletedReview(workspace.walletReviews?.[item.key]) && !item.changed,
            )
          : review.items;
  const selectedItem = visibleItems.find((item) => item.key === selectedKey) ?? visibleItems[0];
  const selectedReviewItems = review.items.filter((item) => reviewSelection.ids.includes(item.key));
  const selectedReviewIds = [...new Set(selectedReviewItems.map((item) => item.nodeId))];
  const laterItems = review.items.filter((item) => item.status === 'later' && !item.changed);
  const displayedReviewKeys = visibleItems.slice(0, limit).map((item) => item.key);
  const entityType = (id: string) =>
    id.startsWith('tx:') ? 'transaction' : id.startsWith('addr:') ? 'address' : 'output';
  const metadataTags = (id: string, address?: string) =>
    listTagsForNode(workspace, { id, kind: entityType(id), label: '', address });
  useEffect(
    () => setLimit(PAGE),
    [reviewFilter, tab, recordTab, query, labelFilter, recordReview, tagFilter],
  );
  useEffect(() => {
    recordSelection.clear();
  }, [recordTab]);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedKey || !window.matchMedia('(max-width: 760px)').matches) return;
    detailRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  const transactions = useMemo(
    () => listWalletTransactions(workspace, wallet),
    [workspace.transactions, wallet],
  );
  const addresses = useMemo(
    () => listWalletAddresses(workspace, wallet),
    [workspace.transactions, wallet],
  );
  const rows: RecordRow[] = useMemo(() => {
    if (recordTab === 'utxos')
      return currentUtxos.map((record) => ({
        id: outputNodeId(record.txid, record.vout),
        identifier: `${record.txid}:${record.vout}`,
        amountSats: record.valueSats,
        meta: record.height > 0 ? `Block ${record.height.toLocaleString('en-US')}` : 'Unconfirmed',
        detail: record.address,
        address: record.address,
        utxo: record,
        reviewKey: reviewKey(wallet.id, 'current-utxo', `${record.txid}:${record.vout}`),
      }));
    if (recordTab === 'transactions')
      return transactions.map((record) => ({
        id: txNodeId(record.txid),
        identifier: record.txid,
        meta: record.mempool
          ? 'Unconfirmed'
          : record.height
            ? `Block ${record.height.toLocaleString('en-US')}`
            : 'Height unknown',
        detail: record.transaction
          ? `${record.transaction.vin.length} in / ${record.transaction.vout.length} out`
          : 'Not loaded yet',
        reviewKey: reviewKey(wallet.id, 'new-activity', record.txid),
      }));
    return addresses.map((record) => ({
      id: addressNodeId(record.address),
      identifier: record.address,
      meta: `${record.branch === 0 ? 'Receive' : 'Change'} ${record.index}`,
      detail: `${record.loadedOutputCount} loaded output${record.loadedOutputCount === 1 ? '' : 's'} · ${record.history?.length ?? 0} history entries`,
      address: record.address,
    }));
  }, [recordTab, currentUtxos, transactions, addresses, wallet.id]);

  const rowKind = (tab: RecordTab) =>
    tab === 'transactions'
      ? ('transaction' as const)
      : tab === 'addresses'
        ? ('address' as const)
        : ('output' as const);
  const rowTags = (row: RecordRow) =>
    listTagsForNode(workspace, {
      id: row.id,
      kind: rowKind(recordTab),
      label: '',
      address: row.address,
    });
  const search = query.trim().toLowerCase();
  const filteredRows = rows.filter((row) => {
    const annotation = workspace.annotations[row.id];
    if (
      search &&
      ![row.identifier, annotation?.label, annotation?.note, row.detail].some((value) =>
        value?.toLowerCase().includes(search),
      )
    )
      return false;
    if (labelFilter === 'unlabeled' && annotation?.label?.trim()) return false;
    if (labelFilter === 'labeled' && !annotation?.label?.trim()) return false;
    if (tagFilter !== 'all' && !rowTags(row).some((tag) => tag.id === tagFilter)) return false;

    if (recordReview !== 'all' && row.reviewKey) {
      // Deferred records have their own view and are never treated as completed.
      const completed = isCompletedReview(workspace.walletReviews?.[row.reviewKey]);
      const deferred = workspace.walletReviews?.[row.reviewKey]?.status === 'later';
      if (recordReview === 'open' && (completed || deferred)) return false;
      if (recordReview === 'later' && !deferred) return false;
      if (recordReview === 'decided' && !completed) return false;
    } else if (recordReview !== 'all' && !row.reviewKey) return false;
    return true;
  });
  const visibleIds = new Set(filteredRows.map((row) => row.id));
  const hiddenSelection = selection.filter((id) => !visibleIds.has(id)).length;
  // Filtering never widens an existing selection; it only offers a new explicit scope.
  const selectedIds = selection.filter((id) => rows.some((row) => row.id === id));
  const scopeLabel =
    recordTab === 'utxos'
      ? 'UTXOs selected'
      : recordTab === 'transactions'
        ? 'transactions selected'
        : 'addresses selected';

  function decide(items: readonly WalletReviewItem[], status: ReviewStatus | 'reopen') {
    if (!items.length) return;
    onChange((current) => applyReviewDecisions(current, wallet, items, status));
    reviewSelection.clear();
    if (status === 'reopen') {
      setReviewFilter('open');
      setSelectedKey(items[0].key);
    } else if (selectedItem) {
      // Advance to the next open item deterministically instead of relying on a
      // fallback once the decided item leaves this filter.
      const decided = new Set(items.map((item) => item.key));
      const currentIndex = visibleItems.findIndex((item) => item.key === selectedItem.key);
      const nextItems = [
        ...visibleItems.slice(currentIndex + 1),
        ...visibleItems.slice(0, currentIndex),
      ];
      setSelectedKey(nextItems.find((item) => !decided.has(item.key))?.key);
    }
    setNotice(
      status === 'reopen'
        ? `Reopened ${items.length} item${items.length === 1 ? '' : 's'}.`
        : `Marked ${items.length} item${items.length === 1 ? '' : 's'} as ${
            status === 'reviewed'
              ? 'reviewed'
              : status === 'unknown'
                ? 'reviewed, source unknown'
                : 'review later'
          }.`,
    );
  }

  const coverage = review.coverage;
  const firstUse = !Object.keys(workspace.walletReviews ?? {}).some((key) =>
    key.startsWith(`${wallet.id}|`),
  );
  const guidance = recordTab === 'utxos' ? spendGuidance(workspace, selectedIds) : undefined;

  return (
    <section className="wallet-workbench" aria-label="Wallet review workbench">
      <header className="wallet-review-header">
        <div className="wallet-identity">
          <span className="wallet-eyebrow">Watch-only wallet</span>
          <label className="wallet-picker">
            <WalletIcon size={19} style={{ color: wallet.color }} aria-hidden="true" />
            <select
              aria-label="Selected wallet"
              value={wallet.id}
              onChange={(event) => onSelectWallet(event.target.value)}
            >
              {workspace.wallets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="wallet-review-controls">
          <button
            disabled={!canQuery || busy}
            title={queryDisabledReason ?? 'Check wallet history for new transactions'}
            onClick={onRefresh}
          >
            <RefreshCw size={14} /> {wallet.scannedAt ? 'Refresh wallet' : 'Scan wallet'}
          </button>
          <button
            disabled={!canQuery || utxoLoading}
            title="Check unspent outputs at the discovered wallet addresses"
            onClick={() => void check()}
          >
            <RefreshCw size={13} /> {utxoLoading ? 'Checking UTXOs…' : 'Check current UTXOs'}
          </button>
        </div>
      </header>

      <dl className="wallet-coverage" aria-label="Wallet coverage">
        <div>
          <dt>Wallet refreshed</dt>
          <dd title={wallet.scannedAt ? new Date(wallet.scannedAt).toLocaleString() : undefined}>
            {walletCheckAge(wallet.scannedAt)}
            {wallet.scannedAt && !coverage.scanComplete ? ' · partial discovery' : ''}
          </dd>
        </div>
        <div>
          <dt>Addresses</dt>
          <dd>
            {coverage.usedAddresses} used of {coverage.discoveredAddresses} discovered
          </dd>
        </div>
        <div>
          <dt>History</dt>
          <dd>
            {coverage.loadedTransactions} of {coverage.knownTransactions} known transactions loaded
            {coverage.pendingTransactions ? ` · ${coverage.pendingTransactions} queued` : ''}
          </dd>
        </div>
        <div>
          <dt>Current UTXOs</dt>
          <dd>
            {coverage.utxoCount === undefined ? (
              canQuery ? (
                'Not checked yet'
              ) : (
                'Backend unavailable'
              )
            ) : (
              <>
                {coverage.utxoCount} unspent · {formatSats(coverage.utxoBalanceSats)}
                {coverage.utxoPartial ? ' · partial check' : ''}
              </>
            )}
          </dd>
        </div>
      </dl>
      <div className="wallet-coverage-actions">
        {utxos?.nextCursor !== undefined && (
          <button disabled={!canQuery || utxoLoading} onClick={() => void check(utxos.nextCursor)}>
            Check next addresses
          </button>
        )}
        {utxos && (
          <span className="small muted" title={utxos.checkedAt}>
            UTXOs checked · {utxos.checkedAddresses} / {utxos.totalAddresses} addresses ·{' '}
            {new Date(utxos.checkedAt).toLocaleTimeString()}
            {utxos.failed ? ` · ${utxos.failed} failed` : ''}
          </span>
        )}
        {!canQuery && <span className="small muted">{queryDisabledReason}</span>}
      </div>
      <div aria-live="polite" className="wallet-review-messages">
        {utxoError && (
          <p role="alert" className="small warning">
            {utxoError}
          </p>
        )}
        {invalidUtxos.size > 0 && (
          <p role="alert" className="small warning">
            {invalidUtxos.size} UTXO observations disagree with their loaded transactions and are
            excluded. Check again to retry.
          </p>
        )}
      </div>

      <nav className="wallet-review-tabs" aria-label="Wallet sections">
        <button
          aria-pressed={tab === 'review'}
          className={tab === 'review' ? 'active' : ''}
          onClick={() => setTab('review')}
        >
          <ListChecks size={14} /> To review
          <span className="wallet-count">
            {openItems.length}
            {review.omittedPendingItems ? '+' : ''}
          </span>
        </button>
        <button
          aria-pressed={tab === 'records'}
          className={tab === 'records' ? 'active' : ''}
          onClick={() => setTab('records')}
        >
          <Search size={14} /> Records
        </button>
      </nav>

      <div aria-live="polite" className="wallet-review-status-line">
        {notice && <p className="small wallet-review-notice">{notice}</p>}
      </div>
      {tab === 'review' ? (
        <div className="wallet-review-body">
          <div className="wallet-review-filters">
            <label>
              Show
              <select
                aria-label="Review filter"
                value={reviewFilter}
                onChange={(event) =>
                  setReviewFilter(event.target.value as 'open' | 'later' | 'decided' | 'all')
                }
              >
                <option value="open">To review</option>
                <option value="later">Review later ({laterItems.length})</option>
                <option value="decided">Reviewed</option>
                <option value="all">All items</option>
              </select>
            </label>
            <span className="small muted">
              {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}
              {review.missingSourceTransactions
                ? ` · ${review.missingSourceTransactions} UTXO sources not loaded`
                : ''}
            </span>
            {review.omittedItems > 0 && (
              <span className="small wallet-review-bound">
                {review.omittedItems} more record{review.omittedItems === 1 ? '' : 's'} not listed
                yet
                {review.omittedPendingItems
                  ? `, including ${review.omittedPendingItems} still to review`
                  : ''}
                .
              </span>
            )}
            {review.omittedItems > 0 && (
              <button onClick={() => setItemPage((current) => current + 1)}>
                Load more records
              </button>
            )}
            <button
              disabled={!visibleItems.length}
              onClick={() => reviewSelection.setIds(visibleItems.map((item) => item.key))}
            >
              Select {visibleItems.length} matching
            </button>
          </div>
          {firstUse && (
            <p className="wallet-first-use">
              Start with a UTXO: add its source, then mark it reviewed. Use checkboxes to edit
              several items together.
            </p>
          )}
          {selectedReviewIds.length > 0 && (
            <div className="wallet-review-batch">
              <BatchMetadataBar
                active={active}
                workspace={workspace}
                ids={selectedReviewIds}
                scopeLabel="entities selected"
                disabled={busy}
                onChange={onChange}
                onNotice={setNotice}
                onClear={reviewSelection.clear}
                guidance={
                  selectedReviewItems.some(
                    (item) => !visibleItems.some((visible) => visible.key === item.key),
                  )
                    ? `${selectedReviewItems.filter((item) => !visibleItems.some((visible) => visible.key === item.key)).length} selected items are outside this filter and remain in the batch.`
                    : undefined
                }
              />
              <div className="wallet-batch-review-actions">
                <button disabled={busy} onClick={() => decide(selectedReviewItems, 'reviewed')}>
                  <Check size={13} /> Mark {selectedReviewItems.length} reviewed
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    decide(selectedReviewItems, reviewFilter === 'later' ? 'reopen' : 'later')
                  }
                >
                  <Clock3 size={13} />{' '}
                  {reviewFilter === 'later' ? 'Return selected to review' : 'Review selected later'}
                </button>
                <span className="small muted">
                  {selectedReviewItems.length} review items · {selectedReviewIds.length} unique
                  entities
                </span>
              </div>
            </div>
          )}
          {!visibleItems.length ? (
            <p className="wallet-empty-note">
              {reviewFilter === 'later'
                ? 'No items set aside for later.'
                : reviewFilter === 'decided'
                  ? 'Nothing has been reviewed yet.'
                  : review.omittedItems > 0
                    ? 'No items in this view yet. More records are not listed; load more records to continue.'
                    : coverage.utxoCount === undefined
                      ? 'Check current UTXOs to build the review queue from your live coins.'
                      : laterItems.length
                        ? `${laterItems.length} items are set aside in Review later. No other items are waiting in this view.`
                        : 'Nothing to review. Refresh the wallet or check UTXOs again after new activity.'}
            </p>
          ) : (
            <div
              className={`wallet-review-grid ${selectedReviewIds.length ? 'has-batch-selection' : ''}`}
            >
              <div className="wallet-review-list" role="list" aria-label="Review queue">
                {visibleItems.slice(0, limit).map((item) => (
                  <div
                    className={`wallet-review-item ${reviewSelection.ids.includes(item.key) ? 'batch-selected' : ''}`}
                    role="listitem"
                    key={item.key}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select review item ${item.title}`}
                      checked={reviewSelection.ids.includes(item.key)}
                      onChange={() => {}}
                      onClick={(event) =>
                        reviewSelection.choose(item.key, displayedReviewKeys, event, true)
                      }
                    />
                    <button
                      className={selectedItem?.key === item.key ? 'active' : ''}
                      aria-pressed={selectedItem?.key === item.key}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey || event.shiftKey)
                          reviewSelection.choose(item.key, displayedReviewKeys, event);
                        else {
                          reviewSelection.clear();
                          reviewSelection.anchorAt(item.key);
                          setSelectedKey(item.key);
                        }
                      }}
                    >
                      <span className="wallet-review-reason">
                        {REASON_LABELS[item.reason]}
                        <span className={`wallet-review-status status-${item.status}`}>
                          {statusLabel(item)}
                        </span>
                      </span>
                      <strong className="wallet-item-title">
                        <span className="wallet-entity-icon" aria-hidden="true">
                          {workspace.annotations[item.nodeId]?.icon}
                        </span>
                        {item.label || item.title}
                      </strong>
                      {metadataTags(item.nodeId, item.address).length > 0 && (
                        <span className="wallet-item-tags">
                          {metadataTags(item.nodeId, item.address).map((tag) => (
                            <span className="wallet-review-record-tag" key={tag.id}>
                              <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                              {tag.name}
                            </span>
                          ))}
                        </span>
                      )}
                      {workspace.annotations[item.nodeId]?.note && (
                        <span
                          className="wallet-item-note"
                          title={workspace.annotations[item.nodeId].note}
                        >
                          {workspace.annotations[item.nodeId].note}
                        </span>
                      )}
                      <span className="muted">
                        {[
                          item.amountSats !== undefined ? formatSats(item.amountSats) : undefined,
                          item.address
                            ? short(item.address, 8)
                            : item.txid && item.amountSats === undefined
                              ? short(item.txid, 8)
                              : undefined,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
                  </div>
                ))}
                {visibleItems.length > limit && (
                  <button onClick={() => setLimit((current) => current + PAGE)}>
                    Show more ({visibleItems.length - limit} remaining)
                  </button>
                )}
              </div>
              {selectedItem && selectedReviewIds.length === 0 && (
                <article
                  ref={detailRef}
                  className="wallet-review-detail"
                  aria-label="Selected review item"
                >
                  <span className="wallet-review-reason">
                    {REASON_LABELS[selectedItem.reason]}
                    <span className={`wallet-review-status status-${selectedItem.status}`}>
                      {statusLabel(selectedItem)}
                    </span>
                  </span>
                  <h2 className="wallet-item-title">
                    <span className="wallet-entity-icon" aria-hidden="true">
                      {workspace.annotations[selectedItem.nodeId]?.icon}
                    </span>
                    {selectedItem.label || selectedItem.title}
                  </h2>
                  {selectedItem.label && <p className="small muted">{selectedItem.title}</p>}
                  {workspace.annotations[selectedItem.nodeId]?.note && (
                    <p className="wallet-detail-note">
                      {workspace.annotations[selectedItem.nodeId].note}
                    </p>
                  )}
                  <p>{selectedItem.detail}</p>
                  {selectedItem.changed && (
                    <p className="wallet-review-notice">
                      The observations behind this item changed after your decision on{' '}
                      {selectedItem.decidedAt
                        ? new Date(selectedItem.decidedAt).toLocaleString()
                        : 'an earlier check'}
                      . Review it again or reopen it.
                    </p>
                  )}
                  <dl className="wallet-review-evidence">
                    <div>
                      <dt>
                        {entityType(selectedItem.nodeId) === 'output'
                          ? 'Outpoint'
                          : entityType(selectedItem.nodeId)}
                      </dt>
                      <dd
                        className="mono"
                        title={selectedItem.nodeId.replace(/^(out|tx|addr):/, '')}
                      >
                        {short(selectedItem.nodeId.replace(/^(out|tx|addr):/, ''), 14)}
                      </dd>
                    </div>
                    {selectedItem.address && (
                      <div>
                        <dt>Address</dt>
                        <dd className="mono" title={selectedItem.address}>
                          {short(selectedItem.address, 16)}
                        </dd>
                      </div>
                    )}
                    {selectedItem.amountSats !== undefined && (
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatSats(selectedItem.amountSats)}</dd>
                      </div>
                    )}
                    {selectedItem.tags.length > 0 && (
                      <div>
                        <dt>Tags</dt>
                        <dd>{selectedItem.tags.join(', ')}</dd>
                      </div>
                    )}
                  </dl>
                  <BatchMetadataBar
                    active={active}
                    workspace={workspace}
                    ids={[selectedItem.nodeId]}
                    key={selectedItem.nodeId}
                    single
                    scopeLabel={`Edit ${entityType(selectedItem.nodeId)}`}
                    disabled={busy}
                    onChange={onChange}
                    onNotice={setNotice}
                  />
                  <div className="button-row wallet-review-decisions">
                    {(!isCompletedReview(workspace.walletReviews?.[selectedItem.key]) ||
                      selectedItem.changed) && (
                      <>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => decide([selectedItem], 'reviewed')}
                        >
                          Mark reviewed
                        </button>
                        <button disabled={busy} onClick={() => decide([selectedItem], 'unknown')}>
                          <CircleHelp size={14} /> Reviewed, source unknown
                        </button>
                        <button
                          disabled={busy}
                          aria-pressed={selectedItem.status === 'later'}
                          title={
                            selectedItem.status === 'later'
                              ? 'Return this item to To review'
                              : 'Set aside for later and select the next item'
                          }
                          onClick={() =>
                            decide(
                              [selectedItem],
                              selectedItem.status === 'later' ? 'reopen' : 'later',
                            )
                          }
                        >
                          <Clock3 size={14} />{' '}
                          {selectedItem.status === 'later' ? 'Return to review' : 'Review later'}
                        </button>
                      </>
                    )}
                    {isCompletedReview(workspace.walletReviews?.[selectedItem.key]) && (
                      <button disabled={busy} onClick={() => decide([selectedItem], 'reopen')}>
                        <Undo2 size={14} /> Reopen
                      </button>
                    )}
                  </div>
                  <div className="button-row">
                    <button onClick={() => onShowInGraph(selectedItem.nodeId)}>
                      <Network size={14} /> Show in Graph
                    </button>
                    <button onClick={() => onInspect(selectedItem.nodeId)}>
                      <Eye size={14} /> Inspect
                    </button>
                    <button onClick={() => onAnalyze(selectedItem.nodeId)}>
                      <Search size={14} /> Analyze
                    </button>
                  </div>
                  {selectedItem.reason === 'link' && (
                    <p className="small muted">
                      This is a heuristic hypothesis from your last analysis scan, not proof of
                      common ownership. Collaborative transactions such as CoinJoin and PayJoin can
                      invalidate it. Removing or excluding the finding removes this item.
                    </p>
                  )}
                  {selectedItem.reason === 'counterparty' && (
                    <p className="small muted">
                      Label the payment output or your relationship. Labelling it does not make the
                      other outputs of this transaction yours, and does not claim who controls this
                      address.
                    </p>
                  )}
                </article>
              )}
            </div>
          )}
          {!review.items.some((item) => item.reason === 'link') && (
            <p className="wallet-grouping-note">
              No grouping findings apply to this wallet yet. Grouping is unknown until you run an
              analysis scan on loaded data.{' '}
              <button className="text-button" onClick={() => onAnalyze()}>
                Analyze this wallet <ChevronRight size={13} />
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="wallet-review-body">
          <nav className="wallet-record-tabs" aria-label="Wallet records">
            {(['utxos', 'transactions', 'addresses'] as const).map((item) => (
              <button
                key={item}
                aria-pressed={recordTab === item}
                className={recordTab === item ? 'active' : ''}
                onClick={() => setRecordTab(item)}
              >
                {item === 'utxos'
                  ? 'UTXOs'
                  : item === 'transactions'
                    ? 'Transactions'
                    : 'Addresses'}
              </button>
            ))}
          </nav>
          <div className="wallet-record-filters">
            <label className="wallet-record-search">
              Search
              <input
                type="search"
                aria-label="Filter wallet records"
                placeholder="Labels, notes or IDs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              Labels
              <select
                aria-label="Label filter"
                value={labelFilter}
                onChange={(event) =>
                  setLabelFilter(event.target.value as 'all' | 'unlabeled' | 'labeled')
                }
              >
                <option value="all">All</option>
                <option value="unlabeled">Unlabeled</option>
                <option value="labeled">Labelled</option>
              </select>
            </label>
            {recordTab !== 'addresses' && (
              <label>
                Review
                <select
                  aria-label="Review state filter"
                  value={recordReview}
                  onChange={(event) =>
                    setRecordReview(event.target.value as 'all' | 'open' | 'later' | 'decided')
                  }
                >
                  <option value="all">All</option>
                  <option value="open">To review</option>
                  <option value="later">Review later</option>
                  <option value="decided">Reviewed</option>
                </select>
              </label>
            )}
            {(workspace.tags ?? []).length > 0 && (
              <label>
                Tag
                <select
                  aria-label="Tag filter"
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                >
                  <option value="all">Any tag</option>
                  {(workspace.tags ?? []).map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="wallet-selection-hint">
            Choose records below, then use Label, Tag or Icon.{' '}
            <span className="desktop-selection-hint">
              Ctrl/⌘ click toggles · Shift click selects a range.
            </span>
          </p>
          <div className="wallet-record-summary">
            <span className="small muted">
              {filteredRows.length} of {rows.length} {recordTab === 'utxos' ? 'UTXOs' : recordTab}
              {recordTab === 'utxos' && utxos === undefined ? ' · check UTXOs to load them' : ''}
            </span>
            <button
              disabled={!filteredRows.length}
              onClick={() =>
                setSelection([...new Set([...selectedIds, ...filteredRows.map((row) => row.id)])])
              }
            >
              Select {filteredRows.length} matching
            </button>
          </div>
          {hiddenSelection > 0 && (
            <p className="small muted">
              {hiddenSelection} selected record{hiddenSelection === 1 ? '' : 's'} outside the
              current filter stay part of the batch. Clear the selection to drop them.
            </p>
          )}
          <BatchMetadataBar
            active={active}
            workspace={workspace}
            ids={selectedIds}
            scopeLabel={scopeLabel}
            disabled={busy}
            guidance={guidance}
            onChange={onChange}
            onNotice={setNotice}
            onClear={recordSelection.clear}
          />
          <div className="wallet-review-records" role="list">
            {filteredRows.slice(0, limit).map((row) => {
              const annotation = workspace.annotations[row.id];
              const decision = row.reviewKey ? workspace.walletReviews?.[row.reviewKey] : undefined;
              const checked = selectedIds.includes(row.id);
              return (
                <div
                  className={`wallet-review-record ${checked ? 'selected' : ''}`}
                  role="listitem"
                  key={row.id}
                >
                  <label className="wallet-review-record-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`Select ${row.identifier}`}
                      onChange={() => {}}
                      onClick={(event) =>
                        recordSelection.choose(
                          row.id,
                          filteredRows.slice(0, limit).map((entry) => entry.id),
                          event,
                          true,
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="wallet-review-record-body"
                    aria-label={`Select record ${row.identifier}`}
                    aria-pressed={checked}
                    onClick={(event) =>
                      recordSelection.choose(
                        row.id,
                        filteredRows.slice(0, limit).map((entry) => entry.id),
                        event,
                      )
                    }
                  >
                    <span className="wallet-review-record-title">
                      <span aria-hidden="true">{annotation?.icon}</span>
                      <strong title={row.identifier}>
                        {annotation?.label || short(row.identifier, 12)}
                      </strong>
                      {decision && (
                        <span className={`wallet-review-status status-${decision.status}`}>
                          {decision.status === 'reviewed'
                            ? 'Reviewed'
                            : decision.status === 'unknown'
                              ? 'Source unknown'
                              : 'Review later'}
                        </span>
                      )}
                    </span>
                    {annotation?.note && (
                      <span className="wallet-item-note" title={annotation.note}>
                        {annotation.note}
                      </span>
                    )}
                    {annotation?.label && (
                      <span className="mono muted wallet-review-record-id" title={row.identifier}>
                        {short(row.identifier, 14)}
                      </span>
                    )}
                    <span className="wallet-review-record-meta">
                      <span>{row.meta}</span>
                      {row.amountSats !== undefined && <span>{formatSats(row.amountSats)}</span>}
                      {row.detail && <span className="muted">{row.detail}</span>}
                      {rowTags(row).map((tag) => (
                        <span className="wallet-review-record-tag" key={tag.id}>
                          <span className="tag-dot" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  </button>
                  <div className="wallet-review-record-actions">
                    <button
                      className="text-button"
                      aria-label={`Inspect ${row.identifier}`}
                      onClick={() => onInspect(row.id, row.utxo)}
                    >
                      Inspect
                    </button>
                    <button
                      className="text-button"
                      aria-label={`Show ${row.identifier} in Graph`}
                      onClick={() => onShowInGraph(row.id, row.utxo)}
                    >
                      Graph
                    </button>
                  </div>
                </div>
              );
            })}
            {!filteredRows.length && (
              <p className="wallet-empty-note">
                {rows.length
                  ? 'No records match these filters.'
                  : recordTab === 'utxos'
                    ? 'No current UTXOs from the addresses checked so far.'
                    : 'Scan this wallet to discover records.'}
              </p>
            )}
            {filteredRows.length > limit && (
              <button onClick={() => setLimit((current) => current + PAGE)}>
                Show more ({filteredRows.length - limit} remaining)
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
