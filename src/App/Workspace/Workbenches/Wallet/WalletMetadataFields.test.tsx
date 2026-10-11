// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import { WalletIconEdit, WalletMetadataFields } from './WalletMetadataFields';

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

function fixture() {
  const workspace = createWorkspace('Inline metadata fixture', 'mainnet');
  const id = `tx:${'a'.repeat(64)}`;
  workspace.annotations.entities[id] = {
    label: 'Saved label',
    icon: '★',
    note: '',
    bookmarked: true,
  };
  return { workspace, id, active: true, onChange: vi.fn(), onNotice: vi.fn() };
}

it('saves a note to its exact record before the inspector is deactivated', () => {
  const props = fixture();
  const view = render(<WalletMetadataFields {...props} />);
  fireEvent.click(screen.getByRole('button', { name: / note$/i }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Entity notes' }), {
    target: { value: 'Saved before navigation' },
  });
  const updated = props.onChange.mock.calls[0][0](props.workspace);
  view.rerender(<WalletMetadataFields {...props} workspace={updated} active={false} disabled />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(updated.annotations.entities[props.id]).toEqual({
    ...props.workspace.annotations.entities[props.id],
    note: 'Saved before navigation',
  });
  expect(updated.chainData).toBe(props.workspace.chainData);
});

it('preserves a label draft through refresh and cancels it when the record changes', () => {
  const props = fixture();
  const view = render(<WalletMetadataFields {...props} />);
  fireEvent.click(screen.getByRole('button', { name: / label$/i }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Batch label' }), {
    target: { value: 'Unsaved draft' },
  });
  view.rerender(
    <WalletMetadataFields
      {...props}
      workspace={{ ...props.workspace, chainData: { ...props.workspace.chainData } }}
      disabled
    />,
  );
  expect((screen.getByRole('textbox', { name: 'Batch label' }) as HTMLInputElement).value).toBe(
    'Unsaved draft',
  );
  view.rerender(<WalletMetadataFields {...props} id={`tx:${'b'.repeat(64)}`} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
});

it('replaces only the selected record icon and returns keyboard focus to its trigger', () => {
  const props = fixture();
  render(<WalletIconEdit {...props} />);
  const trigger = screen.getByRole('button', { name: 'Set icon: Star' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
  const updated = props.onChange.mock.calls[0][0](props.workspace);
  expect(updated.annotations.entities[props.id]).toEqual({
    ...props.workspace.annotations.entities[props.id],
    icon: '◇',
  });
  expect(updated.chainData).toBe(props.workspace.chainData);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
