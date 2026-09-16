import { type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '../Controls/useDialogFocus';

export function Modal({
  title,
  children,
  onClose,
  className,
  fallbackFocusSelector,
}: {
  fallbackFocusSelector?: string;
  className?: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose, fallbackFocusSelector);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
