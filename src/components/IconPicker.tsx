import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogFocus } from './Dialogs';
import './icon-picker.css';

const icons = [
  ['★', 'Star'],
  ['◇', 'Diamond'],
  ['⚑', 'Flag'],
  ['?', 'Question'],
  ['✓', 'Verified'],
  ['!', 'Attention'],
  ['◎', 'Target'],
  ['∞', 'Long term'],
  ['₿', 'Bitcoin'],
  ['👛', 'Wallet'],
  ['🏦', 'Savings'],
  ['❄️', 'Cold storage'],
  ['🔑', 'Key'],
  ['💸', 'Payment'],
  ['📥', 'Income'],
  ['📤', 'Spending'],
  ['🔄', 'Swap'],
  ['🤝', 'CoinJoin'],
  ['⚡', 'Lightning'],
  ['🛒', 'Merchant'],
  ['🎁', 'Gift'],
  ['⛏️', 'Mining'],
  ['❤️', 'Donation'],
  ['✈️', 'Travel'],
  ['💼', 'Work'],
  ['🏠', 'Home'],
  ['👥', 'Family'],
  ['🔬', 'Research'],
  ['📝', 'Note'],
  ['🔖', 'Bookmark'],
  ['👁️', 'Watch'],
  ['❔', 'Unknown'],
  ['🔒', 'Lock'],
  ['🔓', 'Unlock'],
  ['⚠️', 'Warning'],
  ['🛡️', 'Shield'],
  ['🔥', 'High priority'],
  ['⏳', 'Time'],
  ['🎯', 'Goal'],
  ['🔗', 'Link'],
  ['⑂', 'Split'],
  ['⑃', 'Merge'],
  ['🌿', 'Branch'],
  ['🌐', 'Globe'],
  ['🏷️', 'Tag'],
  ['🧩', 'Puzzle'],
  ['📁', 'Folder'],
  ['📍', 'Checkpoint'],
] as const;

interface Props {
  value: string;
  openToken?: number;
  /** Overrides the field name when the picker edits more than one record. */
  fieldLabel?: string;
  onOpenHandled?: () => void;
  onChange: (value: string) => void;
}
export function IconPicker({ value, onChange, openToken, onOpenHandled, fieldLabel }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!openToken) return;
    trigger.current?.focus();
    setOpen(true);
    onOpenHandled?.();
  }, [openToken]);
  const id = useId();
  const label =
    icons.find(([symbol]) => symbol === value)?.[1] ?? (value ? 'Imported icon' : 'None');
  const field = fieldLabel ?? 'Icon';
  return (
    <div className="icon-picker">
      <span className="icon-picker-label">{field}</span>
      <button
        ref={trigger}
        type="button"
        className="icon-picker-trigger"
        aria-label={fieldLabel ? `${fieldLabel}: ${label}` : `Node icon: ${label}`}
        title={fieldLabel ? `${fieldLabel}: ${label}` : `Node icon: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(true)}
      >
        <span className="icon-picker-preview" aria-hidden="true">
          {value || '∅'}
        </span>
      </button>
      {open &&
        createPortal(
          <IconPalette
            id={id}
            value={value}
            anchor={trigger.current!}
            onChange={onChange}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

function IconPalette({
  id,
  value,
  anchor,
  onChange,
  onClose,
}: Props & { id: string; anchor: HTMLElement; onClose: () => void }) {
  const ref = useDialogFocus(onClose);
  const options: readonly (readonly [string, string])[] =
    value && !icons.some(([symbol]) => symbol === value)
      ? [[value, 'Imported icon'], ...icons]
      : icons;
  const [active, setActive] = useState(
    Math.max(
      0,
      options.findIndex(([symbol]) => symbol === value),
    ),
  );
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(336, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 440));
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(`[data-icon-index="${active}"]`)?.focus();
  }, [active, ref]);
  useEffect(() => {
    window.addEventListener('resize', onClose);
    return () => window.removeEventListener('resize', onClose);
  }, [onClose]);
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-icon-index'))
      return;
    const next =
      event.key === 'ArrowRight'
        ? (active + 1) % options.length
        : event.key === 'ArrowLeft'
          ? (active + options.length - 1) % options.length
          : event.key === 'ArrowDown'
            ? Math.min(active + 6, options.length - 1)
            : event.key === 'ArrowUp'
              ? Math.max(active - 6, 0)
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? options.length - 1
                  : undefined;
    if (next !== undefined) {
      event.preventDefault();
      setActive(next);
    }
  }
  return (
    <div
      className="icon-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        id={id}
        className="icon-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Choose node icon"
        style={{ left, top, width, maxHeight: window.innerHeight - top - 12 }}
        onKeyDown={keydown}
      >
        <div className="icon-palette-heading">
          <strong>Choose an icon</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Close icon picker"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <p className="small muted">Choose a symbol, or clear the current icon.</p>
        <div className="icon-palette-grid" role="group" aria-label="Icon choices">
          {options.map(([symbol, label], index) => (
            <button
              key={symbol}
              type="button"
              className="icon-palette-choice"
              data-icon-index={index}
              tabIndex={index === active ? 0 : -1}
              title={label}
              aria-label={label}
              aria-pressed={value === symbol}
              onFocus={() => setActive(index)}
              onClick={() => {
                onChange(symbol);
                onClose();
              }}
            >
              <span aria-hidden="true">{symbol}</span>
            </button>
          ))}
        </div>
        <div className="icon-palette-footer">
          <span>{options[active][1]}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onChange('');
              onClose();
            }}
          >
            Clear icon
          </button>
        </div>
      </div>
    </div>
  );
}
