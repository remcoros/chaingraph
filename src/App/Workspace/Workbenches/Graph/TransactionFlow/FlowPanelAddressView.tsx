import { useState, useRef, type ReactNode, type RefObject } from 'react';
import { Box, Bookmark, Layers } from 'lucide-react';
import { Amount } from '../../../../Controls/Display/Amount';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
import { TransactionBlockTime } from '../../../../Controls/Display/TransactionBlockTime';
import { transactionStatus } from '../../../../../Domain/Chain/transactionStatus';
import {
  addressBalanceSats,
  paginateAddressHistorySections,
  type AddressHistory,
} from '../../../../../Domain/Chain/addressHistory';
import { formatLocalTimestamp } from '../../../../../Domain/Chain/transactionTime';
import {
  txNodeId,
  type AddressBalanceObservation,
  type AddressUtxoObservation,
  type GraphNode,
  type Workspace,
} from '../../../../../Domain/types';

export interface FlowPanelAddressViewProps {
  workspace: Workspace;
  selected?: GraphNode;
  disabledReason?: string;
  renderMetadata?: (nodeId: string) => ReactNode;
  addressHistory?: AddressHistory;
  addressHistoryLoad?: {
    phase: 'history' | 'details' | 'balance';
    done: number;
    total: number;
    error?: string;
  };
  addressBalance?: AddressBalanceObservation;
  addressUtxos?: AddressUtxoObservation;
  onLoadAddressHistory?: (force?: boolean) => void;
  onLoadAddressUtxos?: (force?: boolean) => void;
  onOpenAddressHistoryTransaction?: (txid: string, height?: number, vout?: number) => void;
}

function checkedAtLabel(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not checked';
  return `Checked ${formatLocalTimestamp(value) ?? 'Unknown time'}`;
}

function AddressHistorySection<T>({
  idPrefix,
  section,
  label,
  items,
  visibleItems,
  collapsed,
  onToggle,
  sectionRef,
  renderItem,
}: {
  idPrefix: string;
  section: string;
  label: string;
  items: readonly T[];
  visibleItems: readonly T[];
  collapsed: boolean;
  onToggle: () => void;
  sectionRef: RefObject<HTMLElement | null>;
  renderItem: (item: T) => ReactNode;
}) {
  const listId = `${idPrefix}-${section}-list`;
  return (
    <section id={`${idPrefix}-${section}`} className="address-history-section" ref={sectionRef}>
      <h4 className="address-history-section-heading">
        <button
          type="button"
          className="address-history-section-toggle"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={onToggle}
        >
          {label} ({items.length})
        </button>
      </h4>
      {!collapsed && (
        <div id={listId} className="address-history-list" role="list">
          {visibleItems.map(renderItem)}
        </div>
      )}
    </section>
  );
}

/** The address view's title bar contribution. */
/** The address view's title bar, which it owns end to end. */
/** The address view's header, which it owns end to end. */
export function AddressFlowHeader({
  nodeId,
  annotation,
  addressHistory,
  addressHistoryLoad: load,
  addressBalance,
}: Pick<FlowPanelAddressViewProps, 'addressHistory' | 'addressHistoryLoad' | 'addressBalance'> & {
  nodeId: string;
  annotation?: { icon?: string; bookmarked?: boolean };
}) {
  return (
    <span className="flow-panel-header">
      <span className="flow-panel-title">
        <Layers size={16} aria-hidden="true" />
        {annotation?.icon && (
          <span
            className="flow-panel-title-annotation"
            role="img"
            aria-label={`Annotation icon: ${annotation.icon}`}
          >
            {annotation.icon}
          </span>
        )}
        {annotation?.bookmarked && (
          <Bookmark size={14} className="flow-panel-title-bookmark" aria-label="Bookmarked" />
        )}
        <span>Address</span>
        <code title={nodeId.replace(/^addr:/, '')}>
          <ResponsiveIdentifier value={nodeId} preferFull />
        </code>
      </span>
      <small>
        {load?.error
          ? 'Address history unavailable'
          : load?.phase === 'history'
            ? 'Checking address history…'
            : load?.phase === 'details'
              ? `Loading history ${load.done}/${load.total}`
              : load?.phase === 'balance'
                ? 'Checking address balance…'
                : addressHistory
                  ? `${addressHistory.knownCount} known transactions`
                  : 'History not loaded'}
        {addressHistory && (
          <>
            {' · Balance '}
            <Amount value={addressBalanceSats(addressBalance)} unknown="Unknown" />
          </>
        )}
      </small>
    </span>
  );
}

