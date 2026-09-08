import { describe, expect, it, vi } from 'vitest';
import { newWorkspace } from '../src/domain/workspace';
import { decryptWorkspace, encryptWorkspace } from '../src/lib/crypto';
import { WorkspaceSessionStore } from '../src/lib/useWorkspaces';

const password = 'public scheduling fixture password';
function fixture(encrypt?: typeof encryptWorkspace) {
  let raw: string | null = null;
  const store = new WorkspaceSessionStore({
    storage: {
      getItem: () => raw,
      setItem: (_key, value) => {
        raw = value;
      },
    },
    encrypt,
  });
  const workspace = newWorkspace('Gesture fixture', 'mainnet');
  store.open(workspace, password);
  return { store, id: workspace.id, raw: () => raw };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('encrypted save scheduling around graph interaction', () => {
  it('defers pending autosave and captures edits made during the gesture', async () => {
    const encrypt = vi.fn(encryptWorkspace);
    const { store, id, raw } = fixture(encrypt);
    store.pauseAutosave(id, true);
    const pending = store.persist(id, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(encrypt).not.toHaveBeenCalled();
    store.update(id, (w) => ({ ...w, description: 'Latest note during drag' }));
    store.pauseAutosave(id, false);
    await pending;
    await store.persist(id);
    expect(encrypt).toHaveBeenCalledTimes(1);
    expect(await decryptWorkspace(JSON.parse(raw()!)[0].envelope, password)).toMatchObject({
      description: 'Latest note during drag',
    });
  });

  it('defers an already encrypted autosave publication until idle and preserves newer edits', async () => {
    const encrypted = deferred();
    const release = deferred();
    const encrypt = vi.fn(async (data: unknown, key: string) => {
      const result = await encryptWorkspace(data, key);
      if (encrypt.mock.calls.length === 1) {
        encrypted.resolve();
        await release.promise;
      }
      return result;
    });
    const { store, id, raw } = fixture(encrypt);
    const pending = store.persist(id, true);
    await encrypted.promise;
    store.pauseAutosave(id, true);
    store.update(id, (w) => ({ ...w, description: 'Edit while prior save finishes' }));
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(raw()).toBeNull();
    store.pauseAutosave(id, false);
    await pending;
    await store.persist(id);
    const session = store.getSession(id)!;
    expect(session.savedRevision).toBe(session.revision);
    expect(await decryptWorkspace(JSON.parse(raw()!)[0].envelope, password)).toMatchObject({
      description: 'Edit while prior save finishes',
    });
  });

  it('explicit lock releases a paused save queue and stores the latest synchronous state', async () => {
    const { store, id, raw } = fixture();
    store.pauseAutosave(id, true);
    void store.persist(id, true);
    store.update(id, (w) => ({ ...w, view: { ...w.view, glow: false } }), false);
    await store.lock(id);
    expect(store.getSession(id)).toBeUndefined();
    expect(await decryptWorkspace(JSON.parse(raw()!)[0].envelope, password)).toMatchObject({
      view: { glow: false },
    });
  });

  it('exports the current session after synchronous view capture without marking it saved', async () => {
    const { store, id } = fixture();
    const old = store.getSession(id)!;
    store.pauseAutosave(id, true);
    store.update(
      id,
      (w) => ({ ...w, name: 'Latest export', view: { ...w.view, glow: false } }),
      false,
    );
    const result = await store.exportEncrypted(id);
    expect(result.name).toBe('Latest export');
    expect(old.data.view.glow).not.toBe(false);
    expect(await decryptWorkspace(result.envelope, password)).toMatchObject({
      name: 'Latest export',
      view: { glow: false },
    });
    expect(store.getSession(id)!.revision).not.toBe(store.getSession(id)!.savedRevision);
  });
});
