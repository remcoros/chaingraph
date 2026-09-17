import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStore } from './WorkspaceStore';
import { createWorkspace } from '../createWorkspace';

describe('captured workspace operations', () => {
  it('cannot edit, undo, save, pause or close a later reopening of the same workspace', async () => {
    const persistence = {
      initialError: '',
      list: () => [],
      assertCurrent: () => {},
      save: vi.fn(async () => []),
      load: vi.fn(),
      remove: vi.fn(),
      readFile: vi.fn(),
      exportFile: vi.fn(),
    };
    const store = new WorkspaceStore(persistence);
    const workspace = createWorkspace('Public lifetime fixture', 'mainnet');
    store.open(workspace, 'public test password');
    const previous = store.getUnlocked(workspace.id)!;
    await previous.lock();
    store.open(workspace, 'public test password');
    const current = store.getUnlocked(workspace.id)!;
    current.edit((data) => ({ ...data, name: 'Current user edit' }));
    const update = vi.fn((data) => ({ ...data, name: 'Stale edit' }));
    previous.edit(update);
    previous.undo();
    previous.redo();
    previous.pauseAutosave(true);
    await previous.persist();
    await previous.lock();
    expect(update).not.toHaveBeenCalled();
    expect(store.getUnlocked(workspace.id)).toMatchObject({
      data: { name: 'Current user edit' },
      autosavePaused: false,
      locking: false,
    });
    expect(current.fetchScope.closed).toBe(false);
    expect(persistence.save).toHaveBeenCalledOnce();
    current.undo();
    expect(store.getUnlocked(workspace.id)!.data.name).toBe(workspace.name);
  });
});
