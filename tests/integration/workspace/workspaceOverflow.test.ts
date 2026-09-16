import { describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createWorkspace } from '../../../src/App/Workspace/createWorkspace';
import {
  decryptWorkspace,
  encryptWorkspace,
  type EncryptedEnvelope,
} from '../../../src/App/Workspace/Persistence/Encryption/encryptedEnvelope';
import type { EnvelopeStorage } from '../../../src/App/Workspace/Persistence/Browser/indexedEnvelopeStorage';
import { createBrowserWorkspaceStore } from '../../../src/App/createWorkspaceStore';
import { INLINE_INDEX_LIMIT } from '../../../src/App/Workspace/Persistence/Browser/BrowserWorkspacePersistence';

const password = 'overflow storage password';
function memoryStorage() {
  let raw: string | null = null;
  let quota = Infinity;
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      if (value.length > quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      raw = value;
    },
    limit: (value: number) => {
      quota = value;
    },
  };
}
function encryptedMemory() {
  const records = new Map<string, EncryptedEnvelope>();
  let indexQueue = Promise.resolve();
  const storage: EnvelopeStorage = {
    commitIndex: (publish) => {
      const operation = indexQueue.catch(() => {}).then(publish);
      indexQueue = operation;
      return operation;
    },
    read: async (reference) => records.get(reference),
    write: async (entries) => {
      for (const entry of entries) records.set(entry.reference, structuredClone(entry.envelope));
    },
    remove: async (references) => {
      for (const reference of references) records.delete(reference);
    },
  };
  return { records, storage };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

describe('encrypted workspace overflow storage', () => {
  it('moves a large envelope out of the public index and reloads, edits, locks and deletes it', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    const workspace = createWorkspace('Large public name', 'mainnet');
    for (let i = 0; i < 120; i++)
      workspace.annotations[`tx:${i.toString(16).padStart(64, '0')}`] = {
        label: '',
        // Synthetic high-entropy notes keep this fixture above the storage threshold after gzip.
        note: 'private annotation ' + randomBytes(6750).toString('base64'),
        bookmarked: false,
        icon: '',
      };
    expect(JSON.stringify(workspace).length).toBeGreaterThan(INLINE_INDEX_LIMIT);
    store.open(workspace, password);
    await store.lock(workspace.id);
    const raw = local.getItem()!;
    expect(raw.length).toBeLessThan(500);
    expect(raw).toContain('Large public name');
    expect(raw).not.toContain('ciphertext');
    expect(raw).not.toContain('private annotation');
    expect(blobs.records.size).toBe(1);
    const restored = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    await restored.unlock(restored.getSnapshot().saved[0], password);
    expect(restored.getSnapshot().unlocked[0].data.annotations).toEqual(workspace.annotations);
    restored.update(workspace.id, (data) => ({
      ...data,
      description: 'A private update',
    }));
    await restored.lock(workspace.id);
    expect(blobs.records.size).toBe(1);
    expect(local.getItem()).not.toContain('A private update');
    await restored.removeSaved(workspace.id);
    expect(blobs.records.size).toBe(0);
    expect(local.getItem()).toBe('[]');
  });

  it('migrates existing inline saves only after quota pressure, keeping both workspaces readable', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    const first = createWorkspace('Existing', 'mainnet'),
      second = createWorkspace('New', 'testnet4');
    store.open(first, password);
    await store.lock(first.id);
    expect(local.getItem()).toContain('ciphertext');
    local.limit(1000);
    store.open(second, password);
    await store.lock(second.id);
    expect(blobs.records.size).toBe(2);
    const restored = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    for (const entry of restored.getSnapshot().saved) await restored.unlock(entry, password);
    expect(
      restored
        .getSnapshot()
        .unlocked.map((s) => s.data.network)
        .sort(),
    ).toEqual(['mainnet', 'testnet4']);
  });

  it('keeps the old index and unlocked edits if IndexedDB cannot commit', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: {
        ...blobs.storage,
        write: async () => {
          throw new Error('Disk full');
        },
      },
    });
    const workspace = createWorkspace('Retain me', 'mainnet');
    store.open(workspace, password);
    await store.persist(workspace.id);
    const before = local.getItem();
    local.limit(500);
    store.update(workspace.id, (data) => ({
      ...data,
      name: 'Unsaved latest edit',
    }));
    await expect(store.lock(workspace.id)).rejects.toThrow('Disk full');
    expect(local.getItem()).toBe(before);
    expect(store.getSnapshot().unlocked[0].data.name).toBe('Unsaved latest edit');
    expect(store.getSnapshot().unlocked[0].savedRevision).toBe(0);
  });

  it('rolls back new blobs when even the small public index cannot fit, then retries', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    local.limit(500);
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    const workspace = createWorkspace('Existing encrypted copy', 'mainnet');
    store.open(workspace, password);
    await store.persist(workspace.id);
    const before = local.getItem(),
      reference = JSON.parse(before!)[0].envelopeRef as string;
    local.limit(0);
    store.update(workspace.id, (data) => ({ ...data, name: 'Latest' }));
    await expect(store.lock(workspace.id)).rejects.toThrow('Quota');
    expect(local.getItem()).toBe(before);
    expect([...blobs.records.keys()]).toEqual([reference]);
    local.limit(500);
    await store.lock(workspace.id);
    expect(blobs.records.size).toBe(1);
    expect(blobs.records.has(reference)).toBe(false);
    expect(await decryptWorkspace([...blobs.records.values()][0], password)).toMatchObject({
      name: 'Latest',
    });
  });

  it('does not overwrite another tab that publishes while encrypted blobs are being written', async () => {
    // Exercise the fallback compare-and-swap used where Web Locks is unavailable.
    vi.stubGlobal('navigator', {});
    try {
      const local = memoryStorage(),
        blobs = encryptedMemory();
      local.limit(500);
      const started = deferred(),
        release = deferred();
      const first = createBrowserWorkspaceStore({
        storage: local,
        envelopes: {
          ...blobs.storage,
          write: async (entries) => {
            await blobs.storage.write(entries);
            started.resolve();
            await release.promise;
          },
        },
      });
      const second = createBrowserWorkspaceStore({
        storage: local,
        envelopes: blobs.storage,
      });
      const a = createWorkspace('First', 'mainnet'),
        b = createWorkspace('Second', 'mainnet');
      first.open(a, password);
      second.open(b, password);
      const pending = first.persist(a.id);
      await started.promise;
      await second.persist(b.id);
      const otherTab = local.getItem();
      release.resolve();
      await expect(pending).rejects.toThrow('another tab');
      expect(local.getItem()).toBe(otherTab);
      expect(blobs.records.size).toBe(1);
      expect(await decryptWorkspace([...blobs.records.values()][0], password)).toMatchObject({
        name: 'Second',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retains edits arriving during an overflow save before locking', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    local.limit(500);
    const started = deferred(),
      release = deferred();
    let first = true;
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: {
        ...blobs.storage,
        write: async (entries) => {
          if (first) {
            first = false;
            started.resolve();
            await release.promise;
          }
          await blobs.storage.write(entries);
        },
      },
    });
    const workspace = createWorkspace('Original', 'mainnet');
    store.open(workspace, password);
    const saving = store.persist(workspace.id);
    await started.promise;
    store.update(workspace.id, (data) => ({
      ...data,
      name: 'Edit during write',
    }));
    const locking = store.lock(workspace.id);
    release.resolve();
    await saving;
    await locking;
    expect(store.getSnapshot().unlocked).toHaveLength(0);
    expect(await decryptWorkspace([...blobs.records.values()][0], password)).toMatchObject({
      name: 'Edit during write',
    });
    expect(blobs.records.size).toBe(1);
  });

  it('rejects missing, tampered and mismatched referenced envelopes without losing the index', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    local.limit(500);
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    const workspace = createWorkspace('Authenticated identity', 'mainnet');
    store.open(workspace, password);
    await store.lock(workspace.id);
    const entry = store.getSnapshot().saved[0],
      reference = JSON.parse(local.getItem()!)[0].envelopeRef as string,
      original = blobs.records.get(reference)!;
    blobs.records.delete(reference);
    await expect(store.unlock(entry, password)).rejects.toThrow('missing or malformed');
    blobs.records.set(reference, {
      ...original,
      ciphertext: `${original.ciphertext[0] === 'A' ? 'B' : 'A'}${original.ciphertext.slice(1)}`,
    });
    await expect(store.unlock(entry, password)).rejects.toThrow();
    blobs.records.set(
      reference,
      await encryptWorkspace(createWorkspace('Other workspace', 'mainnet'), password),
    );
    await expect(store.unlock(entry, password)).rejects.toThrow('identity');
    expect(store.getSnapshot().saved).toEqual([entry]);
    expect(store.getSnapshot().unlocked).toHaveLength(0);
  });

  it('does not delete a referenced blob if deleting the index entry fails', async () => {
    const local = memoryStorage(),
      blobs = encryptedMemory();
    local.limit(500);
    const store = createBrowserWorkspaceStore({
      storage: local,
      envelopes: blobs.storage,
    });
    const workspace = createWorkspace('Keep backup', 'mainnet');
    store.open(workspace, password);
    await store.lock(workspace.id);
    const before = local.getItem();
    local.limit(0);
    await expect(store.removeSaved(workspace.id)).rejects.toThrow('Quota');
    expect(local.getItem()).toBe(before);
    expect(blobs.records.size).toBe(1);
    local.limit(500);
    await store.removeSaved(workspace.id);
    expect(blobs.records.size).toBe(0);
  });
  it('serializes no-Web-Locks index writes and retains the winning index’s readable blobs', async () => {
    vi.stubGlobal('navigator', {});
    try {
      const local = memoryStorage(),
        blobs = encryptedMemory();
      local.limit(1000);
      const seed = createBrowserWorkspaceStore({
        storage: local,
        envelopes: blobs.storage,
      });
      const a = createWorkspace('A original', 'mainnet'),
        b = createWorkspace('B original', 'mainnet');
      seed.open(a, password);
      seed.open(b, password);
      await seed.lock(a.id);
      await seed.lock(b.id);
      const first = createBrowserWorkspaceStore({
        storage: local,
        envelopes: blobs.storage,
      });
      const second = createBrowserWorkspaceStore({
        storage: local,
        envelopes: blobs.storage,
      });
      await first.unlock(
        first.getSnapshot().saved.find((entry) => entry.id === a.id)!,
        password,
      );
      await second.unlock(
        second.getSnapshot().saved.find((entry) => entry.id === b.id)!,
        password,
      );
      first.update(a.id, (data) => ({ ...data, name: 'A edited' }));
      second.update(b.id, (data) => ({ ...data, name: 'B edited' }));
      const results = await Promise.allSettled([first.persist(a.id), second.persist(b.id)]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const reloaded = createBrowserWorkspaceStore({
        storage: local,
        envelopes: blobs.storage,
      });
      for (const entry of reloaded.getSnapshot().saved) await reloaded.unlock(entry, password);
      expect(reloaded.getSnapshot().unlocked).toHaveLength(2);
      expect(blobs.records.size).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retains published blobs if the index mutex aborts after synchronous publication', async () => {
    vi.stubGlobal('navigator', {});
    try {
      const local = memoryStorage(),
        blobs = encryptedMemory();
      local.limit(500);
      const store = createBrowserWorkspaceStore({
        storage: local,
        envelopes: {
          ...blobs.storage,
          commitIndex: async (publish) => {
            await blobs.storage.commitIndex(publish);
            throw new Error('Transaction aborted after index publication');
          },
        },
      });
      const workspace = createWorkspace('Committed despite mutex abort', 'mainnet');
      store.open(workspace, password);
      await store.lock(workspace.id);
      expect(store.getSnapshot().unlocked).toHaveLength(0);
      expect(blobs.records.size).toBe(1);
      const reloaded = createBrowserWorkspaceStore({
        storage: local,
        envelopes: blobs.storage,
      });
      await reloaded.unlock(reloaded.getSnapshot().saved[0], password);
      expect(reloaded.getSnapshot().unlocked[0].data.name).toBe(workspace.name);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('retains an unlocked session when neither cross-tab coordination API is available', async () => {
    vi.stubGlobal('navigator', {});
    try {
      const local = memoryStorage();
      const store = createBrowserWorkspaceStore({ storage: local });
      const workspace = createWorkspace('Export remains possible', 'mainnet');
      store.open(workspace, password);
      await expect(store.lock(workspace.id)).rejects.toThrow('cannot coordinate');
      expect(store.getSnapshot().unlocked).toHaveLength(1);
      expect(local.getItem()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  for (const ordering of ['unlock-before-publication', 'unlock-after-publication'] as const) {
    it(`protects saved data when deletion races ${ordering}`, async () => {
      const local = memoryStorage(),
        blobs = encryptedMemory();
      local.limit(500);
      const workspace = createWorkspace('Preserve racing unlock', 'mainnet');
      const seed = createBrowserWorkspaceStore({ storage: local, envelopes: blobs.storage });
      seed.open(workspace, password);
      await seed.lock(workspace.id);
      const originalIndex = local.getItem(),
        reference = JSON.parse(originalIndex!)[0].envelopeRef as string;
      const decryptStarted = deferred(),
        decryptRelease = deferred();
      const coordinatorStarted = deferred(),
        coordinatorRelease = deferred();
      const store = createBrowserWorkspaceStore({
        storage: local,
        decrypt: async (envelope, key) => {
          const data = await decryptWorkspace(envelope, key);
          decryptStarted.resolve();
          await decryptRelease.promise;
          return data;
        },
        envelopes: {
          ...blobs.storage,
          commitIndex: async (publish) => {
            if (ordering === 'unlock-after-publication') publish();
            coordinatorStarted.resolve();
            await coordinatorRelease.promise;
            if (ordering === 'unlock-before-publication') publish();
          },
        },
      });
      const unlocking = store.unlock(store.getSnapshot().saved[0], password);
      await decryptStarted.promise;
      const deleting = store.removeSaved(workspace.id);
      await coordinatorStarted.promise;
      decryptRelease.resolve();
      if (ordering === 'unlock-before-publication') {
        await unlocking;
        coordinatorRelease.resolve();
        await expect(deleting).rejects.toThrow('Lock this workspace');
        expect(local.getItem()).toBe(originalIndex);
        expect(blobs.records.has(reference)).toBe(true);
        await store.lock(workspace.id);
        const restored = createBrowserWorkspaceStore({ storage: local, envelopes: blobs.storage });
        await restored.unlock(restored.getSnapshot().saved[0], password);
        expect(restored.getSnapshot().unlocked[0].data.id).toBe(workspace.id);
      } else {
        await expect(unlocking).rejects.toThrow('Saved workspace changed');
        coordinatorRelease.resolve();
        await deleting;
        expect(store.getSnapshot().unlocked).toHaveLength(0);
        expect(local.getItem()).toBe('[]');
        expect(blobs.records.has(reference)).toBe(false);
      }
    });
  }
});
