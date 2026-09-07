import { describe, expect, it } from 'vitest';
import { newWorkspace } from '../src/domain/workspace';
import { encryptWorkspace, decryptWorkspace } from '../src/lib/crypto';
import { STORAGE_KEY, WorkspaceSessionStore } from '../src/lib/useWorkspaces';

const password = 'test workspace passphrase';
function memoryStorage(initial: string | null = null) {
  let raw = initial;
  return {
    getItem: (_key: string) => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
    raw: () => raw,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('workspace persistence state transitions', () => {
  it('clears old undo snapshots after a chain refresh so undo cannot erase new transaction data', () => {
    const store = new WorkspaceSessionStore({ storage: memoryStorage() });
    const w = newWorkspace('Before label', 'mainnet');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Labeled investigation' }));
    expect(store.getSnapshot().sessions[0].history).toHaveLength(1);
    const txid = '1'.repeat(64);
    store.update(
      w.id,
      (current) => ({
        ...current,
        transactions: {
          ...current.transactions,
          [txid]: {
            txid,
            vin: [{ coinbase: '0101' }],
            vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
          },
        },
      }),
      false,
    );
    expect(store.getSnapshot().sessions[0].history).toHaveLength(0);
    store.undo(w.id);
    expect(store.getSnapshot().sessions[0].data.transactions[txid]).toBeDefined();
    expect(store.getSnapshot().sessions[0].data.name).toBe('Labeled investigation');
    store.update(w.id, (current) => ({ ...current, name: 'New edit' }));
    store.undo(w.id);
    expect(store.getSnapshot().sessions[0].data.transactions[txid]).toBeDefined();
    expect(store.getSnapshot().sessions[0].data.name).toBe('Labeled investigation');
  });

  it('saves same-turn edits before lock, blocks update and undo immediately, and unlocks the latest state', async () => {
    const storage = memoryStorage();
    const started = deferred(),
      release = deferred();
    const store = new WorkspaceSessionStore({
      storage,
      encrypt: async (data, pw) => {
        started.resolve();
        await release.promise;
        return encryptWorkspace(data, pw);
      },
    });
    const w = newWorkspace('Initial', 'mainnet');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Latest edit before lock' }));
    const locked = store.lock(w.id);
    store.update(w.id, (current) => ({ ...current, name: 'Should not be accepted' }));
    store.undo(w.id);
    await started.promise;
    expect(store.getSnapshot().sessions[0].data.name).toBe('Latest edit before lock');
    release.resolve();
    await locked;
    expect(store.getSnapshot().sessions).toHaveLength(0);
    expect(storage.raw()).not.toContain('Latest edit before lock');
    const restored = new WorkspaceSessionStore({ storage });
    expect(restored.getSnapshot().storageError).toBe('');
    const saved = restored.getSnapshot().saved[0];
    await restored.unlock(saved, password);
    expect(restored.getSnapshot().sessions[0].data.name).toBe('Latest edit before lock');
    expect(restored.getSnapshot().sessions[0].savedRevision).toBe(
      restored.getSnapshot().sessions[0].revision,
    );
  });

  it('queues locking behind an earlier snapshot and saves edits made while that snapshot was encrypting', async () => {
    const storage = memoryStorage();
    const started = deferred(),
      release = deferred();
    let count = 0;
    const store = new WorkspaceSessionStore({
      storage,
      encrypt: async (data, pw) => {
        if (++count === 1) {
          started.resolve();
          await release.promise;
        }
        return encryptWorkspace(data, pw);
      },
    });
    const w = newWorkspace('Earlier snapshot', 'mainnet');
    store.open(w, password);
    const saving = store.persist(w.id);
    await started.promise;
    store.update(w.id, (current) => ({ ...current, name: 'Arrived during encryption' }));
    const locking = store.lock(w.id);
    release.resolve();
    await Promise.all([saving, locking]);
    expect(count).toBe(2);
    expect(await decryptWorkspace(store.getSnapshot().saved[0].envelope, password)).toMatchObject({
      name: 'Arrived during encryption',
    });
    expect(store.getSnapshot().sessions).toHaveLength(0);
  });

  it('retains the unlocked state and dirty revision after quota failure, allowing retry', async () => {
    const memory = memoryStorage();
    let fail = true;
    const store = new WorkspaceSessionStore({
      storage: {
        getItem: memory.getItem,
        setItem: (key, value) => {
          if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          memory.setItem(key, value);
        },
      },
    });
    const w = newWorkspace('Unsaved data', 'mainnet');
    store.open(w, password);
    await expect(store.lock(w.id)).rejects.toThrow('Quota exceeded');
    expect(store.getSnapshot().sessions[0].savedRevision).toBe(-1);
    expect(store.getSnapshot().storageError).toContain('Export');
    store.update(w.id, (current) => ({ ...current, name: 'Still editable' }));
    fail = false;
    await store.lock(w.id);
    expect(store.getSnapshot().sessions).toHaveLength(0);
    expect(await decryptWorkspace(store.getSnapshot().saved[0].envelope, password)).toMatchObject({
      name: 'Still editable',
    });
  });

  it('preserves malformed browser storage and refuses to replace it with a filtered empty index', async () => {
    for (const raw of ['broken JSON', '{}', '[{"id":"broken","envelope":{}}]']) {
      const storage = memoryStorage(raw);
      const store = new WorkspaceSessionStore({ storage });
      const w = newWorkspace('New data', 'mainnet');
      store.open(w, password);
      await expect(store.persist(w.id)).rejects.toThrow('malformed');
      expect(storage.raw()).toBe(raw);
      expect(store.getSnapshot().sessions).toHaveLength(1);
    }
  });

  it('detects another tab changing storage during encryption without overwriting either session', async () => {
    const storage = memoryStorage();
    const started = deferred(),
      release = deferred();
    const first = new WorkspaceSessionStore({
      storage,
      encrypt: async (data, pw) => {
        started.resolve();
        await release.promise;
        return encryptWorkspace(data, pw);
      },
    });
    const second = new WorkspaceSessionStore({ storage });
    const a = newWorkspace('First tab', 'mainnet'),
      b = newWorkspace('Second tab', 'mainnet');
    first.open(a, password);
    second.open(b, password);
    const pending = first.persist(a.id);
    await started.promise;
    await second.persist(b.id);
    const otherTabData = storage.raw();
    release.resolve();
    await expect(pending).rejects.toThrow('another tab');
    expect(storage.raw()).toBe(otherTabData);
    expect(first.getSnapshot().sessions[0].data.name).toBe('First tab');
    expect(first.getSnapshot().sessions[0].savedRevision).toBe(-1);
  });

  it('serializes saves for different workspaces without losing index entries', async () => {
    const storage = memoryStorage();
    const store = new WorkspaceSessionStore({ storage });
    const a = newWorkspace('A', 'mainnet'),
      b = newWorkspace('B', 'testnet4');
    store.open(a, password);
    store.open(b, password);
    await Promise.all([store.persist(a.id), store.persist(b.id)]);
    expect(
      new Set(JSON.parse(storage.getItem(STORAGE_KEY)!).map((entry: { id: string }) => entry.id)),
    ).toEqual(new Set([a.id, b.id]));
  });

  it('does not lock a clean session if its stored backup has changed or disappeared', async () => {
    const storage = memoryStorage();
    const store = new WorkspaceSessionStore({ storage });
    const w = newWorkspace('Already saved', 'mainnet');
    store.open(w, password);
    await store.persist(w.id);
    storage.setItem(STORAGE_KEY, '[]');
    await expect(store.lock(w.id)).rejects.toThrow('another tab');
    expect(store.getSnapshot().sessions[0].data.name).toBe('Already saved');
    expect(storage.raw()).toBe('[]');
  });
});
