import {
  memo,
  useId,
  useMemo,
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
} from 'lucide-react';
import { Amount } from '../../../../Controls/Display/Amount';
import { transactionStatus } from '../../../../Controls/Display/transactionStatus';
import {
  matchingWalletUtxoObservation,
  type WalletUtxoObservation,
} from '../../../../../Core/Workspace/Wallets/WalletUtxos/walletUtxoObservation';
import { SmallAmountControl } from '../SmallAmountControl';
import { isSmallAmount } from '../smallAmounts';
import {
  TransactionBlockTime,
  TransactionFeeLabel,
} from '../../../../Controls/Display/TransactionBlockTime';
import {
  type Transaction,
  indexPreviousOutputs,
  resolvePreviousOutput,
} from '../../../../../Core/ChainData';
import {
  type TxOutput,
  sats,
  outputAddress,
  isProvablyUnspendable,
} from '../../../../../Core/Bitcoin';
import {
  outpointReference,
  transactionReference,
} from '../../../../../Core/Workspace/entityReferences';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { TransactionFlowState } from '../../../../../Core/Workspace/view';
import { relatedTransactions } from '../../../Selection/relatedTransactions';
import { indexLoadedSpends, selectedFlowLeg } from './transactionFlow';

import { CopyButton } from '../../../../Controls/CopyButton';
import { OpReturnData } from '../../../../Controls/Display/OpReturnData';
import { SelectionCheckbox } from '../../../Selection/SelectionToolbar';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
import { BatchTagEditor, MetadataPopover } from '../../../../Controls/Metadata/MetadataEditors';
import { IconPalette } from '../../../../Controls/Metadata/IconPicker';
import { formatLocalTimestamp } from '../../../../Controls/Display/transactionTime';
import type { GraphNode } from '../../../GraphState/types';

import type { VisibilityProps } from '../../../Selection/VisibilityActions';
import type { EntitySelection } from '../../../Selection/useEntitySelection';

export interface FlowPanelTransactionViewProps extends VisibilityProps {
  workspace: Workspace;
  selected?: GraphNode;
  walletUtxoObservation?: WalletUtxoObservation;
  onSelect: (id: string) => void;
  onEdit: (id: string, target?: 'label' | 'tags' | 'icon') => void;
  onApplyTags: (update: (workspace: Workspace) => Workspace) => void;
  onSetIcon: (id: string, icon: string) => void;
  onTrace: (direction: 'funding' | 'spending', id: string) => void;
  disabledReason?: string;
  inputLoading?: boolean;
  inputError?: string;
  onRetryInputs?: () => void;
  onSmallAmountThresholdChange?: (threshold: number) => void;
  renderMetadata?: (nodeId: string) => ReactNode;
  state?: TransactionFlowState;
  onStateChange?: (state: TransactionFlowState) => void;
  selection?: EntitySelection;
  /** Parent transactions that would fill in missing input details. */
  missingInputCount?: number;
  onLoadAllInputs?: () => void;
}
type Props = FlowPanelTransactionViewProps;

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

const INITIAL_FLOW_ROW_LIMIT = 25;

