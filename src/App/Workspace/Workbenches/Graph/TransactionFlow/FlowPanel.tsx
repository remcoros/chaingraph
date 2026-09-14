import { useState, type ReactNode } from 'react';
import {
  ArrowRightFromLine,
  ArrowRightToLine,
  Box,
  Bookmark,
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Layers,
} from 'lucide-react';
import { Amount } from '../../../../../Shared/Display/Amount';
import { ResponsiveIdentifier } from '../../../../../Shared/Display/ResponsiveIdentifier';
import { transactionStatus } from '../../../../../Domain/Chain/transactionStatus';
import {
  addressBalanceSats,
  type AddressHistory,
} from '../../../../../Domain/Chain/addressHistory';
import type {
  AddressBalanceObservation,
  AddressUtxoObservation,
  GraphNode,
  TransactionFlowState,
  Workspace,
} from '../../../../../Domain/types';
import type { WalletUtxoObservation } from '../../../../../Domain/Wallet/walletUtxoObservation';
import type { VisibilityProps } from '../../../Selection/VisibilityActions';
import type { EntitySelection } from '../../../Selection/useEntitySelection';
import { FlowPanelAddressView } from './FlowPanelAddressView';
import { FlowPanelTransactionView, useFlowPanelTransaction } from './FlowPanelTransactionView';
import './transaction-view.css';

export interface FlowPanelProps extends VisibilityProps {
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

export function FlowPanel(props: FlowPanelProps) {
  const {
    workspace,
    selected,
    state,
    onStateChange,
    disabledReason,
    inputLoading,
    inputError,
    onRetryInputs,
  } = props;
  const transaction = useFlowPanelTransaction(props);
  const { current, leg } = transaction;
  const [fullHeight, setFullHeight] = useState(false);
  const [localOpen, setLocalOpen] = useState(true);
  const open = state?.open ?? localOpen;
  const setPanelHeight = (height: 'collapsed' | 'expanded' | 'full') => {
    const nextOpen = height !== 'collapsed';
    setFullHeight(height === 'full');
    setLocalOpen(nextOpen);
    if (nextOpen !== open) onStateChange?.({ ...state, open: nextOpen });
  };
  const hasFlowSelection = !!selected;
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
              {selected.kind === 'address' && (
                <FlowPanelAddressView key={selected.address} panel={props} />
              )}
              <FlowPanelTransactionView panel={props} transaction={transaction} />
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
