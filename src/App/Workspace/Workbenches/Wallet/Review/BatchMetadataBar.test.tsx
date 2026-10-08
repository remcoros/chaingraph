// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { BatchMetadataBar, SingleMetadataBar } from './BatchMetadataBar';

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
  const workspace = createWorkspace('Metadata bar fixture', 'mainnet');
  const id = `tx:${'a'.repeat(64)}`;
  workspace.annotations.entities[id] = {
    label: 'Existing label',
    icon: '★',
    note: '',
    bookmarked: false,
  };
  return { workspace, id, onChange: vi.fn(), onNotice: vi.fn() };
}

it('offers notes and replaces an existing icon for one entity', () => {
  const props = fixture();
  render(<SingleMetadataBar {...props} />);
  expect(screen.getByRole('button', { name: 'Notes' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: 'Replace icons' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: Star' }));
  fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
  expect(props.onChange).toHaveBeenCalledOnce();
  expect(props.onChange.mock.calls[0][0](props.workspace).annotations.entities[props.id].icon).toBe(
    '◇',
  );
});

it('keeps a batch of one distinct from a single-entity edit', () => {
  const props = fixture();
  render(
    <BatchMetadataBar
      workspace={props.workspace}
      ids={[props.id]}
      scopeLabel="records"
      onChange={props.onChange}
      onNotice={props.onNotice}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Label' }));
  expect((screen.getByRole('textbox', { name: 'Batch label' }) as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('checkbox', { name: 'Replace existing labels' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: Star' }));
  fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
  expect(props.onChange).not.toHaveBeenCalled();
  expect(props.onNotice).toHaveBeenCalledWith(
    'Every selected record already has an icon. Enable Replace to change them.',
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Replace icons' }));
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: Star' }));
  fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
  expect(props.onChange.mock.calls[0][0](props.workspace).annotations.entities[props.id].icon).toBe(
    '◇',
  );
});

it('allows only one editor through click activation without capture events', () => {
  const props = fixture();
  render(<SingleMetadataBar {...props} />);
  for (const [button, dialog] of [
    ['Label', 'Label selected records'],
    ['Set icon: Star', 'Choose node icon'],
    ['Tags', 'Tag selected records'],
    ['Set icon: Star', 'Choose node icon'],
    ['Notes', 'Edit notes'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: dialog })).toBeTruthy();
  }
});

it('returns focus to the icon trigger after Escape and after choosing an icon', () => {
  const props = fixture();
  render(<SingleMetadataBar {...props} />);
  const trigger = screen.getByRole('button', { name: 'Set icon: Star' });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: 'Diamond' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('closes the icon palette on scope, active and disabled changes without reopening', () => {
  const props = fixture();
  const { rerender } = render(<SingleMetadataBar {...props} />);
  const nextId = `tx:${'b'.repeat(64)}`;
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: Star' }));
  rerender(<SingleMetadataBar {...props} id={nextId} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: None' }));
  rerender(<SingleMetadataBar {...props} id={nextId} active={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<SingleMetadataBar {...props} id={nextId} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: None' }));
  rerender(<SingleMetadataBar {...props} id={nextId} disabled />);
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<SingleMetadataBar {...props} id={nextId} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
