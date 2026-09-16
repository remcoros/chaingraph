import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import type { FlowPanelHeight } from '../../../GraphState/panelState';

/** The height controls, owned above the views so they survive a change of view. */
export interface FlowPanelHeightState {
  open: boolean;
  fullHeight: boolean;
  onHeight: (height: FlowPanelHeight) => void;
}

interface Props extends FlowPanelHeightState {
  /** Everything inside the title bar, so a view owns its whole header layout. */
  header: ReactNode;
  /** Everything below the title bar. A view with nothing to show yet omits it. */
  children?: ReactNode;
}

/**
 * The flow panel's frame: a collapsible surface and its height controls. It
 * knows nothing about what is shown, so a new kind of panel supplies a header
 * and a body rather than adding a branch in here.
 *
 * Pass whole elements. Each is then a component boundary React can skip
 * re-rendering, which matters because the bodies are large.
 */
export function FlowPanelShell({ open, fullHeight, onHeight, header, children }: Props) {
  return (
    <div className="flow-panel-slot">
      <div className={`flow-panel-surface${fullHeight ? ' is-full-height' : ''}`}>
        <details className="flow-panel" data-tour="transaction-flow" open={open}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              onHeight(open ? 'collapsed' : 'expanded');
            }}
          >
            {header}
          </summary>
          {children}
        </details>
        <div className="flow-panel-footer">
          <button
            type="button"
            className="icon-button flow-panel-height-toggle"
            aria-label={open ? 'Collapse flow panel' : 'Expand flow panel'}
            title={open ? 'Collapse flow panel' : 'Expand flow panel'}
            aria-expanded={open}
            onClick={() => onHeight(open ? 'collapsed' : 'expanded')}
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
            className="icon-button flow-panel-height-toggle"
            aria-label={
              open && fullHeight ? 'Restore flow panel height' : 'Expand flow panel to full height'
            }
            title={
              open && fullHeight ? 'Restore flow panel height' : 'Expand flow panel to full height'
            }
            onClick={() => onHeight(open && fullHeight ? 'expanded' : 'full')}
          >
            {open && fullHeight ? (
              <ArrowUp size={14} aria-hidden="true" />
            ) : (
              <ChevronsDown size={14} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The title bar layout every view shares: what kind of entity this is, the
 * annotations carried on it, and its identifier. Views supply the kind and
 * anything that follows.
 */
