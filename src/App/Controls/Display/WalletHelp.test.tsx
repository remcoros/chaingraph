// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from '../useDialogFocus';
import { WalletHelp } from './WalletHelp';

afterEach(cleanup);

function HelpDialog({ onClose }: { onClose: () => void }) {
  const focus = useDialogFocus(onClose);
  return (
    <div ref={focus} role="dialog" aria-label="Transfer options">
      <button type="button" onClick={onClose}>
        Cancel
      </button>
      <WalletHelp title="Transaction text help">Use the transaction's Notes or label.</WalletHelp>
    </div>
  );
}

function ModalFixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open options
      </button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}

it('dismisses keyboard-opened help before the real dialog Escape handler', () => {
  render(<ModalFixture />);
  const invoker = screen.getByRole('button', { name: 'Open options' });
  invoker.focus();
  fireEvent.click(invoker);
  const help = screen.getByRole('img', { name: 'Transaction text help' });
  act(() => help.focus());
  expect(screen.getByRole('tooltip')).toBeTruthy();

  fireEvent.keyDown(help, { key: 'Escape' });

  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(document.activeElement).toBe(help);

  fireEvent.keyDown(help, { key: 'Escape' });

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(invoker);
});

it.each([
  ['mouse', 'pointerover'],
  ['touch', 'pointerdown'],
])('dismisses %s-opened help without closing the dialog', (pointerType, eventType) => {
  const close = vi.fn();
  render(<HelpDialog onClose={close} />);
  const help = screen.getByRole('img', { name: 'Transaction text help' });
  const event = new Event(eventType, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(help, event);
  expect(screen.getByRole('tooltip')).toBeTruthy();

  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(document.activeElement).toBe(help);
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(help, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

it('consumes one Escape outside dialogs and lets the next Escape reach other controls', () => {
  const escape = vi.fn();
  document.addEventListener('keydown', escape);
  try {
    render(<WalletHelp title="Standalone help">Read this hint.</WalletHelp>);
    const help = screen.getByRole('img', { name: 'Standalone help' });
    act(() => help.focus());
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(escape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(help);
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(escape).toHaveBeenCalledOnce();
  } finally {
    document.removeEventListener('keydown', escape);
  }
});