export function FlowPanelAddressView({ panel }: { panel: FlowPanelAddressViewProps }) {
  const {
    workspace,
    selected,
    disabledReason,
    renderMetadata,
    addressUtxos,
    addressHistoryLoad: loading,
    onLoadAddressHistory: onLoad,
    onLoadAddressUtxos: onLoadUtxos,
    onOpenAddressHistoryTransaction: onOpenTransaction,
  } = panel;
  const history = panel.addressHistory ?? {
    address: selected?.address ?? '',
    entries: [],
    knownCount: 0,
    loadedCount: 0,
    unloadedCount: 0,
    complete: false,
    source: 'loaded transactions',
  };
  const [limit, setLimit] = useState(40);
  const [utxoLimit, setUtxoLimit] = useState(40);
  const [tab, setTab] = useState<'transactions' | 'utxos'>('transactions');
  const [collapsedUtxoSections, setCollapsedUtxoSections] = useState({
    pending: false,
    confirmed: false,
    unknown: false,
  });
  const [collapsedTransactionSections, setCollapsedTransactionSections] = useState({
    pending: false,
    confirmed: false,
    unknown: false,
  });
  const pendingUtxosSection = useRef<HTMLElement>(null);
  const confirmedUtxosSection = useRef<HTMLElement>(null);
  const unknownUtxosSection = useRef<HTMLElement>(null);
  const pendingTransactionsSection = useRef<HTMLElement>(null);
  const confirmedTransactionsSection = useRef<HTMLElement>(null);
  const unknownTransactionsSection = useRef<HTMLElement>(null);
  const pendingTransactions = history.entries.filter((entry) => entry.mempool);
  const confirmedTransactions = history.entries.filter(
    (entry) => !entry.mempool && entry.height !== undefined && entry.height > 0,
  );
  const unknownTransactions = history.entries.filter(
    (entry) => !entry.mempool && (entry.height === undefined || entry.height <= 0),
  );
  const [visiblePendingTransactions, visibleConfirmedTransactions, visibleUnknownTransactions] =
    paginateAddressHistorySections(
      [
        { items: pendingTransactions, collapsed: collapsedTransactionSections.pending },
        { items: confirmedTransactions, collapsed: collapsedTransactionSections.confirmed },
        { items: unknownTransactions, collapsed: collapsedTransactionSections.unknown },
      ],
      limit,
    );
  const visibleTransactionCount =
    visiblePendingTransactions.length +
    visibleConfirmedTransactions.length +
    visibleUnknownTransactions.length;
  const expandedTransactionCount =
    (collapsedTransactionSections.pending ? 0 : pendingTransactions.length) +
    (collapsedTransactionSections.confirmed ? 0 : confirmedTransactions.length) +
    (collapsedTransactionSections.unknown ? 0 : unknownTransactions.length);
  const pendingUtxos = addressUtxos?.utxos.filter((utxo) => utxo.height === 0) ?? [];
  const confirmedUtxos = addressUtxos?.utxos.filter((utxo) => utxo.height > 0) ?? [];
  const unknownUtxos = addressUtxos?.utxos.filter((utxo) => utxo.height < 0) ?? [];
  const [visiblePendingUtxos, visibleConfirmedUtxos, visibleUnknownUtxos] =
    paginateAddressHistorySections(
      [
        { items: pendingUtxos, collapsed: collapsedUtxoSections.pending },
        { items: confirmedUtxos, collapsed: collapsedUtxoSections.confirmed },
        { items: unknownUtxos, collapsed: collapsedUtxoSections.unknown },
      ],
      utxoLimit,
    );
  const visibleUtxoCount =
    visiblePendingUtxos.length + visibleConfirmedUtxos.length + visibleUnknownUtxos.length;
  const expandedUtxoCount =
    (collapsedUtxoSections.pending ? 0 : pendingUtxos.length) +
    (collapsedUtxoSections.confirmed ? 0 : confirmedUtxos.length) +
    (collapsedUtxoSections.unknown ? 0 : unknownUtxos.length);
  const hasLoad = !!onLoad;
  const hasLoadUtxos = !!onLoadUtxos;
  const isLoading = !!loading && !loading.error;
  const canLoad = !!onLoad && !disabledReason && !isLoading;
  const canLoadUtxos = !!onLoadUtxos && !disabledReason;
  const jumpToUtxoSection = (section: 'pending' | 'confirmed' | 'unknown') => {
    setCollapsedUtxoSections((current) => ({ ...current, [section]: false }));
    requestAnimationFrame(() => {
      (section === 'pending'
        ? pendingUtxosSection
        : section === 'confirmed'
          ? confirmedUtxosSection
          : unknownUtxosSection
      ).current?.scrollIntoView({ block: 'start' });
    });
  };
  const jumpToTransactionSection = (section: 'pending' | 'confirmed' | 'unknown') => {
    setCollapsedTransactionSections((current) => ({ ...current, [section]: false }));
    requestAnimationFrame(() => {
      (section === 'pending'
        ? pendingTransactionsSection
        : section === 'confirmed'
          ? confirmedTransactionsSection
          : unknownTransactionsSection
      ).current?.scrollIntoView({ block: 'start' });
    });
  };
  const showCoverage =
    !!loading ||
    (tab === 'transactions' &&
      ((!history.complete && history.source !== 'loaded transactions') ||
        history.unloadedCount > 0 ||
        (canLoad && (history.source === 'loaded transactions' || !history.complete))));
  const renderUtxo = (utxo: AddressUtxoObservation['utxos'][number]) => {
    const transaction = workspace.transactions[utxo.txid];
    const timestampTransaction =
      utxo.height > 0 &&
      transaction &&
      (transaction.blockHeight === undefined || transaction.blockHeight === utxo.height)
        ? { ...transaction, blockHeight: utxo.height, mempool: undefined }
        : undefined;
    return (
      <button
        key={`${utxo.txid}:${utxo.vout}`}
        type="button"
        role="listitem"
        className="address-history-row address-utxo-row"
        disabled={!onOpenTransaction}
        aria-label={`Open unspent output ${utxo.txid}:${utxo.vout}`}
        title="Open this output's transaction in the graph"
        onClick={() => onOpenTransaction?.(utxo.txid, utxo.height, utxo.vout)}
      >
        <span className="address-history-row-main">
          <span className="address-history-row-identity">
            <span className="address-history-row-title">
              <Box size={13} className="address-history-row-transaction-icon" aria-hidden="true" />
              <strong>
                <ResponsiveIdentifier value={`${utxo.txid}:${utxo.vout}`} preferFull />
              </strong>
            </span>
            <span className="address-history-row-body">
              {utxo.height > 0 ? (
                <span className="address-history-row-utxo-status">
                  <span>#{utxo.height}</span>
                  <span aria-hidden="true">·</span>
                  {timestampTransaction ? (
                    <TransactionBlockTime
                      transaction={timestampTransaction}
                      workspace={workspace}
                      showFee={false}
                      timestampOnly
                    />
                  ) : (
                    <span>Timestamp not loaded</span>
                  )}
                </span>
              ) : (
                <span>{utxo.height === 0 ? 'Pending' : 'Status unknown'}</span>
              )}
            </span>
          </span>
        </span>
        <span className="address-history-row-amounts">
          <Amount value={utxo.valueSats} />
        </span>
      </button>
    );
  };
  const renderHistoryEntry = (entry: AddressHistory['entries'][number]) => {
    const transactionNodeId = txNodeId(entry.txid);
    const annotation = workspace.annotations[transactionNodeId];
    const metadata = renderMetadata?.(transactionNodeId);
    const observedStatus = entry.transaction ? transactionStatus(entry.transaction) : undefined;
    const status =
      observedStatus && observedStatus.kind !== 'unknown'
        ? observedStatus.label
        : entry.mempool
          ? 'Unconfirmed'
          : entry.height !== undefined && entry.height > 0
            ? `#${entry.height}`
            : 'Status unknown';
    return (
      <button
        key={entry.txid}
        type="button"
        role="listitem"
        className={`address-history-row${entry.onGraph && !entry.hidden ? ' is-on-graph' : ''}`}
        disabled={(!entry.transaction && !!disabledReason) || !onOpenTransaction}
        aria-label={`${entry.transaction ? 'Open' : 'Load'} transaction ${entry.txid}`}
        title={
          !entry.transaction && disabledReason
            ? disabledReason
            : entry.hidden
              ? 'Open transaction and show it in the graph'
              : entry.onGraph
                ? 'Open transaction in the graph'
                : 'Add transaction to the graph and open it'
        }
        onClick={() => onOpenTransaction?.(entry.txid, entry.height)}
      >
        <span className="address-history-row-main">
          <span className="address-history-row-identity">
            <span className="address-history-row-title">
              <Box size={13} className="address-history-row-transaction-icon" aria-hidden="true" />
              {annotation?.icon && (
                <span
                  className="address-history-row-annotation-icon"
                  role="img"
                  aria-label={`Annotation icon: ${annotation.icon}`}
                >
                  {annotation.icon}
                </span>
              )}
              {annotation?.bookmarked && (
                <Bookmark
                  size={13}
                  className="address-history-row-bookmark-icon"
                  aria-label="Bookmarked"
                />
              )}
              <strong>
                <ResponsiveIdentifier value={entry.txid} preferFull />
              </strong>
            </span>
            {(annotation?.label || metadata) && (
              <span className="address-history-row-body">
                {annotation?.label && (
                  <span className="address-history-row-label">{annotation.label}</span>
                )}
                {metadata}
              </span>
            )}
          </span>
        </span>
        <span className="address-history-row-direction">
          {entry.height !== undefined && entry.height > 0 ? (
            <span className="address-history-row-utxo-status">
              <span>#{entry.height}</span>
              <span aria-hidden="true">·</span>
              {entry.transaction ? (
                <TransactionBlockTime
                  transaction={entry.transaction}
                  workspace={workspace}
                  timestampOnly
                />
              ) : (
                <span>Timestamp not loaded</span>
              )}
            </span>
          ) : entry.mempool ? (
            <span>Pending</span>
          ) : (
            <span>{status}</span>
          )}
        </span>
        <span className="address-history-row-detail">
          {entry.transaction && (
            <span>
              {entry.transaction.vin.length} in / {entry.transaction.vout.length} out
            </span>
          )}
        </span>
        <span className="address-history-row-amounts">
          {entry.receivedSats !== undefined && (
            <span>
              + <Amount value={entry.receivedSats} />
            </span>
          )}
          {entry.spentSats !== undefined && (
            <span>
              - <Amount value={entry.spentSats} />
            </span>
          )}
          {!entry.transaction && <span>Load details</span>}
        </span>
      </button>
    );
  };
  return (
    <div className="flow-panel-body">
      <div className="address-history-view" aria-label="Address history">
        <div className="address-history-sticky">
          <div className="address-history-header">
            <div className="address-history-tabs" role="tablist" aria-label="Address details">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'transactions'}
                className={tab === 'transactions' ? 'active' : undefined}
                onClick={() => setTab('transactions')}
              >
                Transactions
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'utxos'}
                className={tab === 'utxos' ? 'active' : undefined}
                onClick={() => {
                  setTab('utxos');
                  if (!addressUtxos && canLoadUtxos) onLoadUtxos?.(false);
                }}
              >
                UTXOs
              </button>
            </div>
            <div className="address-history-header-actions">
              {tab === 'transactions' && hasLoad && (
                <button
                  type="button"
                  className="text-button"
                  disabled={!!disabledReason || isLoading}
                  onClick={() => onLoad?.(true)}
                >
                  Refresh
                </button>
              )}
              {tab === 'utxos' && hasLoadUtxos && (
                <button
                  type="button"
                  className="text-button"
                  disabled={!!disabledReason}
                  onClick={() => onLoadUtxos?.(true)}
                >
                  Refresh
                </button>
              )}
              {(tab === 'transactions' ? hasLoad : hasLoadUtxos) && (
                <span aria-hidden="true">·</span>
              )}
              <span>
                {tab === 'transactions'
                  ? checkedAtLabel(history.checkedAt)
                  : checkedAtLabel(addressUtxos?.checkedAt)}
              </span>
            </div>
          </div>
          {showCoverage && (
            <div className="address-history-coverage">
              {loading?.error && <span className="address-history-error">{loading.error}</span>}
              {loading && !loading.error && (
                <span className="address-history-loading">
                  {loading.phase === 'history'
                    ? 'Checking address history…'
                    : loading.phase === 'details'
                      ? `Loading history details ${loading.done}/${loading.total}`
                      : 'Checking address balance…'}
                </span>
              )}
              {tab === 'transactions' &&
                !history.complete &&
                history.source !== 'loaded transactions' && (
                  <span className="address-history-partial">Coverage is partial</span>
                )}
              {tab === 'transactions' && history.unloadedCount > 0 && (
                <span>
                  {history.unloadedCount} detail{history.unloadedCount === 1 ? '' : 's'} not loaded
                </span>
              )}
              {tab === 'transactions' &&
                canLoad &&
                (history.source === 'loaded transactions' || !history.complete) && (
                  <button
                    type="button"
                    className="text-button"
                    title="Load the address history from the backend"
                    onClick={() => onLoad?.(false)}
                  >
                    Load address history
                  </button>
                )}
            </div>
          )}
          {tab === 'transactions' && history.entries.length > 0 && (
            <div className="address-history-section-summary" aria-live="polite">
              <button
                type="button"
                className="text-button"
                onClick={() => jumpToTransactionSection('pending')}
              >
                {pendingTransactions.length} pending
              </button>
              <span className="address-history-section-summary-separator" aria-hidden="true">
                |
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => jumpToTransactionSection('confirmed')}
              >
                {confirmedTransactions.length} confirmed
              </button>
              {!!unknownTransactions.length && (
                <>
                  <span className="address-history-section-summary-separator" aria-hidden="true">
                    |
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => jumpToTransactionSection('unknown')}
                  >
                    {unknownTransactions.length} unknown
                  </button>
                </>
              )}
            </div>
          )}
          {tab === 'utxos' && addressUtxos && (
            <div className="address-history-section-summary" aria-live="polite">
              <button
                type="button"
                className="text-button"
                onClick={() => jumpToUtxoSection('pending')}
              >
                {pendingUtxos.length} pending
              </button>
              <span className="address-history-section-summary-separator" aria-hidden="true">
                |
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => jumpToUtxoSection('confirmed')}
              >
                {confirmedUtxos.length} confirmed
              </button>
              {unknownUtxos.length > 0 && (
                <>
                  <span className="address-history-section-summary-separator" aria-hidden="true">
                    |
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => jumpToUtxoSection('unknown')}
                  >
                    {unknownUtxos.length} unknown
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {tab === 'transactions' &&
          history.source === 'loaded transactions' &&
          !canLoad &&
          !history.entries.length && (
            <p className="small muted">
              No observed activity for this address in the loaded workspace.
            </p>
          )}
        {tab === 'transactions' &&
          history.source !== 'loaded transactions' &&
          !history.entries.length && (
            <p className="small muted">
              {history.complete
                ? 'No observed activity in this address history.'
                : 'No history rows are currently available; coverage is partial.'}
            </p>
          )}
        {tab === 'transactions' && !!history.entries.length && (
          <div className="address-history-sections">
            {pendingTransactions.length > 0 && (
              <AddressHistorySection
                idPrefix="address-history"
                section="pending"
                label="Pending"
                items={pendingTransactions}
                visibleItems={visiblePendingTransactions}
                collapsed={collapsedTransactionSections.pending}
                onToggle={() =>
                  setCollapsedTransactionSections((current) => ({
                    ...current,
                    pending: !current.pending,
                  }))
                }
                sectionRef={pendingTransactionsSection}
                renderItem={renderHistoryEntry}
              />
            )}
            {confirmedTransactions.length > 0 && (
              <AddressHistorySection
                idPrefix="address-history"
                section="confirmed"
                label="Confirmed"
                items={confirmedTransactions}
                visibleItems={visibleConfirmedTransactions}
                collapsed={collapsedTransactionSections.confirmed}
                onToggle={() =>
                  setCollapsedTransactionSections((current) => ({
                    ...current,
                    confirmed: !current.confirmed,
                  }))
                }
                sectionRef={confirmedTransactionsSection}
                renderItem={renderHistoryEntry}
              />
            )}
            {unknownTransactions.length > 0 && (
              <AddressHistorySection
                idPrefix="address-history"
                section="unknown"
                label="Unknown"
                items={unknownTransactions}
                visibleItems={visibleUnknownTransactions}
                collapsed={collapsedTransactionSections.unknown}
                onToggle={() =>
                  setCollapsedTransactionSections((current) => ({
                    ...current,
                    unknown: !current.unknown,
                  }))
                }
                sectionRef={unknownTransactionsSection}
                renderItem={renderHistoryEntry}
              />
            )}
          </div>
        )}
        {tab === 'transactions' && expandedTransactionCount > visibleTransactionCount && (
          <button
            type="button"
            className="text-button address-history-more"
            onClick={() => setLimit((value) => Math.min(expandedTransactionCount, value + 40))}
          >
            Show more transactions ({expandedTransactionCount - visibleTransactionCount} remaining)
          </button>
        )}
        {tab === 'transactions' && history.entries.length > 0 && !history.complete && (
          <p className="small muted address-history-note">
            Missing rows or details remain unknown. This list does not establish ownership, balance,
            or that an output is unspent.
          </p>
        )}
        {tab === 'utxos' && !addressUtxos && (
          <p className="small muted">UTXOs have not been checked for this address.</p>
        )}
        {tab === 'utxos' && addressUtxos && !addressUtxos.utxos.length && (
          <p className="small muted">No unspent outputs observed at the last check.</p>
        )}
        {tab === 'utxos' && !!addressUtxos?.utxos.length && (
          <div className="address-history-sections">
            {pendingUtxos.length > 0 && (
              <AddressHistorySection
                idPrefix="address-utxos"
                section="pending"
                label="Pending"
                items={pendingUtxos}
                visibleItems={visiblePendingUtxos}
                collapsed={collapsedUtxoSections.pending}
                onToggle={() =>
                  setCollapsedUtxoSections((current) => ({
                    ...current,
                    pending: !current.pending,
                  }))
                }
                sectionRef={pendingUtxosSection}
                renderItem={renderUtxo}
              />
            )}
            {confirmedUtxos.length > 0 && (
              <AddressHistorySection
                idPrefix="address-utxos"
                section="confirmed"
                label="Confirmed"
                items={confirmedUtxos}
                visibleItems={visibleConfirmedUtxos}
                collapsed={collapsedUtxoSections.confirmed}
                onToggle={() =>
                  setCollapsedUtxoSections((current) => ({
                    ...current,
                    confirmed: !current.confirmed,
                  }))
                }
                sectionRef={confirmedUtxosSection}
                renderItem={renderUtxo}
              />
            )}
            {unknownUtxos.length > 0 && (
              <AddressHistorySection
                idPrefix="address-utxos"
                section="unknown"
                label="Unknown"
                items={unknownUtxos}
                visibleItems={visibleUnknownUtxos}
                collapsed={collapsedUtxoSections.unknown}
                onToggle={() =>
                  setCollapsedUtxoSections((current) => ({
                    ...current,
                    unknown: !current.unknown,
                  }))
                }
                sectionRef={unknownUtxosSection}
                renderItem={renderUtxo}
              />
            )}
          </div>
        )}
        {tab === 'utxos' &&
          !!addressUtxos?.utxos.length &&
          expandedUtxoCount > visibleUtxoCount && (
            <button
              type="button"
              className="text-button address-history-more"
              onClick={() => setUtxoLimit((value) => Math.min(expandedUtxoCount, value + 40))}
            >
              Show more UTXOs ({expandedUtxoCount - visibleUtxoCount} remaining)
            </button>
          )}
      </div>
    </div>
  );
}
