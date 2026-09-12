import {
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightFromLine,
  ArrowRightToLine,
  Eye,
  EyeOff,
  Layers,
  Network,
  Plus,
  X,
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
  selectedCount: number;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  canOpenAddressHistory?: boolean;
  onOpenAddressHistory?: () => void;
  sides?: Record<GraphContextSide, GraphContextSideCounts>;
  onAddSide: (side: GraphContextSide) => void;
  onHideSide: (side: GraphContextSide) => void;
  onRemoveSide: (side: GraphContextSide) => void;
  canOpenCreatingTx?: boolean;
  canOpenSpendingTx?: boolean;
  onOpenCreatingTx?: () => void;
  onOpenSpendingTx?: () => void;
  canShowSelection: boolean;
  canHideSelection: boolean;
  canRemoveSelection: boolean;
  onShowSelection: () => void;
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
  const selected = `${countLabel(props.selectedCount)} selected ${props.selectedCount === 1 ? 'node' : 'nodes'}`;
  return (
    <div className="graph-context-toolbar" role="group" aria-label="Graph exploration">
      <div className="graph-context-navigation" role="group" aria-label="Graph navigation">
        <button
          type="button"
          aria-label="Previous graph selection"
          title="Previous graph selection"
          disabled={!props.canBack}
          onClick={props.onBack}
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next graph selection"
          title="Next graph selection"
          disabled={!props.canForward}
          onClick={props.onForward}
        >
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Show all inputs and outputs"
          title="Show all loaded inputs/outputs for transactions on the graph"
          disabled={props.busy || props.showAllOutputCount === 0}
          onClick={props.onShowAllOutputs}
        >
          <Eye size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Open address history for selected input or output"
          title="Open address history for selected input or output"
          disabled={props.busy || !props.canOpenAddressHistory || !props.onOpenAddressHistory}
          onClick={props.onOpenAddressHistory}
        >
          <Layers size={17} aria-hidden="true" />
        </button>
      </div>

      {props.selectedKind === 'output' && (
        <div
          className="graph-context-transactions"
          role="group"
          aria-label="Follow selected output"
        >
          <button
            type="button"
            disabled={props.busy || !props.canOpenCreatingTx || !props.onOpenCreatingTx}
            onClick={props.onOpenCreatingTx}
            aria-label="Open creating transaction"
            title="Open creating transaction"
          >
            <ArrowLeftToLine size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={props.busy || !props.canOpenSpendingTx || !props.onOpenSpendingTx}
            onClick={props.onOpenSpendingTx}
            aria-label="Open or find spending transaction"
            title="Open spending transaction"
          >
            <ArrowRightFromLine size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {props.sides && (
        <div
          className="graph-context-section graph-context-sides"
          role="group"
          aria-label="Transaction inputs and outputs"
          title={props.contextTitle ?? props.contextLabel}
        >
          {(['inputs', 'outputs'] as const).map((side) => {
            const counts = props.sides![side];
            const Direction = side === 'inputs' ? ArrowRightToLine : ArrowRightFromLine;
            const addCount = Math.max(0, counts.total - counts.shown);
            return (
              <div
                className="graph-context-side"
                key={side}
                role="group"
                aria-label={side === 'inputs' ? 'Inputs' : 'Outputs'}
              >
                <button
                  type="button"
                  disabled={props.busy || addCount === 0}
                  onClick={() => props.onAddSide(side)}
                  aria-label={`Add ${countLabel(addCount)} ${side} to graph`}
                  title={`Add/show ${countLabel(addCount)} ${side}`}
                >
                  <Direction size={17} aria-hidden="true" />
                  <Plus className="graph-context-action-badge" size={10} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={props.busy || counts.unconnectedShown === 0}
                  onClick={() => props.onHideSide(side)}
                  aria-label={`Hide ${countLabel(counts.unconnectedShown)} unconnected ${side}`}
                  title={`Hide ${countLabel(counts.unconnectedShown)} unconnected ${side}`}
                >
                  <Direction size={17} aria-hidden="true" />
                  <EyeOff className="graph-context-action-badge" size={10} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={props.busy || counts.unconnectedAdded === 0}
                  onClick={() => props.onRemoveSide(side)}
                  aria-label={`Remove ${countLabel(counts.unconnectedAdded)} unconnected ${side} from graph; keep evidence and notes`}
                  title={`Remove ${countLabel(counts.unconnectedAdded)} unconnected ${side} from graph`}
                >
                  <Direction size={17} aria-hidden="true" />
                  <X className="graph-context-action-badge" size={10} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {props.selectedCount > 0 && (
        <div
          className="graph-context-section graph-context-actions"
          role="group"
          aria-label="Selected nodes"
        >
          {props.canShowSelection && (
            <button
              className="graph-context-wide"
              type="button"
              onClick={props.onShowSelection}
              aria-label={`Show ${selected}`}
              title={`Show ${selected}`}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            disabled={!props.canHideSelection}
            onClick={props.onHideSelection}
            aria-label={`Hide ${selected}`}
            title={`Hide ${selected}`}
          >
            <EyeOff size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!props.canRemoveSelection}
            onClick={props.onRemoveSelection}
            aria-label={`Remove ${selected} from graph; keep evidence and notes`}
            title={`Remove ${selected} from graph`}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {props.sides && (
        <div
          className="graph-context-section graph-context-actions"
          role="group"
          aria-label="Transaction branch"
        >
          <button
            type="button"
            disabled={!props.canHideBranch}
            onClick={props.onHideBranch}
            aria-label="Hide transaction branch"
            title="Hide transaction and unshared inputs/outputs"
          >
            <Network size={17} aria-hidden="true" />
            <EyeOff className="graph-context-action-badge" size={10} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!props.canRemoveBranch}
            onClick={props.onRemoveBranch}
            aria-label="Remove transaction and unshared inputs/outputs from graph; keep evidence and notes"
            title="Remove transaction branch from graph"
          >
            <Network size={17} aria-hidden="true" />
            <X className="graph-context-action-badge" size={10} aria-hidden="true" />
          </button>
        </div>
      )}

      {(props.hiddenCount ?? 0) > 0 && props.onRestoreHidden && (
        <div className="graph-context-section">
          <button
            className="graph-context-restore"
            type="button"
            onClick={props.onRestoreHidden}
            aria-label={`Show ${countLabel(props.hiddenCount!)} hidden nodes`}
            title={`Show ${countLabel(props.hiddenCount!)} hidden nodes`}
          >
            <Eye size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <div
        className="graph-context-section graph-context-actions"
        role="group"
        aria-label="All graph inputs and outputs"
      >
        <button
          type="button"
          disabled={props.busy || props.unconnectedCount === 0}
          onClick={props.onHideUnconnected}
          aria-label="Hide all unconnected inputs and outputs"
          title={`Hide ${countLabel(props.unconnectedCount)} inputs/outputs with zero or one connection`}
        >
          <EyeOff size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={props.busy || props.removableOutputCount === 0}
          onClick={props.onRemoveUnconnected}
          aria-label={`Remove ${countLabel(props.removableOutputCount)} inputs/outputs with zero or one connection from graph; keep evidence and notes`}
          title={`Remove ${countLabel(props.removableOutputCount)} inputs/outputs with zero or one connection`}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
