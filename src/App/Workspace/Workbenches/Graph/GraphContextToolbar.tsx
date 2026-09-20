import {
  ArrowLeftToLine,
  ArrowRightFromLine,
  ArrowRightToLine,
  Box,
  CircleMinus,
  Coins,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
} from 'lucide-react';
import './graph-context-toolbar.css';

export type GraphContextSide = 'inputs' | 'outputs';

export interface GraphContextSideCounts {
  total: number;
  shown: number;
  hidden: number;
  added: number;
  unconnectedShown: number;
  unconnectedAdded: number;
}

export interface GraphContextToolbarProps {
  contextLabel?: string;
  contextTitle?: string;
  selectedKind?: 'transaction' | 'output' | 'address';
  canOpenAddress?: boolean;
  onOpenAddress?: () => void;
  canShowRecentUtxos?: boolean;
  recentUtxoCount?: number;
  onShowRecentUtxos?: () => void;
  canShowRecentTransactions?: boolean;
  recentTransactionCount?: number;
  onShowRecentTransactions?: () => void;
  sides?: Record<GraphContextSide, GraphContextSideCounts>;
  onAddSide: (side: GraphContextSide) => void;
  onHideSide: (side: GraphContextSide) => void;
  onRemoveSide: (side: GraphContextSide) => void;
  canOpenCreatingTx?: boolean;
  canOpenSpendingTx?: boolean;
  onOpenCreatingTx?: () => void;
  onOpenSpendingTx?: () => void;
  hideSelectionCount: number;
  removeSelectionCount: number;
  onHideSelection: () => void;
  onRemoveSelection: () => void;
  canHideBranch: boolean;
  canRemoveBranch: boolean;
  onHideBranch: () => void;
  onRemoveBranch: () => void;
  hiddenCount?: number;
  onRestoreHidden?: () => void;
  unconnectedCount: number;
  removableOutputCount: number;
  showAllOutputCount: number;
  onHideUnconnected: () => void;
  onRemoveUnconnected: () => void;
  onShowAllOutputs: () => void;
  busy?: boolean;
}

const countLabel = (count: number) => count.toLocaleString('en-US');

