// @vitest-environment jsdom
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

afterEach(cleanup);

it('closes only the topmost dialog when Escape is pressed', () => {
  const first = vi.fn();
  const second = vi.fn();
  renderHook(() => useDialogFocus(first));
  renderHook(() => useDialogFocus(second));

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

function FocusFixture({
  trapFocus = true,
  onClose = () => {},
}: {
  trapFocus?: boolean;
  onClose?: () => void;
}) {
  const focus = useDialogFocus(onClose, '[data-return-focus]', trapFocus);
  return (
    <div ref={focus}>
      <button type="button">Dialog action</button>
    </div>
  );
}

it.each(['body', 'documentElement'] as const)(
  'uses the fallback when the captured active element is %s',
  (elementName) => {
    render(<button data-return-focus>Workspace menu</button>);
    const element = document[elementName];
    const previousTabIndex = element.getAttribute('tabindex');
    element.tabIndex = -1;
    try {
      element.focus();
      expect(document.activeElement).toBe(element);
      const dialog = render(<FocusFixture />);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dialog action' }));
      dialog.unmount();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Workspace menu' }));
    } finally {
      if (previousTabIndex === null) element.removeAttribute('tabindex');
      else element.setAttribute('tabindex', previousTabIndex);
    }
  },
);

it('prefers a connected invoker over the fallback', () => {
  render(
    <>
      <button data-return-focus>Workspace menu</button>
      <button>Wallet action</button>
    </>,
  );
  const invoker = screen.getByRole('button', { name: 'Wallet action' });
  invoker.focus();
  const dialog = render(<FocusFixture />);
  dialog.unmount();
  expect(document.activeElement).toBe(invoker);
});

it('uses the fallback after the invoker is removed', () => {
  const menu = render(
    <>
      <button data-return-focus>Workspace menu</button>
      <button>Temporary menu item</button>
    </>,
  );
  const invoker = screen.getByRole('button', { name: 'Temporary menu item' });
  invoker.focus();
  const dialog = render(<FocusFixture />);
  menu.rerender(<button data-return-focus>Workspace menu</button>);
  dialog.unmount();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Workspace menu' }));
});

it('does not take focus from another control when a nonmodal editor closes', () => {
  render(
    <>
      <button data-return-focus>Workspace menu</button>
      <button>Editor invoker</button>
      <button>Another action</button>
    </>,
  );
  screen.getByRole('button', { name: 'Editor invoker' }).focus();
  const onClose = vi.fn();
  const editor = render(<FocusFixture trapFocus={false} onClose={onClose} />);
  const next = screen.getByRole('button', { name: 'Another action' });
  next.focus();
  expect(onClose).toHaveBeenCalledOnce();
  editor.unmount();
  expect(document.activeElement).toBe(next);
});
