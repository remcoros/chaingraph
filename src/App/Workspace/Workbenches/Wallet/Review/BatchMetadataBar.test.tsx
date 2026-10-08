// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