export function GraphContextToolbar(props: GraphContextToolbarProps) {
  const recentUtxoCount = Math.max(0, props.recentUtxoCount ?? 0);
  const recentTransactionCount = Math.max(0, props.recentTransactionCount ?? 0);
  const hasTransactionDetails = !!props.sides && props.selectedKind !== 'output';
  const selectionActions =
    props.hideSelectionCount || props.removeSelectionCount ? (
      <div className="graph-context-action-grid graph-context-selection-actions" role="group" aria-label="Selected nodes">
        {props.hideSelectionCount > 0 && (
          <button
            className="graph-context-action"
            type="button"
            onClick={props.onHideSelection}
            aria-label={`Hide ${countLabel(props.hideSelectionCount)} selected nodes`}
            title={`Hide ${countLabel(props.hideSelectionCount)} selected nodes`}
          >
            <EyeOff size={16} aria-hidden="true" />
            <span>({countLabel(props.hideSelectionCount)})</span>
          </button>
        )}
        {props.removeSelectionCount > 0 && (
          <button
            className="graph-context-action"
            type="button"
            onClick={props.onRemoveSelection}
            aria-label={`Remove ${countLabel(props.removeSelectionCount)} selected nodes from graph; keep evidence and notes`}
            title={`Remove ${countLabel(props.removeSelectionCount)} selected nodes from graph`}
          >
            <CircleMinus size={16} aria-hidden="true" />
            <span>({countLabel(props.removeSelectionCount)})</span>
          </button>
        )}
      </div>
    ) : null;
  return (
    <div className="graph-context-toolbar" role="group" aria-label="Graph exploration">
      {hasTransactionDetails && (
        <section
          className="graph-context-section"
          aria-label="Transaction inputs and outputs"
          title={props.contextTitle ?? props.contextLabel}
        >
          <h2 className="graph-context-heading">Transaction</h2>
          <div className="graph-context-sides">
            {(['inputs', 'outputs'] as const).map((side) => {
              const counts = props.sides![side];
              const addCount = Math.max(0, counts.total - counts.shown);
              const Direction = side === 'inputs' ? ArrowRightToLine : ArrowRightFromLine;
              return (
                <div
                  className="graph-context-side"
                  key={side}
                  role="group"
                  aria-label={side === 'inputs' ? 'Inputs' : 'Outputs'}
                >
                  <h3 className="graph-context-side-heading">
                    {side === 'inputs' ? 'Inputs' : 'Outputs'}
                  </h3>
                  <button
                    className="graph-context-action graph-context-highlight"
                    type="button"
                    disabled={props.busy || addCount === 0}
                    onClick={() => props.onAddSide(side)}
                    aria-label={`Add ${countLabel(addCount)} ${side} to graph`}
                    title={`Add/show ${countLabel(addCount)} ${side}`}
                  >
                    <span className="graph-context-composite-icon" aria-hidden="true">
                      <Direction size={14} />
                      <Eye size={8} />
                    </span>
                    <span>({countLabel(addCount)})</span>
                  </button>
                  <button
                    className="graph-context-action"
                    type="button"
                    disabled={props.busy || counts.unconnectedShown === 0}
                    onClick={() => props.onHideSide(side)}
                    aria-label={`Hide ${countLabel(counts.unconnectedShown)} unconnected ${side}`}
                    title={`Hide ${countLabel(counts.unconnectedShown)} unconnected ${side}`}
                  >
                    <EyeOff size={14} aria-hidden="true" />
                    <span>({countLabel(counts.unconnectedShown)})</span>
                  </button>
                  <button
                    className="graph-context-action"
                    type="button"
                    disabled={props.busy || counts.unconnectedAdded === 0}
                    onClick={() => props.onRemoveSide(side)}
                    aria-label={`Remove ${countLabel(counts.unconnectedAdded)} unconnected ${side} from graph; keep evidence and notes`}
                    title={`Remove ${countLabel(counts.unconnectedAdded)} unconnected ${side} from graph`}
                  >
                    <CircleMinus size={14} aria-hidden="true" />
                    <span>({countLabel(counts.unconnectedAdded)})</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {props.selectedKind === 'output' && (
        <section className="graph-context-section" aria-label="Follow selected output">
          <h2 className="graph-context-heading">Output</h2>
          <div className="graph-context-action-grid">
            <button
              className="graph-context-action graph-context-highlight"
              type="button"
              disabled={props.busy || !props.canOpenCreatingTx || !props.onOpenCreatingTx}
              onClick={props.onOpenCreatingTx}
              aria-label="Open creating transaction"
              title="Open creating transaction"
            >
              <ArrowLeftToLine size={16} aria-hidden="true" />
            </button>
            <button
              className="graph-context-action graph-context-highlight"
              type="button"
              disabled={props.busy || !props.canOpenSpendingTx || !props.onOpenSpendingTx}
              onClick={props.onOpenSpendingTx}
              aria-label="Open or find spending transaction"
              title="Open or find spending transaction"
            >
              <ArrowRightFromLine size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="graph-context-action-list">
            <button
              className="graph-context-action graph-context-wide-action"
              type="button"
              aria-label="Open address on graph"
              title="Open address on graph"
              disabled={props.busy || !props.canOpenAddress || !props.onOpenAddress}
              onClick={props.onOpenAddress}
            >
              <Layers size={15} aria-hidden="true" />
              <span>Open address</span>
            </button>
          </div>
          {selectionActions}
        </section>
      )}
      {props.selectedKind === 'address' && (
        <section className="graph-context-section" aria-label="Address actions">
          <h2 className="graph-context-heading">Address</h2>
          <div className="graph-context-action-list">
            <button
              className="graph-context-action"
              type="button"
              aria-label={`Show recent UTXOs (${recentUtxoCount})`}
              title={`Show recent UTXOs (${recentUtxoCount})`}
              disabled={
                props.busy ||
                recentUtxoCount === 0 ||
                !props.canShowRecentUtxos ||
                !props.onShowRecentUtxos
              }
              onClick={props.onShowRecentUtxos}
            >
              <Coins size={15} aria-hidden="true" />
              <span>({countLabel(recentUtxoCount)})</span>
            </button>
            <button
              className="graph-context-action"
              type="button"
              aria-label={`Show recent transactions (${recentTransactionCount})`}
              title={`Show recent transactions (${recentTransactionCount})`}
              disabled={
                props.busy ||
                recentTransactionCount === 0 ||
                !props.canShowRecentTransactions ||
                !props.onShowRecentTransactions
              }
              onClick={props.onShowRecentTransactions}
            >
              <Box size={15} aria-hidden="true" />
              <span>({countLabel(recentTransactionCount)})</span>
            </button>
          </div>
          {selectionActions}
        </section>
      )}

      {props.selectedKind === 'transaction' && (
        <section
          className="graph-context-section graph-context-selection-section"
          aria-label="Transaction actions"
          title={props.contextTitle ?? props.contextLabel}
        >
          {selectionActions}
        </section>
      )}

      {hasTransactionDetails && (
        <section className="graph-context-section" aria-label="Transaction branch">
          <h2 className="graph-context-heading">
            <GitBranch size={13} aria-hidden="true" /> Transaction branch
          </h2>
          <div className="graph-context-action-list">
            <button
              className="graph-context-action"
              type="button"
              disabled={!props.canHideBranch}
              onClick={props.onHideBranch}
              aria-label="Hide transaction branch"
              title="Hide transaction and unshared inputs/outputs"
            >
              <EyeOff size={16} aria-hidden="true" />
            </button>
            <button
              className="graph-context-action"
              type="button"
              disabled={!props.canRemoveBranch}
              onClick={props.onRemoveBranch}
              aria-label="Remove transaction and unshared inputs/outputs from graph; keep evidence and notes"
              title="Remove transaction branch from graph"
            >
              <CircleMinus size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      <section className="graph-context-section" aria-label="Graph actions">
        <h2 className="graph-context-heading">Graph</h2>
        <div className="graph-context-action-list">
          <button
            className="graph-context-action graph-context-wide-action"
            type="button"
            aria-label="Show all inputs and outputs"
            title="Show all loaded inputs/outputs for transactions on the graph"
            disabled={props.busy || props.showAllOutputCount === 0}
            onClick={props.onShowAllOutputs}
          >
            <Eye size={17} aria-hidden="true" />
            <span>Show ins/outs</span>
          </button>
          {(props.hiddenCount ?? 0) > 0 && props.onRestoreHidden && (
            <button
              className="graph-context-action graph-context-wide-action"
              type="button"
              onClick={props.onRestoreHidden}
              aria-label={`Show ${countLabel(props.hiddenCount)} hidden nodes`}
              title={`Show ${countLabel(props.hiddenCount)} hidden nodes`}
            >
              <Eye size={16} aria-hidden="true" />
              <span>Show hidden ({countLabel(props.hiddenCount)})</span>
            </button>
          )}
          {props.unconnectedCount > 0 && (
            <button
              className="graph-context-action"
              type="button"
              disabled={props.busy}
              onClick={props.onHideUnconnected}
              aria-label="Hide all unconnected inputs and outputs"
              title={`Hide ${countLabel(props.unconnectedCount)} inputs/outputs with zero or one connection`}
            >
              <EyeOff size={17} aria-hidden="true" />
              <span>({countLabel(props.unconnectedCount)})</span>
            </button>
          )}
          {props.removableOutputCount > 0 && (
            <button
              className="graph-context-action"
              type="button"
              disabled={props.busy}
              onClick={props.onRemoveUnconnected}
              aria-label={`Remove ${countLabel(props.removableOutputCount)} inputs/outputs with zero or one connection from graph; keep evidence and notes`}
              title={`Remove ${countLabel(props.removableOutputCount)} inputs/outputs with zero or one connection`}
            >
              <CircleMinus size={17} aria-hidden="true" />
              <span>({countLabel(props.removableOutputCount)})</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
