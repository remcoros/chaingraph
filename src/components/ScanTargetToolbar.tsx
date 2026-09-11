import { useEffect, useId, useRef } from 'react';
import { Check, Crosshair, X } from 'lucide-react';
import { short } from '../domain/types';
import './scan-target-toolbar.css';

export interface ScanTargetToolbarProps {
  ids: readonly string[];
  onRemove: (id: string) => void;
  onDone: () => void;
  onCancel: () => void;
  targetCount?: number;
  error?: string;
}

/** Temporary graph-picking controls. The caller restores focus when picking ends. */
export function ScanTargetToolbar({
  ids,
  onRemove,
  onDone,
  onCancel,
  targetCount,
  error,
}: ScanTargetToolbarProps) {
  const toolbar = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const errorId = useId();
  const displayedTargetCount = targetCount ?? ids.length;

  useEffect(() => toolbar.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [onCancel]);

  return (
    <div
      ref={toolbar}
      className="scan-target-toolbar"
      role="group"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
    >
      <div className="scan-target-toolbar-header">
        <strong id={titleId} className="scan-target-toolbar-title">
          <Crosshair size={14} aria-hidden="true" /> Pick targets
        </strong>
        {!error && (
          <span
            className="scan-target-toolbar-count"
            role="status"
            title="Only picked nodes are scan targets."
          >
            {displayedTargetCount.toLocaleString('en-US')}{' '}
            {displayedTargetCount === 1 ? 'target' : 'targets'}
          </span>
        )}
        <div className="scan-target-toolbar-actions">
          <button
            type="button"
            className="primary"
            disabled={ids.length === 0 || !!error}
            onClick={onDone}
          >
            <Check size={14} aria-hidden="true" /> Done
          </button>
          <button
            type="button"
            className="scan-target-toolbar-cancel"
            aria-label="Cancel picking targets"
            title="Cancel picking targets (Esc)"
            onClick={onCancel}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {ids.length > 0 ? (
        <ul className="scan-target-toolbar-targets" aria-label="Picked targets">
          {ids.map((id) => {
            const reference = id.replace(/^(?:tx|out):/, '');
            const label = `Remove ${id.startsWith('tx:') ? 'transaction' : 'output'} ${reference}`;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="scan-target-toolbar-target"
                  aria-label={label}
                  title={label}
                  onClick={() => onRemove(id)}
                >
                  <span>{short(id)}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="scan-target-toolbar-empty">
          Click transactions or outputs in the graph.
        </span>
      )}
      {error && (
        <span id={errorId} className="scan-target-toolbar-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
