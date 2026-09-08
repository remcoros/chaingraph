import { SmallAmountControl } from './SmallAmountControl';
import { isSmallAmount } from '../domain/smallAmounts';
import { transactionStatus } from '../domain/transactionStatus';
import { useMemo, useState, useRef, useLayoutEffect, type ReactNode } from 'react';
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
  formatSats,
} from '../domain/types';
import { relatedTransactions } from '../domain/transactionInspection';
import { indexLoadedSpends, selectedFlowLeg } from '../domain/transactionFlow';
import { decodeOpReturn } from '../domain/opReturn';
import { outputAddress } from '../domain/workspace';
import { CopyButton } from './CopyButton';
import { OpReturnData } from './OpReturnData';
import './transaction-view.css';
import type { VisibilityProps } from './VisibilityActions';

interface Props extends VisibilityProps {
  workspace: Workspace;
  selected?: GraphNode;
  onSelect: (id: string) => void;
  onEdit: (id: string, target?: 'label' | 'tags' | 'icon') => void;
  onTrace: (direction: 'funding' | 'spending', id: string) => void;
  disabledReason?: string;
  inputLoading?: boolean;
  inputError?: string;
  onRetryInputs?: () => void;
  onSmallAmountThresholdChange?: (threshold: number) => void;
  renderMetadata?: (nodeId: string) => ReactNode;
  state?: TransactionFlowState;
  onStateChange?: (state: TransactionFlowState) => void;
}
interface Row {
  id?: string;
  index: number;
  output?: TxOutput;
  previousTxid?: string;
  coinbase: boolean;
}

