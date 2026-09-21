import { useEffect, useEffectEvent, useRef, useState } from 'react';

let openFocusTraps = 0;
const openDialogs: symbol[] = [];

/**
 * Whether a focus-trapping dialog is currently mounted. Callers that own global
 * keyboard shortcuts use this to stand down while a dialog has the keyboard.
 */
export function isModalOpen() {
  return openFocusTraps > 0;
}

/**
 * Focus management for modal dialogs and nonmodal quick editors.
 *
 * Returns a ref for the container element. While mounted it moves focus inside,
 * closes on Escape, and either traps Tab within the container or closes when
 * focus leaves it. On unmount it restores focus to the invoker.
 */
export function useDialogFocus(
  onClose: () => void,
  fallbackFocusSelector?: string,
  trapFocus = true,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [dialog] = useState(Symbol('dialog'));
  // Capture the invoker before children mount and React applies autoFocus.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const requestClose = useEffectEvent(() => onClose());
  useEffect(() => {
    openDialogs.push(dialog);
    return () => {
      const index = openDialogs.lastIndexOf(dialog);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, [dialog]);
  useEffect(() => {
    if (!trapFocus) return;
    openFocusTraps += 1;
    return () => {
      openFocusTraps -= 1;
    };
  }, [trapFocus]);
  useEffect(() => {
    const el = ref.current;
    if (!el?.contains(document.activeElement))
      (
        el?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
        el?.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)')
      )?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openDialogs.at(-1) !== dialog) return;
        e.preventDefault();
        requestClose();
      }
      if (e.key === 'Tab' && trapFocus) {
        const items = [
          ...el!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,textarea,a[href],[tabindex]:not([tabindex="-1"])',
          ),
        ].filter((x) => x.offsetParent !== null && x.tabIndex >= 0);
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || !el?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || !el?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const focusOutside = (event: FocusEvent) => {
      if (
        !trapFocus &&
        event.target instanceof Node &&
        !el?.contains(event.target) &&
        !previous?.contains(event.target)
      )
        requestClose();
    };
    document.addEventListener('keydown', key);
    document.addEventListener('focusin', focusOutside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('focusin', focusOutside);
      // Nonmodal quick editors allow focus to move to another app control.
      // Escape/Done still return focus when it remained inside the editor.
      if (
        !trapFocus &&
        document.activeElement !== document.body &&
        !el?.contains(document.activeElement)
      )
        return;
      const target = previous?.isConnected
        ? previous
        : fallbackFocusSelector
          ? document.querySelector<HTMLElement>(fallbackFocusSelector)
          : null;
      target?.focus({ preventScroll: true });
    };
  }, [dialog, previous, fallbackFocusSelector, trapFocus]);
  return ref;
}
