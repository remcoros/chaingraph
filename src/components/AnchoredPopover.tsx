import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from './Dialogs';
import './anchored-popover.css';

function readViewport() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
    left: window.visualViewport?.offsetLeft ?? 0,
  };
}

/** Small anchored dialog shared by the filter and batch editors.
 * Focus moves inside, Escape and outside pointer input close it, and the
 * trigger regains focus through useDialogFocus.
 */
export function AnchoredPopover({
  id,
  anchor,
  title,
  width = 300,
  className = '',
  onClose,
  children,
}: {
  id: string;
  anchor: HTMLElement;
  title: string;
  width?: number;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useDialogFocus(onClose);
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const update = () => setViewport(readViewport());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  const rect = anchor.getBoundingClientRect();
  const shown = Math.min(width, viewport.width - 24);
  const left = Math.max(
    viewport.left + 12,
    Math.min(rect.left, viewport.left + viewport.width - shown - 12),
  );
  // A trigger low in the viewport, such as the floating selection toolbar, opens
  // upward so its actions stay reachable instead of being clipped off-screen.
  const openUp = rect.top - viewport.top > viewport.height * 0.55;
  const position = openUp
    ? {
        bottom: Math.max(12, window.innerHeight - rect.top + 6),
        maxHeight: Math.max(160, rect.top - viewport.top - 18),
      }
    : (() => {
        const top = Math.max(
          viewport.top + 12,
          Math.min(rect.bottom + 6, viewport.top + viewport.height - 220),
        );
        return { top, maxHeight: viewport.top + viewport.height - top - 12 };
      })();
  return createPortal(
    <div
      className="anchored-popover-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        id={id}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`anchored-popover ${className}`}
        style={{ left, width: shown, ...position }}
      >
        <div className="anchored-popover-heading">
          <strong>{title}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
        <div className="anchored-popover-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
