import { Amount } from './Amount';
import {
  matchingWalletUtxoObservation,
  type WalletUtxoObservation,
} from '../domain/walletUtxoObservation';
import { SmallAmountControl } from './SmallAmountControl';
import { isSmallAmount } from '../domain/smallAmounts';
import { transactionStatus } from '../domain/transactionStatus';
import { TransactionBlockTime, TransactionFeeLabel } from './TransactionBlockTime';
import {
  memo,
  useId,
  useMemo,
  useEffect,
  useState,
  useRef,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Pencil,
  ArrowLeft,
  ArrowRight,
  ArrowRightFromLine,
  ArrowRightToLine,
  Box,
  Bookmark,
  Tags,
  Smile,
  Eye,
  EyeOff,
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Layers,
} from 'lucide-react';
import {
  type AddressBalanceObservation,
  type AddressUtxoObservation,
  type GraphNode,
  type Transaction,
  type TransactionFlowState,
  type TxOutput,
  type Workspace,
  outputNodeId,
  txNodeId,
  sats,
} from '../domain/types';
import { relatedTransactions } from '../domain/transactionInspection';
import { indexLoadedSpends, selectedFlowLeg } from '../domain/transactionFlow';
import { indexPreviousOutputs, resolvePreviousOutput } from '../domain/prevouts';
import { isOpReturn } from '../domain/opReturn';
import { outputAddress } from '../domain/workspace';
import { CopyButton } from './CopyButton';
import { OpReturnData } from './OpReturnData';
import './transaction-view.css';
import type { VisibilityProps } from './VisibilityActions';
import { SelectionCheckbox } from './SelectionToolbar';
import type { EntitySelection } from '../lib/useEntitySelection';
import { ResponsiveIdentifier } from './ResponsiveIdentifier';
import { BatchTagEditor, MetadataPopover } from './MetadataEditors';
import { IconPalette } from './IconPicker';
import { addressBalanceSats, type AddressHistory } from '../domain/addressHistory';
import { formatLocalTimestamp } from '../domain/transactionTime';

