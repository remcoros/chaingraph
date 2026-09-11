import { Amount } from './Amount';
import {
  matchingWalletUtxoObservation,
  type WalletUtxoObservation,
} from '../domain/walletUtxoObservation';
import { SmallAmountControl } from './SmallAmountControl';
import { isSmallAmount } from '../domain/smallAmounts';
import { transactionStatus } from '../domain/transactionStatus';
import { TransactionBlockTime } from './TransactionBlockTime';
import {
  memo,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from 'react';
import { Pencil, ArrowLeft, ArrowRight, Box, Tags, Smile, Eye, EyeOff } from 'lucide-react';
import {
  type GraphNode,
  type Transaction,
  type TransactionFlowState,
  type TxOutput,
  type Workspace,
  outputNodeId,
  txNodeId,
  short,
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

interface Props extends VisibilityProps {
  workspace: Workspace;
  walletUtxoObservation?: WalletUtxoObservation;
  selected?: GraphNode;
  onSelect: (id: string) => void;
  onEdit: (id: string, target?: 'label' | 'tags' | 'icon') => void;
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
      className={`transaction-row ${selected ? 'is-selected' : ''} ${pinned ? 'is-pinned' : ''} ${batchSelected ? 'is-batch-selected' : ''}`}
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
        <button
          type="button"
          className="transaction-row-select"
          disabled={!row.id}
          aria-label={`${inputs ? 'Input' : 'Output'} ${row.index}${row.id ? `: ${row.id.slice(4)}` : ': Coinbase'}`}
          aria-pressed={selected}
          title={row.id ? `${address ? `${address}\n` : ''}${row.id.slice(4)}` : 'Coinbase'}
          onClick={(event) => {
            if (!row.id) return;
            if (actions.current.toggleSelection && (event.ctrlKey || event.metaKey))
              actions.current.toggleSelection?.(row.id);
            else actions.current.onSelect(row.id);
          }}
        >
          <span className="transaction-row-index">#{row.index}</span>
          <span className="transaction-row-main">
            <span className="transaction-row-heading">
              <strong>
                {row.coinbase
                  ? 'Coinbase'
                  : opReturn
                    ? 'OP_RETURN'
                    : address
                      ? short(address)
                      : !row.output
                        ? inputLoading && selected
                          ? 'Loading previous output…'
                          : 'Select to load previous output'
                        : 'Script output'}
              </strong>
              {!row.coinbase && <Amount value={row.output ? sats(row.output.value) : undefined} />}
            </span>
            {label && <span className="transaction-row-label">{label}</span>}
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
        </button>
        {opReturn && <OpReturnData hex={row.output!.scriptPubKey.hex} />}
      </div>
      {row.id && (
        <div className="transaction-row-tools">
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
  onNavigate,
  identity,
  previous,
  next,
}: Props & {
  tx: Transaction;
  spends: ReturnType<typeof indexLoadedSpends>;
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
  const previousOutputs = useMemo(() => indexPreviousOutputs(workspace), [workspace.transactions]);
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
                {filteredCount > 0 && (
                  <button
                    type="button"
                    className="text-button transaction-amount-recovery"
                    aria-label={`Show ${filteredCount} amount-filtered ${name.toLowerCase()}`}
                    onClick={() => onSmallAmountThresholdChange?.(0)}
                  >
                    {filteredCount} filtered · Show
                  </button>
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
  } = props;
  const spends = useMemo(() => indexLoadedSpends(workspace.transactions), [workspace.transactions]);
  const related = useMemo(
    () => (selected ? relatedTransactions(workspace.transactions, selected, spends) : []),
    [workspace.transactions, selected?.id, spends],
  );
  const previousOutputs = useMemo(() => indexPreviousOutputs(workspace), [workspace.transactions]);
  const [choice, setChoice] = useState('');
  const current =
    related.find(({ tx }) => tx.txid === (state?.transactionId ?? choice)) ?? related[0];
  const choose = (transactionId: string) => {
    setChoice(transactionId);
    if (transactionId === state?.transactionId) return;
    onStateChange?.({ ...state, transactionId, expandedInputs: false, expandedOutputs: false });
  };
  if (!selected || (selected.kind === 'address' && !related.length)) return null;
  const currentNotOnGraph =
    !!current &&
    props.graphNodeIds !== undefined &&
    !props.graphNodeIds.includes(txNodeId(current.tx.txid));
  const navigate = (txid: string, outputId: string) => {
    choose(txid);
    props.onSetHidden?.([txNodeId(txid)], false);
    onSelect(outputId);
  };
  const leg = current
    ? selectedFlowLeg(current.tx, selected.kind === 'output' ? selected.id : undefined)
    : undefined;
  const missingCreating =
    selected.kind === 'output' && !workspace.transactions[selected.txid ?? ''];
  const selectedResolution =
    selected.kind === 'output' && selected.txid !== undefined && selected.vout !== undefined
      ? resolvePreviousOutput(workspace, selected, previousOutputs)
      : undefined;
  const selectedOutput =
    selectedResolution?.status === 'loaded' || selectedResolution?.status === 'attached'
      ? selectedResolution.output
      : undefined;
  const selectedUnspendable = isOpReturn(selectedOutput?.scriptPubKey.hex);
  const loadedSpenders = selected.kind === 'output' ? (spends.get(selected.id) ?? []) : [];
  const walletObservation =
    selected.kind === 'output'
      ? matchingWalletUtxoObservation(
          walletUtxoObservation,
          workspace,
          selected.txid,
          selected.vout,
        )
      : undefined;
  const preview = (direction: 'previous' | 'next') => {
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
                <strong>{workspace.annotations[txNodeId(tx.txid)]?.label || short(tx.txid)}</strong>
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
  return (
    <details
      className="transaction-view"
      data-tour="transaction-flow"
      open={state?.open ?? true}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (open !== (state?.open ?? true)) onStateChange?.({ ...state, open });
      }}
    >
      <summary>
        <span className="transaction-summary-content">
          <span>Transaction flow</span>
          <small title={current ? transactionStatus(current.tx).title : undefined}>
            {current ? transactionStatus(current.tx).label : 'Not loaded'}
          </small>
        </span>
      </summary>
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
        {current ? (
          <TransactionRows
            {...props}
            tx={current.tx}
            key={current.tx.txid}
            spends={spends}
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
                    <Box size={25} aria-hidden="true" />
                    <span title="Inputs / outputs">
                      {current.role === 'Selected' ? 'Transaction' : `${current.role} transaction`}{' '}
                      ({current.tx.vin.length} / {current.tx.vout.length})
                    </span>
                    <strong className="mono">{short(current.tx.txid)}</strong>
                    {workspace.annotations[txNodeId(current.tx.txid)]?.label && (
                      <strong
                        className="transaction-identity-label"
                        title={workspace.annotations[txNodeId(current.tx.txid)].label}
                      >
                        {workspace.annotations[txNodeId(current.tx.txid)].label}
                      </strong>
                    )}
                    {props.renderMetadata?.(txNodeId(current.tx.txid))}
                  </button>
                  <TransactionBlockTime transaction={current.tx} />
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
                      onClick={() => props.onEdit(txNodeId(current.tx.txid), 'tags')}
                    >
                      <Tags size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Edit displayed transaction icon"
                      title="Choose transaction icon"
                      onClick={() => props.onEdit(txNodeId(current.tx.txid), 'icon')}
                    >
                      <Smile size={13} />
                    </button>
                    <CopyButton value={current.tx.txid} label="Copy displayed transaction ID" />
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
                          onClick={() => props.onSetHidden?.([txNodeId(current.tx.txid)], false)}
                        >
                          {currentNotOnGraph ? 'Add to graph' : 'Show'}
                        </button>
                      )}
                    </div>
                  )}
                  {related.length > 1 && (
                    <select
                      className="transaction-choice"
                      aria-label="Displayed transaction"
                      value={current.tx.txid}
                      onChange={(e) => navigate(e.target.value, selected.id)}
                    >
                      {related.map(({ tx, role }) => (
                        <option key={tx.txid} value={tx.txid}>
                          {role}:{' '}
                          {workspace.annotations[txNodeId(tx.txid)]?.label
                            ? `${workspace.annotations[txNodeId(tx.txid)].label} · `
                            : ''}
                          {short(tx.txid)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {props.onSmallAmountThresholdChange && (
                  <div className="transaction-flow-amounts">
                    <SmallAmountControl
                      context="flow"
                      threshold={workspace.view.flowAmountThreshold}
                      onChange={props.onSmallAmountThresholdChange}
                    />
                  </div>
                )}
              </div>
            }
          />
        ) : (
          <p className="small" role="status">
            {inputLoading ? 'Loading creating transaction…' : 'Creating transaction unavailable.'}
          </p>
        )}
        <div className="transaction-view-actions">
          {selected.kind === 'output' && !missingCreating && !selectedUnspendable && (
            <small
              className="transaction-coverage"
              title="Missing loaded spends do not establish that an output is unspent."
            >
              {loadedSpenders.length
                ? `${loadedSpenders.length} loaded ${loadedSpenders.length === 1 ? 'spend' : 'spend alternatives'}`
                : walletObservation
                  ? 'No spending transaction loaded'
                  : 'Spend status unknown'}
              {walletObservation && (
                <span>
                  {' · Unspent at wallet check · '}
                  <time dateTime={walletObservation.checkedAt}>
                    {new Date(walletObservation.checkedAt).toLocaleString()}
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
                    disabledReason || 'Check this exact output for additional spending transactions'
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
      {(inputLoading || inputError) && (
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
  );
}
