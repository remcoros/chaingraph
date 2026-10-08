// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IconPicker } from './IconPicker';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps standalone programmatic opening and returns focus on Escape', () => {
  const props = { value: '★', onChange: vi.fn(), onOpenHandled: vi.fn() };
  const { rerender } = render(<IconPicker {...props} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<IconPicker {...props} openToken={1} />);
  expect(screen.getByRole('dialog', { name: 'Choose node icon' })).toBeTruthy();
  expect(props.onOpenHandled).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Star' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Node icon: Star' }));
});

it('keeps imported values, arrow navigation and selection in a standalone picker', () => {
  const onChange = vi.fn();
  render(<IconPicker value="☀" onChange={onChange} />);
  const trigger = screen.getByRole('button', { name: 'Node icon: Imported icon' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  const imported = screen.getByRole('button', { name: 'Imported icon' });
  expect(imported.getAttribute('aria-pressed')).toBe('true');
  fireEvent.keyDown(imported, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Star' }));
  fireEvent.click(screen.getByRole('button', { name: 'Star' }));
  expect(onChange).toHaveBeenCalledWith('★');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('closes a standalone palette when disabled without reopening when enabled', () => {
  const props = { value: '', onChange: vi.fn() };
  const { rerender } = render(<IconPicker {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Node icon: None' }));
  rerender(<IconPicker {...props} disabled />);
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<IconPicker {...props} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
