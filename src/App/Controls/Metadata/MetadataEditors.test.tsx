// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import {
  BatchLabelEditor,
  BatchTagEditor,
  EntityLabelEditor,
  EntityTagEditor,
} from './MetadataEditors';

afterEach(cleanup);

function fixture() {
  const workspace = createWorkspace('Metadata fixture', 'mainnet');
  const id = `tx:${'a'.repeat(64)}`;
  workspace.annotations.entities[id] = {
    label: 'Existing label',
    note: '',
    icon: '',
    bookmarked: false,
  };
  return { workspace, id };
}

it('edits one existing label without a batch replacement control', () => {
  const { workspace, id } = fixture();
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <EntityLabelEditor workspace={workspace} entityId={id} onApply={onApply} onClose={onClose} />,
  );
  const input = screen.getByRole('textbox', { name: 'Batch label' }) as HTMLInputElement;
  expect(input.value).toBe('Existing label');
  expect(screen.queryByRole('checkbox', { name: 'Replace existing labels' })).toBeNull();
  fireEvent.change(input, { target: { value: 'New label' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply label' }));
  const updated = onApply.mock.calls[0][1](workspace);
  expect(updated.annotations.entities[id].label).toBe('New label');
  expect(workspace.annotations.entities[id].label).toBe('Existing label');
  expect(onApply).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it('preserves an existing label for a batch of one until replacement is selected', () => {
  const { workspace, id } = fixture();
  const onApply = vi.fn();
  render(<BatchLabelEditor workspace={workspace} ids={[id]} onApply={onApply} onClose={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: 'Batch label' }) as HTMLInputElement;
  expect(input.value).toBe('');
  expect((screen.getByRole('button', { name: 'Apply label' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Replace existing labels' }));
  fireEvent.change(input, { target: { value: 'Replacement' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply label' }));
  expect(onApply.mock.calls[0][1](workspace).annotations.entities[id].label).toBe('Replacement');
});

it('changes only unlabelled batch records in one update and keeps a failed edit open', () => {
  const { workspace, id } = fixture();
  const other = `tx:${'b'.repeat(64)}`;
  const onClose = vi.fn();
  const onApply = vi.fn(
    (_summary: string, _update: (current: typeof workspace) => typeof workspace) => false,
  );
  render(
    <BatchLabelEditor
      workspace={workspace}
      ids={[id, other]}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Batch label' }), {
    target: { value: 'New label' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply label' }));
  expect(onApply).toHaveBeenCalledOnce();
  const updated = onApply.mock.calls[0][1](workspace);
  expect(updated.annotations.entities[id].label).toBe('Existing label');
  expect(updated.annotations.entities[other].label).toBe('New label');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toBe('Could not apply this label. Try again.');
});

it('keeps single-entity tag hints and batch assignment counts distinct', () => {
  const { workspace, id } = fixture();
  workspace.annotations.tags = [{ id: 'tag', name: 'Example tag', color: '#27c4a7', nodeIds: [] }];
  const onApply = vi.fn();
  const view = render(
    <EntityTagEditor
      workspace={workspace}
      entityId={id}
      onApply={onApply}
      onClose={vi.fn()}
      membershipHint={() => <small>Related evidence</small>}
    />,
  );
  expect(screen.getByText('Related evidence')).toBeTruthy();
  expect(screen.queryByText('0 of 1 selected')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add Example tag to selected records' }));
  expect(onApply.mock.calls[0][1](workspace).annotations.tags[0].nodeIds).toEqual([id]);
  view.rerender(
    <BatchTagEditor workspace={workspace} ids={[id]} onApply={onApply} onClose={vi.fn()} />,
  );
  expect(screen.getByText('0 of 1 selected')).toBeTruthy();
});
