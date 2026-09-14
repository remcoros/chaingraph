import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from '../Controls/useDialogFocus';
import { MetadataPopover } from './MetadataEditors';
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
  /** Visible caption; batch controls describe their own scope. */
  caption?: string;
  ariaLabel?: string;
  compact?: boolean;
  mixed?: boolean;
  disabled?: boolean;
}
export function IconPicker({
  value,
  onChange,
  openToken,
  onOpenHandled,
  fieldLabel,
  caption,
  ariaLabel,
  compact = false,
  mixed = false,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [triggerElement, setTriggerElement] = useState<HTMLButtonElement | null>(null);
  const handleOpenHandled = useEffectEvent(() => onOpenHandled?.());
  useEffect(() => {
    if (!openToken || disabled) return;
    trigger.current?.focus();
    setOpen(true);
    handleOpenHandled();
  }, [openToken, disabled]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const id = useId();
  const label = mixed
    ? 'Mixed'
    : (icons.find(([symbol]) => symbol === value)?.[1] ?? (value ? 'Imported icon' : 'None'));
  const field = fieldLabel ?? 'Icon';
  const accessibleLabel = ariaLabel
    ? compact
      ? `${ariaLabel}: ${label}`
      : ariaLabel
    : `${fieldLabel ?? 'Node icon'}: ${label}`;
  return (
    <div className={`icon-picker${compact ? ' icon-picker-compact' : ''}`}>
      {!compact && <span className="icon-picker-label">{caption ?? field}</span>}
      <button
        ref={(element) => {
          trigger.current = element;
          setTriggerElement(element);
        }}
        type="button"
        className="icon-picker-trigger"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="icon-picker-preview" aria-hidden="true">
          {mixed ? '◐' : value || '∅'}
        </span>
        {compact && <span>{caption ?? 'Icon'}</span>}
      </button>
      {open && triggerElement && (
        <MetadataPopover anchor={triggerElement} compact onClose={() => setOpen(false)}>
          <IconPalette
            id={id}
            value={mixed ? '' : value}
            onChange={onChange}
            onClose={() => setOpen(false)}
          />
        </MetadataPopover>
      )}
    </div>
  );
}

export function IconPalette({
  id,
  value,
  onChange,
  onClose,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useDialogFocus(onClose, undefined, false);
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
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>(`[data-icon-index="${active}"]`)?.focus();
  }, [active, ref]);
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
      ref={ref}
      id={id}
      className="icon-palette"
      role="dialog"
      aria-modal="false"
      aria-label="Choose node icon"
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
        <span>{value ? options[active][1] : ''}</span>
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
  );
}
