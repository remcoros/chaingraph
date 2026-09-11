import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';

/** Informational tooltip: hover or focus on desktop, tap on touch. Never traps focus. */
export function WalletHelp({
  title,
  active = true,
  icon,
  children,
}: {
  title: string;
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const trigger = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const closeSoon = () => {
    cancelClose();
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => {
    if (!active) setOpen(false);
    return cancelClose;
  }, [active]);
  useLayoutEffect(() => {
    if (!open || !active) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = tooltip.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      setPosition({
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12)),
        top:
          anchor.bottom + box.height + 18 <= window.innerHeight
            ? anchor.bottom + 6
            : Math.max(12, anchor.top - box.height - 6),
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !tooltip.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, active]);
  return (
    <>
      <span
        ref={trigger}
        className="wallet-help"
        tabIndex={0}
        role="img"
        aria-label={title}
        aria-describedby={open && active ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            cancelClose();
            setOpen(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') closeSoon();
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse') {
            cancelClose();
            setOpen((value) => !value);
          }
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={closeSoon}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        {icon ?? <CircleHelp size={14} aria-hidden="true" />}
      </span>
      {open &&
        active &&
        createPortal(
          <div
            id={id}
            ref={tooltip}
            role="tooltip"
            className="wallet-tooltip"
            style={position}
            onPointerEnter={cancelClose}
            onPointerLeave={closeSoon}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
