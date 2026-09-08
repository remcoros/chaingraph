import { describe, expect, it } from 'vitest';
import { newWorkspace } from '../src/domain/workspace';
import { setNodesHidden, showAllNodes } from '../src/domain/visibility';
import { WorkspaceSessionStore } from '../src/lib/useWorkspaces';

const id = `out:${'1'.repeat(64)}:0`;
describe('visibility undo and saved view interactions', () => {
  it('retains hide and show-all undo through selection and filter autosave', () => {
    const store = new WorkspaceSessionStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    const workspace = newWorkspace('Visibility undo', 'mainnet');
    store.open(workspace, 'public fixture password');
    store.update(workspace.id, (current) => setNodesHidden(current, [id], true));
    store.update(
      workspace.id,
      (current) => ({
        ...current,
        view: {
          ...current.view,
          selectionId: id,
          entityVisibility: 'hidden',
          filters: { query: 'review' },
        },
      }),
      false,
    );
    store.undo(workspace.id);
    let current = store.getSnapshot().sessions[0].data;
    expect(current.view.hiddenNodeIds ?? []).toEqual([]);
    expect(current.view.selectionId).toBe(id);
    expect(current.view.entityVisibility).toBe('hidden');
    expect(current.view.filters).toEqual({ query: 'review' });
    store.update(workspace.id, (data) => setNodesHidden(data, [id], true));
    store.update(workspace.id, showAllNodes);
    store.update(
      workspace.id,
      (data) => ({ ...data, view: { ...data.view, entityVisibility: 'all', filters: {} } }),
      false,
    );
    store.undo(workspace.id);
    current = store.getSnapshot().sessions[0].data;
    expect(current.view.hiddenNodeIds).toEqual([id]);
    expect(current.view.entityVisibility).toBe('all');
    expect(current.view.filters).toEqual({});
  });
});