function moveSelectedRowFirst(rows: Row[], selectedId?: string) {
  const selectedIndex = selectedId ? rows.findIndex((row) => row.id === selectedId) : -1;
  if (selectedIndex <= 0) return rows;
  return [rows[selectedIndex], ...rows.slice(0, selectedIndex), ...rows.slice(selectedIndex + 1)];
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
  const opReturn = row.output !== undefined && isProvablyUnspendable(row.output);
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
      <div
        className="transaction-row-content"
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
        <div className="transaction-row-select">
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
  const {
    network,
    chainData: { transactions },
  } = workspace;
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
  const selectedOutputId = selected?.kind === 'output' ? selected.id : undefined;
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
    const panel = flow.current?.closest<HTMLDetailsElement>('.flow-panel');
    // Return compact lists to their start. The selected outpoint stays pinned.
    if (panel) panel.scrollTop = 0;
  }, [expandedInputs, expandedOutputs]);
  useLayoutEffect(() => {
    const container = flow.current;
    const panel = container?.closest<HTMLDetailsElement>('.flow-panel');
    if (!container || !panel) return;
    const summary = panel.querySelector<HTMLElement>(':scope > summary');
    const feedback = panel.querySelector<HTMLElement>('.transaction-input-feedback');
    const center = container.querySelector<HTMLElement>('.transaction-flow-center');
    const actions = panel.querySelector<HTMLElement>('.flow-panel-body > .flow-panel-actions');
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
  useLayoutEffect(() => {
    if (!selectedOutputId) return;
    flow.current
      ?.querySelector<HTMLElement>('.transaction-row.is-pinned')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedOutputId]);
  const inputRows = useMemo<Row[]>(
    () =>
      tx.vin.map((input, index) => {
        const resolution = resolvePreviousOutput({ network, transactions }, input, previousOutputs);
        return {
          id: input.txid !== undefined ? outpointReference(input.txid, input.vout!) : undefined,
          index,
          output:
            resolution.status === 'loaded' || resolution.status === 'attached'
              ? resolution.output
              : undefined,
          previousTxid: input.txid,
          coinbase: input.coinbase !== undefined,
        };
      }),
    [tx, transactions, network, previousOutputs],
  );
  const outputRows = useMemo<Row[]>(
    () =>
      tx.vout.map((output) => ({
        id: outpointReference(tx.txid, output.n),
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
          : retained.filter((row, index) => index < INITIAL_FLOW_ROW_LIMIT || matches(row));
        // Keep the exact selected input or output at the visible start of its lane.
        const displayedRows = moveSelectedRowFirst(shown, selectedOutputId);
        const canExpand = retained.length > INITIAL_FLOW_ROW_LIMIT;
        const expandButton = canExpand ? (
          <button
            type="button"
            className="text-button transaction-expand"
            aria-label={`${expanded ? 'Collapse' : 'Show all'} ${retained.length} ${name.toLowerCase()}`}
            aria-expanded={expanded}
            onClick={() => toggle(!expanded)}
          >
            {expanded ? 'Collapse' : 'Show all'}
          </button>
        ) : null;
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
              <div
                className={`transaction-lane-header ${inputs ? 'transaction-lane-header-inputs' : 'transaction-lane-header-outputs'}`}
              >
                <div className="transaction-lane-summary">
                  {inputs && expandButton}
                  {inputs && canExpand && (
                    <span className="address-history-section-summary-separator" aria-hidden="true">
                      |
                    </span>
                  )}
                  <h4>
                    {rows.length}{' '}
                    {rows.length === 1 ? name.toLowerCase().slice(0, -1) : name.toLowerCase()}
                  </h4>
                  {!inputs && canExpand && (
                    <span className="address-history-section-summary-separator" aria-hidden="true">
                      |
                    </span>
                  )}
                  {!inputs && expandButton}
                </div>
                {filteredCount > 0 && (
                  <div className="transaction-lane-actions">
                    <button
                      type="button"
                      className="text-button transaction-amount-recovery"
                      aria-label={`${filteredCount} amounts filtered from ${name.toLowerCase()}. Clear amount filter`}
                      title="Clear amount filter"
                      onClick={() => onSmallAmountThresholdChange?.(0)}
                    >
                      {filteredCount} amounts filtered
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="transaction-rows">
              {displayedRows.map((row) => (
                <TransactionFlowRow
                  key={row.index}
                  row={row}
                  inputs={inputs}
                  selected={Boolean(matches(row))}
                  pinned={row.id === selected?.id}
                  belowThreshold={belowThreshold(row)}
                  label={row.id ? workspace.annotations.entities[row.id]?.label : undefined}
                  icon={row.id ? workspace.annotations.entities[row.id]?.icon : undefined}
                  loaded={
                    inputs
                      ? !!workspace.chainData.transactions[row.previousTxid ?? '']
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

// Panel lifetime preserves transaction choice and quick editors across selection kinds.
export function useFlowPanelTransaction(props: Props) {
  const { workspace, selected, state, onStateChange } = props;
  const {
    network,
    chainData: { transactions },
  } = workspace;
  const spends = useMemo(() => indexLoadedSpends(transactions), [transactions]);
  const related = useMemo(
    () => (selected ? relatedTransactions(transactions, selected, spends) : []),
    [transactions, selected, spends],
  );
  const previousOutputs = useMemo(
    () => indexPreviousOutputs({ network, transactions }),
    [transactions, network],
  );
  const [choice, setChoice] = useState('');
  const [quickEditor, setQuickEditor] = useState<{
    kind: 'tags' | 'icon';
    nodeId: string;
    anchor: HTMLElement;
    point?: { x: number; y: number };
  }>();
  const quickEditorId = useId();
  const current =
    related.find(({ tx }) => tx.txid === (state?.transactionId ?? choice)) ?? related[0];
  const choose = (transactionId: string) => {
    setChoice(transactionId);
    if (transactionId === state?.transactionId) return;
    onStateChange?.({ ...state, transactionId, expandedInputs: false, expandedOutputs: false });
  };
  const leg = current
    ? selectedFlowLeg(current.tx, selected?.kind === 'output' ? selected.id : undefined)
    : undefined;
  return {
    spends,
    previousOutputs,
    current,
    leg,
    choose,
    quickEditor,
    setQuickEditor,
    quickEditorId,
  };
}

/** Everything the transaction views share, computed once by the panel. */
export type TransactionFlowModel = ReturnType<typeof useFlowPanelTransaction>;

/** Where an output sits in the transaction being shown. */
function outputRole(selected: GraphNode | undefined, leg: TransactionFlowModel['leg']) {
  if (selected?.kind !== 'output') return 'transaction';
  return leg?.direction === 'previous' ? 'input' : 'output';
}

/** The transaction view's title bar contribution, including its input/output counts. */
/** The transaction view's header, which it owns end to end. */
export function TransactionFlowHeader({
  selected,
  annotation,
  model,
}: {
  selected: GraphNode;
  annotation?: { icon?: string; bookmarked?: boolean };
  model: TransactionFlowModel;
}) {
  const role = outputRole(selected, model.leg);
  const current = model.current;
  const Icon = role === 'input' ? ArrowRightToLine : role === 'output' ? ArrowRightFromLine : Box;
  return (
    <span className="flow-panel-header">
      <span className="flow-panel-title">
        <Icon size={16} aria-hidden="true" />
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
        <span>{role === 'input' ? 'Input' : role === 'output' ? 'Output' : 'Transaction'}</span>
        <code title={selected.id.replace(/^(?:tx|out):/, '')}>
          <ResponsiveIdentifier value={selected.id} preferFull />
        </code>
        {selected.kind === 'transaction' && current && (
          <span
            className="transaction-flow-counts"
            title={`${current.tx.vin.length} inputs / ${current.tx.vout.length} outputs`}
            aria-label={`${current.tx.vin.length} inputs / ${current.tx.vout.length} outputs`}
          >
            ({current.tx.vin.length}/{current.tx.vout.length})
          </span>
        )}
      </span>
      <small title={current ? transactionStatus(current.tx).title : undefined}>
        {current ? transactionStatus(current.tx).label : 'Not loaded'}
      </small>
    </span>
  );
}

/** Loading the parent transactions that supply missing input details. */
export function TransactionFlowActions({
  missingInputCount,
  onLoadAllInputs,
  disabledReason,
  inputLoading,
}: Pick<Props, 'disabledReason' | 'inputLoading'> & {
  missingInputCount?: number;
  onLoadAllInputs?: () => void;
}) {
  if (!missingInputCount || !onLoadAllInputs) return null;
  return (
    <button
      type="button"
      className="text-button"
      disabled={!!disabledReason || inputLoading}
      title={
        disabledReason ||
        `Fetch up to ${missingInputCount} parent transactions for missing input details. Up to 500 per action; other branches are not followed.`
      }
      onClick={onLoadAllInputs}
    >
      Load missing input details ({missingInputCount})
    </button>
  );
}

/** Progress and failure of the previous-output load, shown under the body. */
export function TransactionFlowFeedback({
  inputLoading,
  inputError,
  onRetryInputs,
  disabledReason,
}: Pick<Props, 'inputLoading' | 'inputError' | 'onRetryInputs' | 'disabledReason'>) {
  if (!inputLoading && !inputError) return null;
  return (
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
  );
}

export function FlowPanelTransactionView({
  panel: props,
  transaction,
}: {
  panel: Props;
  transaction: TransactionFlowModel;
}) {
  const {
    workspace,
    selected,
    walletUtxoObservation,
    onSelect,
    onTrace,
    disabledReason,
    inputLoading,
    onRetryInputs,
  } = props;
  const {
    spends,
    previousOutputs,
    current,
    leg,
    choose,
    quickEditor,
    setQuickEditor,
    quickEditorId,
  } = transaction;
  const currentNotOnGraph =
    !!current &&
    selected?.kind !== 'address' &&
    props.graphNodeIds !== undefined &&
    !props.graphNodeIds.includes(transactionReference(current.tx.txid));
  const navigate = (txid: string, outputId: string) => {
    choose(txid);
    props.onSetHidden?.([transactionReference(txid)], false);
    onSelect(outputId);
  };
  const missingCreating =
    selected?.kind === 'output' && !workspace.chainData.transactions[selected.txid ?? ''];
  const selectedResolution =
    selected?.kind === 'output' && selected.txid !== undefined && selected.vout !== undefined
      ? resolvePreviousOutput(
          { network: workspace.network, transactions: workspace.chainData.transactions },
          selected,
          previousOutputs,
        )
      : undefined;
  const selectedOutput =
    selectedResolution?.status === 'loaded' || selectedResolution?.status === 'attached'
      ? selectedResolution.output
      : undefined;
  const selectedUnspendable = selectedOutput !== undefined && isProvablyUnspendable(selectedOutput);
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
        ? [workspace.chainData.transactions[selected.txid ?? '']].filter(
            (tx): tx is Transaction => !!tx,
          )
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
                  {workspace.annotations.entities[transactionReference(tx.txid)]?.label || (
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
  if (!selected) return null;
  return (
    <>
      <div className="flow-panel-body">
        <div className="flow-panel-actions">
          <TransactionFlowActions
            missingInputCount={props.missingInputCount}
            onLoadAllInputs={props.onLoadAllInputs}
            disabledReason={disabledReason}
            inputLoading={inputLoading}
          />
        </div>
        {current ? (
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
                  className={`flow-panel-identity ${selected.id === transactionReference(current.tx.txid) ? 'is-selected' : ''}`}
                >
                  <button
                    type="button"
                    className="transaction-identity-select"
                    aria-label={`Select displayed transaction ${current.tx.txid}`}
                    aria-pressed={selected.id === transactionReference(current.tx.txid)}
                    title={current.tx.txid}
                    onClick={() => onSelect(transactionReference(current.tx.txid))}
                  >
                    <span className="transaction-identity-titlebar">
                      <span className="transaction-identity-icons">
                        <Box size={16} aria-hidden="true" />
                        {workspace.annotations.entities[transactionReference(current.tx.txid)]
                          ?.icon && (
                          <span
                            className="transaction-annotation-icon"
                            role="img"
                            aria-label={`Annotation icon: ${workspace.annotations.entities[transactionReference(current.tx.txid)].icon}`}
                          >
                            {
                              workspace.annotations.entities[transactionReference(current.tx.txid)]
                                .icon
                            }
                          </span>
                        )}
                        {workspace.annotations.entities[transactionReference(current.tx.txid)]
                          ?.bookmarked && <Bookmark size={14} aria-label="Bookmarked" />}
                      </span>
                      <strong className="mono transaction-identity-id">
                        <ResponsiveIdentifier value={current.tx.txid} />
                      </strong>
                      <span>
                        <CopyButton value={current.tx.txid} label="Copy displayed transaction ID" />
                      </span>
                    </span>
                    <span className="transaction-identity-body">
                      <TransactionBlockTime
                        transaction={current.tx}
                        workspace={workspace}
                        showFee={false}
                        separateStatusAndTime
                      />
                      {workspace.annotations.entities[transactionReference(current.tx.txid)]
                        ?.label && (
                        <strong
                          className="transaction-identity-label"
                          title={
                            workspace.annotations.entities[transactionReference(current.tx.txid)]
                              .label
                          }
                        >
                          {
                            workspace.annotations.entities[transactionReference(current.tx.txid)]
                              .label
                          }
                        </strong>
                      )}
                      {props.renderMetadata?.(transactionReference(current.tx.txid))}
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
                      onClick={() => props.onEdit(transactionReference(current.tx.txid), 'label')}
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
                          nodeId: transactionReference(current.tx.txid),
                          anchor: event.currentTarget,
                          point: event.detail ? { x: event.clientX, y: event.clientY } : undefined,
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
                          nodeId: transactionReference(current.tx.txid),
                          anchor: event.currentTarget,
                          point: event.detail ? { x: event.clientX, y: event.clientY } : undefined,
                        })
                      }
                    >
                      <Smile size={13} />
                    </button>                    
                  </div>
                  {(currentNotOnGraph ||
                    props.hiddenNodeIds?.includes(transactionReference(current.tx.txid))) && (
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
                            props.onSetHidden?.([transactionReference(current.tx.txid)], false)
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
            {inputLoading ? 'Loading creating transaction…' : 'Creating transaction unavailable.'}
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
              value={workspace.annotations.entities[quickEditor.nodeId]?.icon ?? ''}
              onChange={(icon) => props.onSetIcon(quickEditor.nodeId, icon)}
              onClose={() => setQuickEditor(undefined)}
            />
          </MetadataPopover>
        )}
        <div className="flow-panel-actions">
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
      <TransactionFlowFeedback
        inputLoading={inputLoading}
        inputError={props.inputError}
        onRetryInputs={onRetryInputs}
        disabledReason={disabledReason}
      />
    </>
  );
}
