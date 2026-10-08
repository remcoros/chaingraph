// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import { SelectionToolbar, type SelectionToolbarProps } from './SelectionToolbar';

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

function fixture(): SelectionToolbarProps {
  const ids = [`tx:${'a'.repeat(64)}`];
  return {
    workspace: createWorkspace('Selection fixture', 'mainnet'),
    selection: {
      mode: true,
      ids,
      count: ids.length,
      setMode: vi.fn(),
      has: (id) => ids.includes(id),
      toggle: vi.fn(),
      replace: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    visibleSelectedCount: 1,
    hiddenSelectedCount: 0,
    onApply: vi.fn(() => 1),
    undoToken: 0,
    onSetHidden: vi.fn(),
    onIsolate: vi.fn(),
    onUndo: vi.fn(),
  };
}

it('uses one editor for label, icon and tags without capture events', () => {
  render(<SelectionToolbar {...fixture()} />);
  for (const [button, dialog] of [
    ['Label', 'Label selected records'],
    ['Set an icon on 1 selected entities: None', 'Choose node icon'],
    ['Tags', 'Tag selected records'],
    ['Set an icon on 1 selected entities: None', 'Choose node icon'],
    ['Label', 'Label selected records'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: dialog })).toBeTruthy();
  }
});

it('closes icons on selection, workspace and active changes without reopening', () => {
  const props = fixture();
  const { rerender } = render(<SelectionToolbar {...props} />);
  const icon = () =>
    screen.getByRole('button', { name: 'Set an icon on 1 selected entities: None' });
  fireEvent.click(icon());
  const next = { ...props, selection: { ...props.selection, ids: [`tx:${'b'.repeat(64)}`] } };
  rerender(<SelectionToolbar {...next} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(icon());
  const otherWorkspace = createWorkspace('Other fixture', 'mainnet');
  rerender(<SelectionToolbar {...next} workspace={otherWorkspace} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(icon());
  rerender(<SelectionToolbar {...next} workspace={otherWorkspace} active={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<SelectionToolbar {...next} workspace={otherWorkspace} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('applies one icon edit, returns focus and keeps the owned Undo boundary', () => {
  const props = fixture();
  const onApply = vi.fn(
    (
      _summary: string,
      _update: SelectionToolbarProps['onApply'] extends (
        summary: string,
        update: infer Update,
      ) => unknown
        ? Update
        : never,
    ) => 1,
  );
  const { rerender } = render(<SelectionToolbar {...props} onApply={onApply} />);
  const trigger = screen.getByRole('button', { name: 'Set an icon on 1 selected entities: None' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Star' }));
  expect(onApply).toHaveBeenCalledOnce();
  expect(
    onApply.mock.calls[0][1](props.workspace).annotations.entities[props.selection.ids[0]].icon,
  ).toBe('★');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole('button', { name: /Undo:/ })).toBeNull();
  rerender(<SelectionToolbar {...props} onApply={onApply} undoToken={1} />);
  expect(screen.getByRole('button', { name: 'Undo: Icon set on 1 records' })).toBeTruthy();
  rerender(<SelectionToolbar {...props} onApply={onApply} undoToken={2} />);
  expect(screen.queryByRole('button', { name: /Undo:/ })).toBeNull();
});