interface Props extends VisibilityProps {
  workspace: Workspace;
  walletUtxoObservation?: WalletUtxoObservation;
  selected?: GraphNode;
  onSelect: (id: string) => void;
  onEdit: (id: string, target?: 'label' | 'tags' | 'icon') => void;
  onApplyTags: (update: (workspace: Workspace) => Workspace) => void;
  onSetIcon: (id: string, icon: string) => void;
  onTrace: (direction: 'funding' | 'spending', id: string) => void;
  disabledReason?: string;
  inputLoading?: boolean;
  inputError?: string;
  onRetryInputs?: () => void;
  missingInputCount?: number;
  onLoadAllInputs?: () => void;
  onSmallAmountThresholdChange?: (threshold: number) => void;
  renderMetadata?: (nodeId: string) => ReactNode;
  state?: TransactionFlowState;
  onStateChange?: (state: TransactionFlowState) => void;
  selection?: EntitySelection;
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
interface Row {
  id?: string;
  index: number;
  output?: TxOutput;
  previousTxid?: string;
  coinbase: boolean;
}

interface FlowRowActions {
  onSelect: Props['onSelect'];
  onEdit: Props['onEdit'];
  onTrace: Props['onTrace'];
  onSetHidden: Props['onSetHidden'];
  onNavigate: (txid: string, outputId: string) => void;
  toggleSelection?: (id: string) => void;
}

// A selection change should update two rows, not recreate every expanded row.
const TransactionFlowRow = memo(function TransactionFlowRow({
  row,
  inputs,
  selected,
  pinned,
  belowThreshold,
  label,
  icon,
  loaded,
  spendCount,
  spendId,
  hidden,
  notOnGraph,
  batchMode,
  batchSelected,
  canShowHidden,
  renderMetadata,
  disabledReason,
  inputLoading,
  actions,
}: {
  row: Row;
  inputs: boolean;
  selected: boolean;
  pinned: boolean;
  belowThreshold: boolean;
  label?: string;
  icon?: string;
  loaded: boolean;
  spendCount: number;
  spendId?: string;
  hidden: boolean;
  notOnGraph: boolean;
  batchMode: boolean;
  batchSelected: boolean;
  canShowHidden: boolean;
  renderMetadata?: Props['renderMetadata'];
  disabledReason?: string;
  inputLoading?: boolean;
  actions: RefObject<FlowRowActions>;
}) {
  const offGraph = hidden || notOnGraph;
  const visibilityLabel = `${notOnGraph ? 'Add' : 'Show'} ${inputs ? 'input' : 'output'} ${row.index} in graph`;
  const address = row.output && outputAddress(row.output);
  const opReturn = isOpReturn(row.output?.scriptPubKey.hex);
  const navigate = () => {
    if (!row.id) return;
    if (inputs) {
      if (loaded) actions.current.onNavigate(row.previousTxid!, row.id);
      else {
        actions.current.onSelect(row.id);
        actions.current.onTrace('funding', row.id);
      }
    } else if (spendCount === 1) actions.current.onNavigate(spendId!, row.id);
    else {
      actions.current.onSelect(row.id);
      if (!spendCount) actions.current.onTrace('spending', row.id);
    }
  };
  const navigationLabel = inputs
    ? `${loaded ? 'Go to' : 'Load'} previous transaction for input ${row.index}`
    : spendCount > 1
      ? `Choose among ${spendCount} loaded spends of output ${row.index}`
      : spendCount === 1
        ? `Go to spending transaction for output ${row.index}`
        : `Check output ${row.index} for spends`;
  return (
    <div
      key={row.index}
      className={`transaction-row ${icon ? 'has-annotation-icon' : ''} ${selected ? 'is-selected' : ''} ${pinned ? 'is-pinned' : ''} ${batchSelected ? 'is-batch-selected' : ''}`}
      data-selected={selected}
    >
      {batchMode && row.id && (
        <SelectionCheckbox
          id={row.id}
          label={`${inputs ? 'input' : 'output'} ${row.index}`}
          checked={batchSelected}
          onToggle={(id) => actions.current.toggleSelection?.(id)}
        />
      )}
      <div className="transaction-row-content">
        <div
          className="transaction-row-select"
          role={row.id ? 'button' : undefined}
          tabIndex={row.id ? 0 : undefined}
          aria-label={`${inputs ? 'Input' : 'Output'} ${row.index}${row.id ? `: ${row.id.slice(4)}` : ': Coinbase'}`}
          aria-pressed={row.id ? selected : undefined}
          title={row.id ? `${address ? `${address}\n` : ''}${row.id.slice(4)}` : 'Coinbase'}
          onClick={(event) => {
            if (!row.id) return;
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest('.transaction-row-tools, .op-return-data button')
            )
              return;
            if (actions.current.toggleSelection && (event.ctrlKey || event.metaKey))
              actions.current.toggleSelection?.(row.id);
            else actions.current.onSelect(row.id);
          }}
          onKeyDown={(event) => {
            if (!row.id || event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            actions.current.onSelect(row.id);
          }}
        >
          <span className="transaction-row-index">#{row.index}</span>
          <span className="transaction-row-main">
            <span className="transaction-row-heading">
              <strong>
                {row.coinbase ? (
                  'Coinbase'
                ) : opReturn ? (
                  'OP_RETURN'
                ) : address ? (
                  <ResponsiveIdentifier value={address} preferFull />
                ) : !row.output ? (
                  inputLoading && selected ? (
                    'Loading previous output…'
                  ) : (
                    'Select to load previous output'
                  )
                ) : (
                  'Script output'
                )}
              </strong>
              {!row.coinbase && <Amount value={row.output ? sats(row.output.value) : undefined} />}
            </span>
            {label && <span className="transaction-row-label">{label}</span>}
            {opReturn && <OpReturnData hex={row.output!.scriptPubKey.hex} />}
            {row.coinbase && <span>Newly created coins</span>}
            {selected && belowThreshold && (
              <span
                className="amount-selection-badge"
                title="The selected output stays visible below the amount filter."
              >
                Selected · outside filter
              </span>
            )}
            {row.id && offGraph && (
              <span className="entity-hidden-badge">
                <EyeOff size={10} /> {notOnGraph ? 'Not on graph' : 'Hidden'}
              </span>
            )}
            {row.id && renderMetadata?.(row.id)}
          </span>
          {icon && (
            <span
              className="transaction-row-annotation-icon"
              role="img"
              aria-label={`Annotation icon: ${icon}`}
            >
              {icon}
            </span>
          )}
          {row.id && (
            <div className="transaction-row-tools" onClick={(event) => event.stopPropagation()}>
              {!opReturn && (
                <button
                  type="button"
                  className={`icon-button transaction-row-follow ${loaded ? 'is-loaded' : ''}`}
                  aria-label={navigationLabel}
                  title={!loaded && disabledReason ? disabledReason : navigationLabel}
                  disabled={!loaded && (!!disabledReason || (inputs && inputLoading))}
                  onClick={navigate}
                >
                  {inputs ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}
                </button>
              )}
              {offGraph && canShowHidden && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visibilityLabel}
                  title={visibilityLabel}
                  onClick={() => actions.current.onSetHidden?.([row.id!], false)}
                >
                  <Eye size={12} />
                </button>
              )}
              <button
                type="button"
                className="icon-button transaction-row-edit"
                aria-label={`Edit ${inputs ? 'input' : 'output'} ${row.index} annotation`}
                title={`Edit ${inputs ? 'input' : 'output'} ${row.index} annotation`}
                onClick={() => actions.current.onEdit(row.id!)}
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

function TransactionRows({
  tx,
  workspace,
  selected,
  onSelect,
  onEdit,
  onTrace,
  disabledReason,
  inputLoading,
  inputError,
  onSmallAmountThresholdChange,
  graphNodeIds,
  hiddenNodeIds = [],
  onSetHidden,
  renderMetadata,
  state,
  onStateChange,
  selection,
  spends,
  previousOutputs,
  onNavigate,
  identity,
  previous,
  next,
}: Props & {
  tx: Transaction;
  spends: ReturnType<typeof indexLoadedSpends>;
  previousOutputs: ReturnType<typeof indexPreviousOutputs>;
  onNavigate: (txid: string, outputId: string) => void;
  identity: ReactNode;
  previous: ReactNode;
  next: ReactNode;
}) {
  const hidden = useMemo(() => new Set(hiddenNodeIds), [hiddenNodeIds]);
  const admitted = useMemo(
    () => (graphNodeIds === undefined ? undefined : new Set(graphNodeIds)),
    [graphNodeIds],
  );
  const flow = useRef<HTMLDivElement>(null);
  const actions = useRef<FlowRowActions>({
    onSelect,
    onEdit,
    onTrace,
    onSetHidden,
    onNavigate,
    toggleSelection: selection?.toggle,
  });
  useLayoutEffect(() => {
    actions.current = {
      onSelect,
      onEdit,
      onTrace,
      onSetHidden,
      onNavigate,
      toggleSelection: selection?.toggle,
    };
  });
  const [localInputs, setLocalInputs] = useState(false);
  const [localOutputs, setLocalOutputs] = useState(false);
  const controlled = state?.transactionId === tx.txid;
  const expandedInputs = controlled ? (state.expandedInputs ?? false) : localInputs;
  const expandedOutputs = controlled ? (state.expandedOutputs ?? false) : localOutputs;
  const setExpandedInputs = (expanded: boolean) => {
    setLocalInputs(expanded);
    onStateChange?.({
      ...state,
      transactionId: tx.txid,
      expandedInputs: expanded,
      expandedOutputs,
    });
  };
  const setExpandedOutputs = (expanded: boolean) => {
    setLocalOutputs(expanded);
    onStateChange?.({
      ...state,
      transactionId: tx.txid,
      expandedInputs,
      expandedOutputs: expanded,
    });
  };
  useLayoutEffect(() => {
    if (expandedInputs || expandedOutputs) return;
    const panel = flow.current?.closest<HTMLDetailsElement>('.transaction-view');
    // Return compact lists to their start. The selected outpoint stays pinned.
    if (panel) panel.scrollTop = 0;
  }, [expandedInputs, expandedOutputs]);
  useLayoutEffect(() => {
    const container = flow.current;
    const panel = container?.closest<HTMLDetailsElement>('.transaction-view');
    if (!container || !panel) return;
    const summary = panel.querySelector<HTMLElement>(':scope > summary');
    const feedback = panel.querySelector<HTMLElement>('.transaction-input-feedback');
    const center = container.querySelector<HTMLElement>('.transaction-flow-center');
    const actions = panel.querySelector<HTMLElement>(
      '.transaction-view-body > .transaction-view-actions',
    );
    const lanes = Array.from(container.querySelectorAll<HTMLElement>(':scope > section')).map(
      (section) => ({
        section,
        header: section.querySelector<HTMLElement>('.transaction-lane-context')!,
        rows: section.querySelector<HTMLElement>('.transaction-rows')!,
      }),
    );
    const measure = () => {
      if (!panel.open || !panel.clientHeight) return;
      const top = summary?.offsetHeight ?? 38;
      const bottom = panel.clientHeight - (feedback?.offsetHeight ?? 0) - 8;
      container.style.setProperty('--transaction-lane-top', `${top}px`);
      if (center) {
        // Match the resting position, including any input-loading controls above
        // the flow, so scrolling never moves the transaction before it sticks.
        const flowTop =
          container.getBoundingClientRect().top -
          panel.getBoundingClientRect().top -
          panel.clientTop +
          panel.scrollTop;
        container.style.setProperty(
          '--transaction-center-top',
          `${flowTop + parseFloat(getComputedStyle(center).marginTop)}px`,
        );
      }
      // Leave room for a row even with wrapped controls in a short panel.
      container.style.setProperty(
        '--transaction-context-max-height',
        `${Math.max(48, bottom - top - 68)}px`,
      );
      for (const { section, header, rows } of lanes) {
        section.style.setProperty(
          '--transaction-selected-top',
          `${top + header.offsetHeight + 4}px`,
        );
        section.style.setProperty(
          '--transaction-selected-max-height',
          `${Math.max(48, bottom - top - header.offsetHeight - 4)}px`,
        );
        // Short lists stay below their heading. Taller lists scroll until their
        // final rows reach the bottom, then stay beside the longer opposite lane.
        section.style.setProperty(
          '--transaction-rows-top',
          `${Math.min(top + header.offsetHeight + 4, bottom - rows.offsetHeight)}px`,
        );
      }
    };
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(panel);
    if (summary) observer.observe(summary);
    if (feedback) observer.observe(feedback);
    if (center) observer.observe(center);
    if (actions) observer.observe(actions);
    for (const { header, rows } of lanes) {
      observer.observe(header);
      observer.observe(rows);
    }
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [
    tx.txid,
    expandedInputs,
    expandedOutputs,
    workspace.view.flowAmountThreshold,
    inputLoading,
    inputError,
  ]);
  const inputRows = useMemo<Row[]>(
    () =>
      tx.vin.map((input, index) => {
        const resolution = resolvePreviousOutput(workspace, input, previousOutputs);
        return {
          id: input.txid !== undefined ? outputNodeId(input.txid, input.vout!) : undefined,
          index,
          output:
            resolution.status === 'loaded' || resolution.status === 'attached'
              ? resolution.output
              : undefined,
          previousTxid: input.txid,
          coinbase: input.coinbase !== undefined,
        };
      }),
    [tx, workspace.transactions, workspace.network, previousOutputs],
  );
  const outputRows = useMemo<Row[]>(
    () =>
      tx.vout.map((output) => ({
        id: outputNodeId(tx.txid, output.n),
        index: output.n,
        output,
        coinbase: false,
      })),
    [tx],
  );
  const columns = [
    { name: 'Inputs', rows: inputRows, expanded: expandedInputs, toggle: setExpandedInputs },
    { name: 'Outputs', rows: outputRows, expanded: expandedOutputs, toggle: setExpandedOutputs },
  ];
  return (
    <div ref={flow} className="transaction-columns transaction-flow">
      {identity}
      {columns.map(({ name, rows, expanded, toggle }) => {
        const inputs = name === 'Inputs';
        const matches = (row: Row) =>
          row.id === selected?.id ||
          (selected?.kind === 'address' &&
            !!row.output &&
            outputAddress(row.output) === selected.address);
        const belowThreshold = (row: Row) =>
          isSmallAmount(
            row.output ? sats(row.output.value) : undefined,
            workspace.view.flowAmountThreshold,
          );
        const retained = rows.filter((row) => matches(row) || !belowThreshold(row));
        const filteredCount = rows.length - retained.length;
        // The selected outpoint remains present even below the threshold or beyond the collapsed window.
        const shown = expanded
          ? retained
          : retained.filter((row, index) => index < 3 || matches(row));
        return (
          <section
            key={name}
            className={`transaction-flow-${name.toLowerCase()}`}
            aria-label={`${name} of displayed transaction`}
            aria-busy={inputs && inputLoading ? true : undefined}
          >
            <div className="transaction-lane-context">
              <div className={inputs ? 'transaction-flow-previous' : 'transaction-flow-next'}>
                {inputs ? previous : next}
              </div>
              <div className="transaction-lane-header">
                <h4>
                  {rows.length}{' '}
                  {rows.length === 1 ? name.toLowerCase().slice(0, -1) : name.toLowerCase()}
                </h4>
                {(filteredCount > 0 || retained.length > 3) && (
                  <div className="transaction-lane-actions">
                    {filteredCount > 0 && (
                      <button
                        type="button"
                        className="text-button transaction-amount-recovery"
                        aria-label={`${filteredCount} amounts filtered from ${name.toLowerCase()}. Clear amount filter`}
                        title="Clear amount filter"
                        onClick={() => onSmallAmountThresholdChange?.(0)}
                      >
                        {filteredCount} amounts filtered
                      </button>
                    )}
                    {retained.length > 3 && (
                      <button
                        type="button"
                        className="text-button transaction-expand"
                        aria-expanded={expanded}
                        onClick={() => toggle(!expanded)}
                      >
                        {expanded
                          ? `Collapse ${name.toLowerCase()}`
                          : `Show all ${retained.length} ${name.toLowerCase()}`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="transaction-rows">
              {shown.map((row) => (
                <TransactionFlowRow
                  key={row.index}
                  row={row}
                  inputs={inputs}
                  selected={Boolean(matches(row))}
                  pinned={row.id === selected?.id}
                  belowThreshold={belowThreshold(row)}
                  label={row.id ? workspace.annotations[row.id]?.label : undefined}
                  icon={row.id ? workspace.annotations[row.id]?.icon : undefined}
                  loaded={
                    inputs
                      ? !!workspace.transactions[row.previousTxid ?? '']
                      : !!spends.get(row.id ?? '')?.length
                  }
                  spendCount={spends.get(row.id ?? '')?.length ?? 0}
                  spendId={spends.get(row.id ?? '')?.[0]?.txid}
                  hidden={!!row.id && hidden.has(row.id)}
                  notOnGraph={!!row.id && admitted !== undefined && !admitted.has(row.id)}
                  batchMode={selection?.mode ?? false}
                  batchSelected={!!row.id && !!selection?.has(row.id)}
                  canShowHidden={!!onSetHidden}
                  renderMetadata={renderMetadata}
                  disabledReason={disabledReason}
                  inputLoading={inputLoading}
                  actions={actions}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function checkedAtLabel(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not checked';
  return `Checked ${formatLocalTimestamp(value) ?? 'Unknown time'}`;
}

function AddressHistoryView({
  history,
  workspace,
  disabledReason,
  onLoad,
  loading,
  addressUtxos,
  onLoadUtxos,
  onOpenTransaction,
  renderMetadata,
}: {
  history: AddressHistory;
  workspace: Workspace;
  disabledReason?: string;
  loading?: {
    phase: 'history' | 'details' | 'balance';
    done: number;
    total: number;
    error?: string;
  };
  addressUtxos?: AddressUtxoObservation;
  onLoad?: (force?: boolean) => void;
  onLoadUtxos?: (force?: boolean) => void;
  onOpenTransaction?: (txid: string, height?: number, vout?: number) => void;
  renderMetadata?: (nodeId: string) => ReactNode;
}) {
  const [limit, setLimit] = useState(40);
  const [tab, setTab] = useState<'transactions' | 'utxos'>('transactions');
  const [collapsedUtxoSections, setCollapsedUtxoSections] = useState({
    pending: false,
    confirmed: false,
  });
  const [collapsedTransactionSections, setCollapsedTransactionSections] = useState({
    pending: false,
    confirmed: false,
    unknown: false,
  });
  const pendingUtxosSection = useRef<HTMLElement>(null);
  const confirmedUtxosSection = useRef<HTMLElement>(null);
  const pendingTransactionsSection = useRef<HTMLElement>(null);
  const confirmedTransactionsSection = useRef<HTMLElement>(null);
  const unknownTransactionsSection = useRef<HTMLElement>(null);
  useEffect(() => setTab('transactions'), [history.address]);
  const pendingTransactions = history.entries.filter((entry) => entry.mempool);
  const confirmedTransactions = history.entries.filter(
    (entry) => !entry.mempool && entry.height !== undefined && entry.height > 0,
  );
  const unknownTransactions = history.entries.filter(
    (entry) => !entry.mempool && (entry.height === undefined || entry.height <= 0),
  );
  const visiblePendingTransactions = pendingTransactions.slice(0, limit);
  const visibleConfirmedTransactions = confirmedTransactions.slice(
    0,
    Math.max(0, limit - visiblePendingTransactions.length),
  );
  const visibleUnknownTransactions = unknownTransactions.slice(
    0,
    Math.max(0, limit - visiblePendingTransactions.length - visibleConfirmedTransactions.length),
  );
  const visibleTransactionCount =
    visiblePendingTransactions.length +
    visibleConfirmedTransactions.length +
    visibleUnknownTransactions.length;
  const pendingUtxos = addressUtxos?.utxos.filter((utxo) => utxo.height === 0) ?? [];
  const confirmedUtxos = addressUtxos?.utxos.filter((utxo) => utxo.height > 0) ?? [];
  const hasLoad = !!onLoad;
  const hasLoadUtxos = !!onLoadUtxos;
  const isLoading = !!loading && !loading.error;
  const canLoad = !!onLoad && !disabledReason && !isLoading;
  const canLoadUtxos = !!onLoadUtxos && !disabledReason;
  const jumpToUtxoSection = (section: 'pending' | 'confirmed') => {
    setCollapsedUtxoSections((current) => ({ ...current, [section]: false }));
    requestAnimationFrame(() => {
      (section === 'pending' ? pendingUtxosSection : confirmedUtxosSection).current?.scrollIntoView(
        {
          block: 'start',
        },
      );
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
  const renderUtxoSection = (
    section: 'pending' | 'confirmed',
    label: string,
    items: AddressUtxoObservation['utxos'],
    sectionRef: RefObject<HTMLElement | null>,
  ) => (
    <section id={`address-utxos-${section}`} className="address-history-section" ref={sectionRef}>
      <h4 className="address-history-section-heading">
        <button
          type="button"
          className="address-history-section-toggle"
          aria-expanded={!collapsedUtxoSections[section]}
          aria-controls={`address-utxos-${section}-list`}
          onClick={() =>
            setCollapsedUtxoSections((current) => ({
              ...current,
              [section]: !current[section],
            }))
          }
        >
          {label} ({items.length})
        </button>
      </h4>
      {!collapsedUtxoSections[section] && (
        <div id={`address-utxos-${section}-list`} className="address-history-list" role="list">
          {items.map(renderUtxo)}
        </div>
      )}
    </section>
  );
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
  const renderTransactionSection = (
    section: 'pending' | 'confirmed' | 'unknown',
    label: string,
    items: AddressHistory['entries'],
    visibleItems: AddressHistory['entries'],
    sectionRef: RefObject<HTMLElement | null>,
  ) => (
    <section id={`address-history-${section}`} className="address-history-section" ref={sectionRef}>
      <h4 className="address-history-section-heading">
        <button
          type="button"
          className="address-history-section-toggle"
          aria-expanded={!collapsedTransactionSections[section]}
          aria-controls={`address-history-${section}-list`}
          onClick={() =>
            setCollapsedTransactionSections((current) => ({
              ...current,
              [section]: !current[section],
            }))
          }
        >
          {label} ({items.length})
        </button>
      </h4>
      {!collapsedTransactionSections[section] && (
        <div id={`address-history-${section}-list`} className="address-history-list" role="list">
          {visibleItems.map(renderHistoryEntry)}
        </div>
      )}
    </section>
  );
  return (
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
            {(tab === 'transactions' ? hasLoad : hasLoadUtxos) && <span aria-hidden="true">·</span>}
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
            <span aria-hidden="true">|</span>
            <button
              type="button"
              className="text-button"
              onClick={() => jumpToTransactionSection('confirmed')}
            >
              {confirmedTransactions.length} confirmed
            </button>
            {!!unknownTransactions.length && (
              <>
                <span aria-hidden="true">|</span>
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
            {addressUtxos.utxos.some((utxo) => utxo.height < 0) && (
              <span>{addressUtxos.utxos.filter((utxo) => utxo.height < 0).length} unknown</span>
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
          {pendingTransactions.length > 0 &&
            renderTransactionSection(
              'pending',
              'Pending',
              pendingTransactions,
              visiblePendingTransactions,
              pendingTransactionsSection,
            )}
          {confirmedTransactions.length > 0 &&
            renderTransactionSection(
              'confirmed',
              'Confirmed',
              confirmedTransactions,
              visibleConfirmedTransactions,
              confirmedTransactionsSection,
            )}
          {unknownTransactions.length > 0 &&
            renderTransactionSection(
              'unknown',
              'Unknown',
              unknownTransactions,
              visibleUnknownTransactions,
              unknownTransactionsSection,
            )}
        </div>
      )}
      {tab === 'transactions' && history.entries.length > visibleTransactionCount && (
        <button
          type="button"
          className="text-button address-history-more"
          onClick={() => setLimit((value) => Math.min(history.entries.length, value + 40))}
        >
          Show more transactions ({history.entries.length - visibleTransactionCount} remaining)
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
          {pendingUtxos.length > 0 &&
            renderUtxoSection('pending', 'Pending', pendingUtxos, pendingUtxosSection)}
          {confirmedUtxos.length > 0 &&
            renderUtxoSection('confirmed', 'Confirmed', confirmedUtxos, confirmedUtxosSection)}
        </div>
      )}
    </div>
  );
}

export function TransactionView(props: Props) {
  const {
    workspace,
    walletUtxoObservation,
    selected,
    onSelect,
    onTrace,
    disabledReason,
    state,
    onStateChange,
    inputLoading,
    inputError,
    onRetryInputs,
    renderMetadata,
  } = props;
  const spends = useMemo(() => indexLoadedSpends(workspace.transactions), [workspace.transactions]);
  const related = useMemo(
    () => (selected ? relatedTransactions(workspace.transactions, selected, spends) : []),
    [workspace.transactions, selected?.id, spends],
  );
  const previousOutputs = useMemo(
    () => indexPreviousOutputs(workspace),
    [workspace.transactions, workspace.network],
  );
  const [choice, setChoice] = useState('');
  const [quickEditor, setQuickEditor] = useState<{
    kind: 'tags' | 'icon';
    nodeId: string;
    anchor: HTMLElement;
    point?: { x: number; y: number };
  }>();
  const quickEditorId = useId();
  const [fullHeight, setFullHeight] = useState(false);
  const [localOpen, setLocalOpen] = useState(true);
  const open = state?.open ?? localOpen;
  const setPanelHeight = (height: 'collapsed' | 'expanded' | 'full') => {
    const nextOpen = height !== 'collapsed';
    setFullHeight(height === 'full');
    setLocalOpen(nextOpen);
    if (nextOpen !== open) onStateChange?.({ ...state, open: nextOpen });
  };
  const current =
    related.find(({ tx }) => tx.txid === (state?.transactionId ?? choice)) ?? related[0];
  const choose = (transactionId: string) => {
    setChoice(transactionId);
    if (transactionId === state?.transactionId) return;
    onStateChange?.({ ...state, transactionId, expandedInputs: false, expandedOutputs: false });
  };
  const hasFlowSelection = !!selected;
  const currentNotOnGraph =
    !!current &&
    selected?.kind !== 'address' &&
    props.graphNodeIds !== undefined &&
    !props.graphNodeIds.includes(txNodeId(current.tx.txid));
  const navigate = (txid: string, outputId: string) => {
    choose(txid);
    props.onSetHidden?.([txNodeId(txid)], false);
    onSelect(outputId);
  };
  const leg = current
    ? selectedFlowLeg(current.tx, selected?.kind === 'output' ? selected.id : undefined)
    : undefined;
  const missingCreating =
    selected?.kind === 'output' && !workspace.transactions[selected.txid ?? ''];
  const selectedResolution =
    selected?.kind === 'output' && selected.txid !== undefined && selected.vout !== undefined
      ? resolvePreviousOutput(workspace, selected, previousOutputs)
      : undefined;
  const selectedOutput =
    selectedResolution?.status === 'loaded' || selectedResolution?.status === 'attached'
      ? selectedResolution.output
      : undefined;
  const selectedUnspendable = isOpReturn(selectedOutput?.scriptPubKey.hex);
  const loadedSpenders = selected?.kind === 'output' ? (spends.get(selected.id) ?? []) : [];
  const walletObservation =
    selected?.kind === 'output'
      ? matchingWalletUtxoObservation(
          walletUtxoObservation,
          workspace,
          selected.txid,
          selected.vout,
        )
      : undefined;
  const preview = (direction: 'previous' | 'next') => {
    if (!selected) return null;
    const active =
      direction === 'previous' ? leg?.direction === 'previous' : leg?.direction === 'next';
    if (!active)
      return (
        <span className="transaction-flow-hint">
          Select an {direction === 'previous' ? 'input' : 'output'} to trace
        </span>
      );
    const candidates =
      direction === 'previous'
        ? [workspace.transactions[selected.txid ?? '']].filter((tx): tx is Transaction => !!tx)
        : loadedSpenders;
    if (direction === 'next' && selectedUnspendable)
      return <span className="transaction-flow-hint">OP_RETURN · unspendable</span>;
    return (
      <div className={`transaction-neighbor transaction-neighbor-${direction}`}>
        {candidates.length ? (
          candidates.map((tx) => (
            <button
              key={tx.txid}
              type="button"
              className="transaction-neighbor-card"
              title={tx.txid}
              aria-label={`Go to ${direction === 'previous' ? 'previous' : 'spending'} transaction ${tx.txid}`}
              onClick={() => navigate(tx.txid, selected.id)}
            >
              {direction === 'previous' && <ArrowLeft size={15} />}
              <span>
                <small>
                  {`${direction === 'previous' ? 'Input' : 'Output'} #${leg?.index} · `}
                  {direction === 'previous'
                    ? 'Previous transaction'
                    : candidates.length > 1
                      ? 'Loaded spend alternative'
                      : 'Spending transaction'}
                </small>
                <strong>
                  {workspace.annotations[txNodeId(tx.txid)]?.label || (
                    <ResponsiveIdentifier value={tx.txid} preferFull />
                  )}
                </strong>
              </span>
              {direction === 'next' && <ArrowRight size={15} />}
            </button>
          ))
        ) : (
          <button
            type="button"
            className="transaction-neighbor-card is-missing"
            aria-label={
              direction === 'previous'
                ? inputLoading
                  ? 'Loading creating transaction'
                  : 'Retry creating transaction'
                : 'Check this output for spends'
            }
            disabled={!!disabledReason || (direction === 'previous' && inputLoading)}
            title={
              disabledReason ||
              (direction === 'next'
                ? 'No spending transaction loaded. Check this exact output for spending transactions.'
                : 'Load this input’s creating transaction.')
            }
            onClick={() =>
              direction === 'previous' && onRetryInputs
                ? onRetryInputs()
                : onTrace(direction === 'previous' ? 'funding' : 'spending', selected.id)
            }
          >
            {direction === 'previous' && <ArrowLeft size={15} />}
            <span>
              <small>
                {direction === 'previous'
                  ? 'Previous transaction'
                  : walletObservation
                    ? 'Unspent at wallet check'
                    : 'Spend status unknown'}
              </small>
              <strong>
                {direction === 'previous'
                  ? inputLoading
                    ? 'Loading…'
                    : 'Retry loading'
                  : 'Check this output for spends'}
              </strong>
            </span>
            {direction === 'next' && <ArrowRight size={15} />}
          </button>
        )}
      </div>
    );
  };
  const summaryKind =
    selected?.kind === 'address'
      ? 'address'
      : selected?.kind === 'output' && leg?.direction === 'previous'
        ? 'input'
        : selected?.kind === 'output'
          ? 'output'
          : 'transaction';
  const SummaryIcon =
    summaryKind === 'address'
      ? Layers
      : summaryKind === 'input'
        ? ArrowRightToLine
        : summaryKind === 'output'
          ? ArrowRightFromLine
          : Box;
  const summaryLabel =
    summaryKind === 'address'
      ? 'Address'
      : summaryKind === 'input'
        ? 'Input'
        : summaryKind === 'output'
          ? 'Output'
          : 'Transaction';
  const selectedAnnotation = selected ? workspace.annotations[selected.id] : undefined;
  return (
    <div className="transaction-view-slot">
      <div className={`transaction-view-surface${fullHeight ? ' is-full-height' : ''}`}>
        <details className="transaction-view" data-tour="transaction-flow" open={open}>
          <summary
            aria-disabled={!hasFlowSelection}
            onClick={(event) => {
              event.preventDefault();
              if (hasFlowSelection) setPanelHeight(open ? 'collapsed' : 'expanded');
            }}
          >
            <span className="transaction-summary-content">
              <span className="transaction-summary-title">
                <SummaryIcon size={16} aria-hidden="true" />
                {selectedAnnotation?.icon && (
                  <span
                    className="transaction-summary-annotation-icon"
                    role="img"
                    aria-label={`Annotation icon: ${selectedAnnotation.icon}`}
                  >
                    {selectedAnnotation.icon}
                  </span>
                )}
                {selectedAnnotation?.bookmarked && (
                  <Bookmark
                    size={14}
                    className="transaction-summary-bookmark-icon"
                    aria-label="Bookmarked"
                  />
                )}
                <span>{summaryLabel}</span>
                {hasFlowSelection && selected && (
                  <code title={selected.id.replace(/^(?:tx|out|addr):/, '')}>
                    <ResponsiveIdentifier value={selected.id} preferFull />
                  </code>
                )}
                {selected?.kind === 'transaction' && current && (
                  <span
                    className="transaction-summary-counts"
                    title={`${current.tx.vin.length} inputs / ${current.tx.vout.length} outputs`}
                    aria-label={`${current.tx.vin.length} inputs / ${current.tx.vout.length} outputs`}
                  >
                    ({current.tx.vin.length}/{current.tx.vout.length})
                  </span>
                )}
              </span>
              {hasFlowSelection && (
                <small
                  title={
                    selected?.kind === 'address' || !current
                      ? undefined
                      : transactionStatus(current.tx).title
                  }
                >
                  {selected?.kind === 'address'
                    ? props.addressHistoryLoad?.error
                      ? 'Address history unavailable'
                      : props.addressHistoryLoad?.phase === 'history'
                        ? 'Checking address history…'
                        : props.addressHistoryLoad?.phase === 'details'
                          ? `Loading history ${props.addressHistoryLoad.done}/${props.addressHistoryLoad.total}`
                          : props.addressHistoryLoad?.phase === 'balance'
                            ? 'Checking address balance…'
                            : props.addressHistory
                              ? `${props.addressHistory.knownCount} known transactions`
                              : 'History not loaded'
                    : current
                      ? transactionStatus(current.tx).label
                      : 'Not loaded'}
                  {selected?.kind === 'address' && props.addressHistory && (
                    <>
                      {' · Balance '}
                      <Amount value={addressBalanceSats(props.addressBalance)} unknown="Unknown" />
                    </>
                  )}
                </small>
              )}
            </span>
          </summary>
          {hasFlowSelection && selected && (
            <div className="transaction-view-body">
              <div className="transaction-view-actions">
                {!!props.missingInputCount && props.onLoadAllInputs && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!disabledReason || inputLoading}
                    title={
                      disabledReason ||
                      `Fetch up to ${props.missingInputCount} parent transactions for missing input details. Up to 500 per action; other branches are not followed.`
                    }
                    onClick={props.onLoadAllInputs}
                  >
                    Load missing input details ({props.missingInputCount})
                  </button>
                )}
              </div>
              {selected.kind === 'address' ? (
                <AddressHistoryView
                  history={
                    props.addressHistory ?? {
                      address: selected.address ?? '',
                      entries: [],
                      knownCount: 0,
                      loadedCount: 0,
                      unloadedCount: 0,
                      complete: false,
                      source: 'loaded transactions',
                    }
                  }
                  workspace={workspace}
                  disabledReason={disabledReason}
                  onLoad={props.onLoadAddressHistory}
                  loading={props.addressHistoryLoad}
                  addressUtxos={props.addressUtxos}
                  onLoadUtxos={props.onLoadAddressUtxos}
                  onOpenTransaction={props.onOpenAddressHistoryTransaction}
                  renderMetadata={renderMetadata}
                />
              ) : current ? (
                <TransactionRows
                  {...props}
                  tx={current.tx}
                  key={current.tx.txid}
                  spends={spends}
                  previousOutputs={previousOutputs}
                  onNavigate={navigate}
                  onSelect={(id) => {
                    choose(current.tx.txid);
                    onSelect(id);
                  }}
                  onEdit={(id, target) => {
                    choose(current.tx.txid);
                    props.onEdit(id, target);
                  }}
                  previous={preview('previous')}
                  next={preview('next')}
                  identity={
                    <div className="transaction-flow-center">
                      {props.onSmallAmountThresholdChange && (
                        <div className="transaction-flow-amounts">
                          <SmallAmountControl
                            context="flow"
                            threshold={workspace.view.flowAmountThreshold}
                            onChange={props.onSmallAmountThresholdChange}
                          />
                        </div>
                      )}
                      <div
                        className={`transaction-view-identity ${selected.id === txNodeId(current.tx.txid) ? 'is-selected' : ''}`}
                      >
                        <button
                          type="button"
                          className="transaction-identity-select"
                          aria-label={`Select displayed transaction ${current.tx.txid}`}
                          aria-pressed={selected.id === txNodeId(current.tx.txid)}
                          title={current.tx.txid}
                          onClick={() => onSelect(txNodeId(current.tx.txid))}
                        >
                          <span className="transaction-identity-titlebar">
                            <span className="transaction-identity-icons">
                              <Box size={16} aria-hidden="true" />
                              {workspace.annotations[txNodeId(current.tx.txid)]?.icon && (
                                <span
                                  className="transaction-annotation-icon"
                                  role="img"
                                  aria-label={`Annotation icon: ${workspace.annotations[txNodeId(current.tx.txid)].icon}`}
                                >
                                  {workspace.annotations[txNodeId(current.tx.txid)].icon}
                                </span>
                              )}
                              {workspace.annotations[txNodeId(current.tx.txid)]?.bookmarked && (
                                <Bookmark size={14} aria-label="Bookmarked" />
                              )}
                            </span>
                            <strong className="mono transaction-identity-id">
                              <ResponsiveIdentifier value={current.tx.txid} />
                            </strong>
                            <span
                              className="transaction-identity-io"
                              title="Inputs / outputs"
                              aria-label={`${current.tx.vin.length} inputs / ${current.tx.vout.length} outputs`}
                            >
                              {current.tx.vin.length}/{current.tx.vout.length}
                            </span>
                          </span>
                          <span className="transaction-identity-body">
                            <TransactionBlockTime
                              transaction={current.tx}
                              workspace={workspace}
                              showFee={false}
                              separateStatusAndTime
                            />
                            {workspace.annotations[txNodeId(current.tx.txid)]?.label && (
                              <strong
                                className="transaction-identity-label"
                                title={workspace.annotations[txNodeId(current.tx.txid)].label}
                              >
                                {workspace.annotations[txNodeId(current.tx.txid)].label}
                              </strong>
                            )}
                            {props.renderMetadata?.(txNodeId(current.tx.txid))}
                          </span>
                          <span className="transaction-identity-footer">
                            <TransactionFeeLabel transaction={current.tx} workspace={workspace} />
                          </span>
                        </button>
                        <div
                          className="transaction-identity-tools"
                          role="group"
                          aria-label="Transaction annotation tools"
                        >
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Edit displayed transaction annotation"
                            title="Edit transaction label"
                            onClick={() => props.onEdit(txNodeId(current.tx.txid), 'label')}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Edit displayed transaction tags"
                            title="Choose transaction tags"
                            onClick={(event) =>
                              setQuickEditor({
                                kind: 'tags',
                                nodeId: txNodeId(current.tx.txid),
                                anchor: event.currentTarget,
                                point: event.detail
                                  ? { x: event.clientX, y: event.clientY }
                                  : undefined,
                              })
                            }
                          >
                            <Tags size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Edit displayed transaction icon"
                            title="Choose transaction icon"
                            onClick={(event) =>
                              setQuickEditor({
                                kind: 'icon',
                                nodeId: txNodeId(current.tx.txid),
                                anchor: event.currentTarget,
                                point: event.detail
                                  ? { x: event.clientX, y: event.clientY }
                                  : undefined,
                              })
                            }
                          >
                            <Smile size={13} />
                          </button>
                          <CopyButton
                            value={current.tx.txid}
                            label="Copy displayed transaction ID"
                          />
                        </div>
                        {(currentNotOnGraph ||
                          props.hiddenNodeIds?.includes(txNodeId(current.tx.txid))) && (
                          <div className="transaction-hidden-state">
                            <span className="entity-hidden-badge">
                              <EyeOff size={10} /> {currentNotOnGraph ? 'Not on graph' : 'Hidden'}
                            </span>
                            {props.onSetHidden && (
                              <button
                                type="button"
                                className="text-button"
                                aria-label={
                                  currentNotOnGraph
                                    ? 'Add displayed transaction to graph'
                                    : 'Show displayed transaction in graph'
                                }
                                onClick={() =>
                                  props.onSetHidden?.([txNodeId(current.tx.txid)], false)
                                }
                              >
                                {currentNotOnGraph ? 'Add to graph' : 'Show'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  }
                />
              ) : (
                <p className="small" role="status">
                  {inputLoading
                    ? 'Loading creating transaction…'
                    : 'Creating transaction unavailable.'}
                </p>
              )}
              {quickEditor?.kind === 'tags' && (
                <MetadataPopover
                  anchor={quickEditor.anchor}
                  compact
                  point={quickEditor.point}
                  onClose={() => setQuickEditor(undefined)}
                >
                  <BatchTagEditor
                    id={quickEditorId}
                    workspace={workspace}
                    ids={[quickEditor.nodeId]}
                    single
                    onClose={() => setQuickEditor(undefined)}
                    onApply={(_summary, update) => props.onApplyTags(update)}
                  />
                </MetadataPopover>
              )}
              {quickEditor?.kind === 'icon' && (
                <MetadataPopover
                  anchor={quickEditor.anchor}
                  compact
                  point={quickEditor.point}
                  onClose={() => setQuickEditor(undefined)}
                >
                  <IconPalette
                    id={quickEditorId}
                    value={workspace.annotations[quickEditor.nodeId]?.icon ?? ''}
                    onChange={(icon) => props.onSetIcon(quickEditor.nodeId, icon)}
                    onClose={() => setQuickEditor(undefined)}
                  />
                </MetadataPopover>
              )}
              <div className="transaction-view-actions">
                {selected.kind === 'output' &&
                  !missingCreating &&
                  !selectedUnspendable &&
                  !!(loadedSpenders.length || walletObservation) && (
                    <small
                      className="transaction-coverage"
                      title="Missing loaded spends do not establish that an output is unspent."
                    >
                      {loadedSpenders.length
                        ? `${loadedSpenders.length} loaded ${loadedSpenders.length === 1 ? 'spend' : 'spend alternatives'}`
                        : 'No spending transaction loaded'}
                      {walletObservation && (
                        <span>
                          {' · Unspent at wallet check · '}
                          <time dateTime={walletObservation.checkedAt}>
                            {formatLocalTimestamp(walletObservation.checkedAt) ?? 'Unknown time'}
                          </time>
                        </span>
                      )}
                      {loadedSpenders.length > 0 && (
                        <button
                          type="button"
                          className="text-button"
                          aria-label="Check this output for spends"
                          disabled={!!disabledReason}
                          title={
                            disabledReason ||
                            'Check this exact output for additional spending transactions'
                          }
                          onClick={() => onTrace('spending', selected.id)}
                        >
                          Check again
                        </button>
                      )}
                    </small>
                  )}
              </div>
            </div>
          )}
          {hasFlowSelection && (inputLoading || inputError) && (
            <div className="transaction-input-feedback">
              {inputLoading && (
                <small className="transaction-input-status" role="status">
                  Loading previous outputs…
                </small>
              )}
              {inputError && (
                <div className="transaction-input-error" role="alert">
                  <span>{inputError}</span>
                  {onRetryInputs && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!disabledReason || inputLoading}
                      title={disabledReason}
                      onClick={onRetryInputs}
                    >
                      Retry previous outputs
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </details>
        <div className="transaction-view-footer">
          <button
            type="button"
            className="icon-button transaction-height-toggle"
            aria-label={open ? 'Collapse flow panel' : 'Expand flow panel'}
            title={open ? 'Collapse flow panel' : 'Expand flow panel'}
            aria-expanded={open}
            disabled={!hasFlowSelection}
            onClick={() => setPanelHeight(open ? 'collapsed' : 'expanded')}
          >
            {open && fullHeight ? (
              <ChevronsUp size={14} aria-hidden="true" />
            ) : open ? (
              <ArrowUp size={14} aria-hidden="true" />
            ) : (
              <ArrowDown size={14} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="icon-button transaction-height-toggle"
            aria-label={
              open && fullHeight ? 'Restore flow panel height' : 'Expand flow panel to full height'
            }
            title={
              open && fullHeight ? 'Restore flow panel height' : 'Expand flow panel to full height'
            }
            onClick={() => setPanelHeight(open && fullHeight ? 'expanded' : 'full')}
            disabled={!hasFlowSelection}
          >
            {open && fullHeight ? (
              <ArrowUp size={14} aria-hidden="true" />
            ) : open ? (
              <ChevronsDown size={14} aria-hidden="true" />
            ) : (
              <ChevronsDown size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
