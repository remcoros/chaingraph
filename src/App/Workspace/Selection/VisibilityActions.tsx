import { useEffect, useEffectEvent, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Layers, X } from 'lucide-react';
import type { Transaction } from '../../../Domain/types';
import { transactionNodeIds } from '../../../Domain/Graph/visibility';
import { useDialogFocus } from '../../../Shared/Controls/useDialogFocus';
import './visibility.css';

export interface VisibilityProps {
  graphNodeIds?: readonly string[];
  hiddenNodeIds?: readonly string[];
  onSetHidden?: (ids: string[], hidden: boolean) => void;
}

export function VisibilityActions({
  nodeId,
  transaction,
  graphNodeIds,
  hiddenNodeIds = [],
  onSetHidden,
  onOpenChange,
}: VisibilityProps & {
  nodeId: string;
  transaction?: Transaction;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const id = useId();
  const notOnGraph = graphNodeIds !== undefined && !graphNodeIds.includes(nodeId);
  const hidden = hiddenNodeIds.includes(nodeId);
  const offGraph = notOnGraph || hidden;
  const toggleLabel = notOnGraph
    ? 'Add entity to graph'
    : hidden
      ? 'Show entity in graph'
      : 'Hide entity from graph';
  const setMenu = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const notifyOpenChange = useEffectEvent((next: boolean) => onOpenChange?.(next));
  useEffect(() => () => notifyOpenChange(false), []);
  useEffect(() => {
    setOpen(false);
    notifyOpenChange(false);
  }, [nodeId]);
  if (!onSetHidden) return null;
  return (
    <>
      <button
        type="button"
        className="icon-button entity-visibility-toggle"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={() => onSetHidden([nodeId], !offGraph)}
      >
        {offGraph ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      {transaction && (
        <button
          ref={setAnchor}
          type="button"
          className="icon-button"
          aria-label="Input and output visibility"
          title="Show or hide transaction inputs and outputs"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setMenu(!open)}
        >
          <Layers size={15} />
        </button>
      )}
      {open &&
        transaction &&
        anchor &&
        createPortal(
          <GroupVisibility
            id={id}
            anchor={anchor}
            transaction={transaction}
            graphNodeIds={graphNodeIds}
            hiddenNodeIds={hiddenNodeIds}
            onSetHidden={onSetHidden}
            onClose={() => setMenu(false)}
          />,
          document.body,
        )}
    </>
  );
}

function GroupVisibility({
  id,
  anchor,
  transaction,
  graphNodeIds,
  hiddenNodeIds = [],
  onSetHidden,
  onClose,
}: VisibilityProps & {
  id: string;
  anchor: HTMLElement;
  transaction: Transaction;
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose);
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(286, viewport.width - 24);
  const left = Math.max(12, Math.min(rect.left, viewport.width - width - 12));
  const top = Math.max(12, Math.min(rect.bottom + 6, viewport.height - 258));
  const hidden = new Set(hiddenNodeIds);
  const admitted = graphNodeIds === undefined ? undefined : new Set(graphNodeIds);
  return (
    <div
      className="visibility-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        id={id}
        ref={ref}
        className="visibility-popover"
        role="dialog"
        aria-modal="true"
        aria-label="Transaction visibility"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        style={{ width, left, top, maxHeight: viewport.height - top - 12 }}
      >
        <div className="visibility-heading">
          <strong>Transaction visibility</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Close visibility controls"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        {(['inputs', 'outputs'] as const).map((side) => {
          const ids = transactionNodeIds(transaction, side);
          const missingIds = ids.filter((id) => admitted !== undefined && !admitted.has(id));
          const hiddenIds = ids.filter((id) => (!admitted || admitted.has(id)) && hidden.has(id));
          const offGraphIds = ids.filter(
            (id) => (admitted !== undefined && !admitted.has(id)) || hidden.has(id),
          );
          const visibleIds = ids.filter((id) => (!admitted || admitted.has(id)) && !hidden.has(id));
          return (
            <div className="visibility-group" key={side}>
              <span>
                {side === 'inputs' ? 'Inputs' : 'Outputs'}{' '}
                <small
                  title={`${visibleIds.length} shown, ${hiddenIds.length} hidden, ${missingIds.length} not on graph`}
                  aria-label={`${visibleIds.length} shown, ${hiddenIds.length} hidden, ${missingIds.length} not on graph, ${ids.length} total`}
                >
                  {visibleIds.length} shown / {ids.length}
                </small>
              </span>
              <button
                type="button"
                disabled={!visibleIds.length}
                aria-label={`Hide ${visibleIds.length} ${side} from graph`}
                onClick={() => onSetHidden?.(visibleIds, true)}
              >
                <EyeOff size={13} /> Hide {visibleIds.length}
              </button>
              <button
                type="button"
                disabled={!offGraphIds.length}
                aria-label={`Add or show ${offGraphIds.length} ${side} in graph`}
                onClick={() => onSetHidden?.(offGraphIds, false)}
              >
                <Eye size={13} /> Show {offGraphIds.length}
              </button>
            </div>
          );
        })}
        <p>Inputs refer to previous outputs wherever that outpoint appears.</p>
      </div>
    </div>
  );
}
