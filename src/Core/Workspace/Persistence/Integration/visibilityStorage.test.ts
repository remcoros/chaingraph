import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import { setNodesHidden, showAllNodes } from '../../../../App/Workspace/GraphState/visibility';
import {
  addGraphNodes,
  removeGraphNodes,
} from '../../../../App/Workspace/GraphState/graphMembership';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';

const id = `out:${'1'.repeat(64)}:0`;
describe('visibility undo and saved view interactions', () => {
  it('retains exact graph removal undo through camera and selection autosaves', () => {
    const store = createBrowserWorkspaceStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    const workspace = addGraphNodes(createWorkspace('Graph membership undo', 'mainnet'), [id]);
    store.open(workspace, 'public fixture password');
    store.update(workspace.id, (current) => removeGraphNodes(current, [id]));
    store.update(
      workspace.id,
      (current) => ({
        ...current,
        view: {
          ...current.view,
          selectionId: id,
          graphSnapshot: {
            version: 1,
            dimensions: 3,
            nodes: [{ id, x: 0, y: 0, z: 0 }],
            camera: {
              position: { x: 0, y: 0, z: 200 },
              target: { x: 0, y: 0, z: 0 },
              up: { x: 0, y: 1, z: 0 },
            },
          },
        },
      }),
      false,
    );
    expect(store.getUnlocked(workspace.id)?.data.view.graphNodeIds).toEqual([]);
    store.undo(workspace.id);
    const restored = store.getUnlocked(workspace.id)!.data;
    expect(restored.view.graphNodeIds).toEqual([id]);
    expect(restored.view.selectionId).toBe(id);
    expect(restored.view.graphSnapshot?.camera.position.z).toBe(200);
  });
  it('retains hide and show-all undo through selection and filter autosave', () => {
    const store = createBrowserWorkspaceStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    const workspace = createWorkspace('Visibility undo', 'mainnet');
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
    let current = store.getSnapshot().unlocked[0].data;
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
    current = store.getSnapshot().unlocked[0].data;
    expect(current.view.hiddenNodeIds).toEqual([id]);
    expect(current.view.entityVisibility).toBe('all');
    expect(current.view.filters).toEqual({});
  });
});