function TransactionRows({
  tx,
  workspace,
  selected,
  onSelect,
  onEdit,
  onTrace,
  disabledReason,
  inputLoading,
  onSmallAmountThresholdChange,
  hiddenNodeIds = [],
  onSetHidden,
  renderMetadata,
  state,
  onStateChange,
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
  const flow = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLDivElement>(null);
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
    // Return compact lists to their start; the selection visibility effect below
    // then brings an explicitly selected outpoint back into view when necessary.
    if (panel) panel.scrollTop = 0;
  }, [expandedInputs, expandedOutputs]);
  useLayoutEffect(() => {
    const row = selectedRow.current;
    const panel = row?.closest<HTMLDetailsElement>('.transaction-view');
    if (!row || !panel) return;
    let followSelection = true;
    let frame = 0;
    const visibleBounds = () => {
      if (!panel.open || !panel.getClientRects().length) return;
      const bounds = panel.getBoundingClientRect();
      const heading = panel.querySelector(':scope > summary')?.getBoundingClientRect();
      const laneHeading = row.closest('section')?.querySelector('.transaction-lane-header');
      return {
        top:
          (heading?.bottom ?? bounds.top) + (laneHeading?.getBoundingClientRect().height ?? 0) + 4,
        bottom: bounds.bottom - 8,
        row: row.getBoundingClientRect(),
      };
    };
    const keepVisible = () => {
      const bounds = visibleBounds();
      if (!bounds || !followSelection) return;
      const delta =
        bounds.row.height > bounds.bottom - bounds.top || bounds.row.top < bounds.top
          ? bounds.row.top - bounds.top
          : Math.max(0, bounds.row.bottom - bounds.bottom);
      // Scroll this panel only. scrollIntoView can also move outer page containers.
      panel.scrollTop += delta;
    };
    const rememberScroll = () => {
      const bounds = visibleBounds();
      if (!bounds) return;
      // Browsing away from the selection is intentional. Geometry changes must
      // not pull the user back. Scrolling the selection into view resumes following.
      followSelection =
        bounds.row.top >= bounds.top - 1 &&
        (bounds.row.bottom <= bounds.bottom + 1 ||
          (bounds.row.height > bounds.bottom - bounds.top && bounds.row.top <= bounds.top + 1));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(keepVisible);
    };
    keepVisible();
    panel.addEventListener('scroll', rememberScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(row);
    observer.observe(panel);
    const body = panel.querySelector('.transaction-view-body');
    if (body) observer.observe(body);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      panel.removeEventListener('scroll', rememberScroll);
    };
  }, [selected?.id, expandedInputs, expandedOutputs, workspace.view.flowAmountThreshold]);
  const inputRows: Row[] = tx.vin.map((input, index) => ({
    id: input.txid !== undefined ? outputNodeId(input.txid, input.vout!) : undefined,
    index,
    output: input.txid ? workspace.transactions[input.txid]?.vout[input.vout!] : undefined,
    previousTxid: input.txid,
    coinbase: input.coinbase !== undefined,
  }));
  const outputRows: Row[] = tx.vout.map((output) => ({
    id: outputNodeId(tx.txid, output.n),
    index: output.n,
    output,
    coinbase: false,
  }));
  const columns = [
    { name: 'Inputs', rows: inputRows, expanded: expandedInputs, toggle: setExpandedInputs },
    { name: 'Outputs', rows: outputRows, expanded: expandedOutputs, toggle: setExpandedOutputs },
  ];
  return (
    <div ref={flow} className="transaction-columns transaction-flow">
      <div className="transaction-flow-previous">{previous}</div>
      {identity}
      <div className="transaction-flow-next">{next}</div>
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
            </div>
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
            <div className="transaction-rows">
              {shown.map((row) => {
                const address = row.output && outputAddress(row.output);
                const opReturn = decodeOpReturn(row.output?.scriptPubKey.hex);
                const label = row.id && workspace.annotations[row.id]?.label;
                const destinations = row.id ? (spends.get(row.id) ?? []) : [];
                const loaded = inputs
                  ? !!workspace.transactions[row.previousTxid ?? '']
                  : destinations.length > 0;
                const navigate = () => {
                  if (!row.id) return;
                  if (inputs) {
                    if (loaded) onNavigate(row.previousTxid!, row.id);
                    else {
                      onSelect(row.id);
                      onTrace('funding', row.id);
                    }
                  } else if (destinations.length === 1) onNavigate(destinations[0].txid, row.id);
                  else {
                    onSelect(row.id);
                    if (!destinations.length) onTrace('spending', row.id);
                  }
                };
                const navigationLabel = inputs
                  ? `${loaded ? 'Go to' : 'Load'} previous transaction for input ${row.index}`
                  : destinations.length > 1
                    ? `Choose among ${destinations.length} loaded spends of output ${row.index}`
                    : destinations.length === 1
                      ? `Go to spending transaction for output ${row.index}`
                      : `Check output ${row.index} for spends`;
                return (
                  <div
                    key={row.index}
                    className={`transaction-row ${matches(row) ? 'is-selected' : ''}`}
                    data-selected={matches(row)}
                    ref={matches(row) ? selectedRow : undefined}
                  >
                    <div className="transaction-row-content">
                      <button
                        type="button"
                        className="transaction-row-select"
                        disabled={!row.id}
                        aria-label={`${inputs ? 'Input' : 'Output'} ${row.index}${row.id ? `: ${row.id.slice(4)}` : ': Coinbase'}`}
                        aria-pressed={matches(row)}
                        title={
                          row.id ? `${address ? `${address}\n` : ''}${row.id.slice(4)}` : 'Coinbase'
                        }
                        onClick={() => row.id && onSelect(row.id)}
                      >
                        <span className="transaction-row-index">#{row.index}</span>
                        <span className="transaction-row-main">
                          <strong>
                            {row.coinbase
                              ? 'Coinbase'
                              : label ||
                                (opReturn
                                  ? 'OP_RETURN'
                                  : address
                                    ? short(address, 8)
                                    : !row.output
                                      ? inputLoading
                                        ? 'Loading previous output…'
                                        : 'Previous output unavailable'
                                      : 'Script output')}
                          </strong>
                          <span>
                            {row.coinbase
                              ? 'Newly created coins'
                              : formatSats(row.output ? sats(row.output.value) : undefined)}
                          </span>
                          {matches(row) && belowThreshold(row) && (
                            <span
                              className="amount-selection-badge"
                              title="The selected output stays visible below the amount filter."
                            >
                              Selected · outside filter
                            </span>
                          )}
                          {row.id && hidden.has(row.id) && (
                            <span className="entity-hidden-badge">
                              <EyeOff size={10} /> Hidden
                            </span>
                          )}
                          {row.id && renderMetadata?.(row.id)}
                        </span>
                      </button>
                      {opReturn && <OpReturnData hex={row.output!.scriptPubKey.hex} />}
                    </div>
                    {row.id && (
                      <div className="transaction-row-tools">
                        {hidden.has(row.id) && onSetHidden && (
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Show ${inputs ? 'input' : 'output'} ${row.index} in graph`}
                            onClick={() => onSetHidden([row.id!], false)}
                          >
                            <Eye size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-button transaction-row-edit"
                          aria-label={`Edit ${inputs ? 'input' : 'output'} ${row.index} annotation`}
                          onClick={() => onEdit(row.id!)}
                        >
                          <Pencil size={12} />
                        </button>
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
                      </div>
                    )}
                  </div>
                );
              })}
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
  const related = useMemo(
    () => (selected ? relatedTransactions(workspace.transactions, selected) : []),
    [workspace.transactions, selected?.id],
  );
  const spends = useMemo(() => indexLoadedSpends(workspace.transactions), [workspace.transactions]);
  const [choice, setChoice] = useState('');
  const current =
    related.find(({ tx }) => tx.txid === (state?.transactionId ?? choice)) ?? related[0];
  const choose = (transactionId: string) => {
    setChoice(transactionId);
    if (transactionId === state?.transactionId) return;
    onStateChange?.({ ...state, transactionId, expandedInputs: false, expandedOutputs: false });
  };
  if (!selected || (selected.kind === 'address' && !related.length)) return null;
  const navigate = (txid: string, outputId: string) => {
    choose(txid);
    onSelect(outputId);
  };
  const leg = current
    ? selectedFlowLeg(current.tx, selected.kind === 'output' ? selected.id : undefined)
    : undefined;
  const missingCreating =
    selected.kind === 'output' && !workspace.transactions[selected.txid ?? ''];
  const selectedOutput =
    selected.kind === 'output'
      ? workspace.transactions[selected.txid ?? '']?.vout[selected.vout ?? -1]
      : undefined;
  const selectedUnspendable = !!decodeOpReturn(selectedOutput?.scriptPubKey.hex);
  const loadedSpenders = selected.kind === 'output' ? (spends.get(selected.id) ?? []) : [];
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
                <strong>
                  {workspace.annotations[txNodeId(tx.txid)]?.label || short(tx.txid, 6)}
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
                ? 'No spending transaction loaded. Query this exact output’s script history.'
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
                {direction === 'previous' ? 'Previous transaction' : 'Spend status unknown'}
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
      open={state?.open ?? true}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (open !== (state?.open ?? true)) onStateChange?.({ ...state, open });
      }}
    >
      <summary>
        <span className="transaction-summary-content">
          <span>Transaction flow</span>
          {(state?.open ?? true) && props.onSmallAmountThresholdChange && (
            <SmallAmountControl
              context="flow"
              threshold={workspace.view.flowAmountThreshold}
              onChange={props.onSmallAmountThresholdChange}
            />
          )}
          <small title={current ? transactionStatus(current.tx).title : undefined}>
            {current ? transactionStatus(current.tx).label : 'Not loaded'}
          </small>
        </span>
      </summary>
      <div className="transaction-view-body">
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
            previous={preview('previous')}
            next={preview('next')}
            identity={
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
                  <span>
                    <span>{current.role}</span>{' '}
                    <span className="transaction-caption-noun">transaction</span>
                  </span>
                  <strong className="mono">{short(current.tx.txid, 7)}</strong>
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
                {props.hiddenNodeIds?.includes(txNodeId(current.tx.txid)) && (
                  <div className="transaction-hidden-state">
                    <span className="entity-hidden-badge">
                      <EyeOff size={10} /> Hidden
                    </span>
                    {props.onSetHidden && (
                      <button
                        type="button"
                        className="text-button"
                        aria-label="Show displayed transaction in graph"
                        onClick={() => props.onSetHidden?.([txNodeId(current.tx.txid)], false)}
                      >
                        Show
                      </button>
                    )}
                  </div>
                )}
                {related.length > 1 && (
                  <select
                    className="transaction-choice"
                    aria-label="Displayed transaction"
                    value={current.tx.txid}
                    onChange={(e) => choose(e.target.value)}
                  >
                    {related.map(({ tx, role }) => (
                      <option key={tx.txid} value={tx.txid}>
                        {role}:{' '}
                        {workspace.annotations[txNodeId(tx.txid)]?.label
                          ? `${workspace.annotations[txNodeId(tx.txid)].label} · `
                          : ''}
                        {short(tx.txid, 6)}
                      </option>
                    ))}
                  </select>
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
          {selected.kind === 'output' && !missingCreating && !selectedUnspendable && (
            <small
              className="transaction-coverage"
              title="Missing loaded spends do not establish that an output is unspent."
            >
              {loadedSpenders.length
                ? `${loadedSpenders.length} loaded ${loadedSpenders.length === 1 ? 'spend' : 'spend alternatives'}`
                : 'Spend status unknown'}
              {loadedSpenders.length > 0 && (
                <button
                  type="button"
                  className="text-button"
                  aria-label="Check this output for spends"
                  disabled={!!disabledReason}
                  title={
                    disabledReason ||
                    'Check this output’s script history for additional spending transactions'
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
    </details>
  );
}
