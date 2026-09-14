import { useEffect, useId, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { ACCENT_THEMES, applyAccentTheme, readAccentTheme, type AccentTheme } from '../accentTheme';

const ACCENT_THEME_LABELS: Record<AccentTheme, string> = {
  orange: 'Bitcoin orange',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

export interface HelpAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

export function HelpMenu({ actions }: { actions: HelpAction[] }) {
  const [open, setOpen] = useState(false);
  const [accentTheme, setAccentTheme] = useState(readAccentTheme);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const openAtEnd = useRef(false);
  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    items?.[openAtEnd.current ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="help-menu"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        aria-label="Help and samples"
        title="Help and samples"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          openAtEnd.current = false;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openAtEnd.current = event.key === 'ArrowUp';
            setOpen(true);
          }
        }}
      >
        <CircleHelp size={18} />
      </button>
      {open && (
        <div
          id={id}
          ref={menu}
          role="menu"
          aria-label="Help and samples"
          className="dropdown help-menu-items"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            }
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'ArrowDown'
                ? (index + 1) % items.length
                : event.key === 'ArrowUp'
                  ? (index - 1 + items.length) % items.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : undefined;
            if (next !== undefined) {
              event.preventDefault();
              items[next]?.focus();
            }
          }}
        >
          <div className="help-theme-picker" role="group" aria-label="Accent theme">
            {ACCENT_THEMES.map((theme) => (
              <button
                key={theme}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                className={`help-theme-choice help-theme-${theme}`}
                aria-label={ACCENT_THEME_LABELS[theme]}
                aria-checked={accentTheme === theme}
                title={ACCENT_THEME_LABELS[theme]}
                onClick={() => {
                  setAccentTheme(theme);
                  applyAccentTheme(theme);
                }}
              />
            ))}
          </div>
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              tabIndex={-1}
              disabled={action.disabled}
              onClick={() => {
                close(true);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
