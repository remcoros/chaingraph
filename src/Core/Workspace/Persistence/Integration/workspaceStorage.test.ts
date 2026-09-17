import { describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../../Persistence';
import { encryptWorkspace, decryptWorkspace } from '../Codec/encryptedEnvelope';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';
import { STORAGE_KEY } from '../Browser/workspaceStorage';

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
  it('starts a fresh undo group after locking and immediately reopening the same workspace', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
      const w = createWorkspace('Original', 'testnet4');
      store.open(w, password);
      store.update(w.id, (current) => ({ ...current, name: 'Before lock' }), true, 'name');
      await store.lock(w.id);
      await store.unlock(store.getSnapshot().saved[0], password);
      store.update(w.id, (current) => ({ ...current, name: 'After unlock' }), true, 'name');
      expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
      store.undo(w.id);
      expect(store.getSnapshot().unlocked[0].data.name).toBe('Before lock');
    } finally {
      clock.mockRestore();
    }
  });

  it('reports a locking workspace as accepting no edits, undo or redo', async () => {
    const envelopes = deferred();
    const store = createBrowserWorkspaceStore({
      storage: memoryStorage(),
      envelopes: {
        read: async () => undefined,
        commitIndex: async (publish: () => void) => publish(),
        write: async () => {
          await envelopes.promise;
        },
        remove: async () => {},
      },
    });
    const w = createWorkspace('Locking', 'testnet4');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Edited' }), true, 'name');
    const locking = store.lock(w.id);
    const entry = store.getSnapshot().unlocked.find((item) => item.data.id === w.id)!;
    expect(entry.locking).toBe(true);
    // Undo history still exists, but the workspace must not offer it while locking.
    expect(entry.history).toHaveLength(1);
    store.undo(w.id);
    expect(store.getSnapshot().unlocked.find((item) => item.data.id === w.id)?.data.name).toBe(
      'Edited',
    );
    envelopes.resolve();
    await locking;
  });

  it('groups continuous typing without losing the latest view or merging across undo', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const w = createWorkspace('Typing', 'testnet4');
    store.open(w, password);
    const edit = (label: string) =>
      store.update(
        w.id,
        (current) => ({
          ...current,
          annotations: {
            ...current.annotations,
            entities: {
              ...current.annotations.entities,
              example: { label, note: '', icon: '', bookmarked: false },
            },
          },
        }),
        true,
        'example:label',
      );
    edit('a');
    edit('ab');
    store.update(
      w.id,
      (current) => ({ ...current, view: { ...current.view, glow: false } }),
      false,
    );
    edit('abc');
    expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.annotations.entities.example).toBeUndefined();
    expect(store.getSnapshot().unlocked[0].data.view.glow).toBe(false);
    edit('next');
    expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.annotations.entities.example).toBeUndefined();
  });

  it('separates different annotation fields and intervening user actions in undo', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const w = createWorkspace('Fields', 'testnet4');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'First' }), true, 'name');
    store.update(w.id, (current) => ({ ...current, description: 'Note' }), true, 'description');
    store.update(w.id, (current) => ({ ...current, name: 'Second' }), true, 'name');
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data).toMatchObject({
      name: 'First',
      description: 'Note',
    });
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.description).toBeUndefined();
  });

  it('stores the workspace name publicly while keeping its optional description encrypted', async () => {
    const storage = memoryStorage();
    const store = createBrowserWorkspaceStore({ storage });
    const w = {
      ...createWorkspace('Public project name', 'mainnet'),
      description: 'Private wallet provenance and research notes.',
    };
    store.open(w, password);
    await store.persist(w.id);
    const [entry] = JSON.parse(storage.raw()!);
    expect(store.getSnapshot().saved[0]).toEqual({
      id: w.id,
      publicName: w.name,
      savedAt: expect.any(String),
    });
    expect(entry.publicName).toBe(w.name);
    expect(storage.raw()).toContain(w.name);
    expect(storage.raw()).not.toContain(w.description);
    expect(await decryptWorkspace(entry.envelope, password)).toMatchObject({
      name: w.name,
      description: w.description,
    });
    const reloaded = createBrowserWorkspaceStore({ storage });
    await reloaded.unlock(reloaded.getSnapshot().saved[0], password);
    expect(reloaded.getSnapshot().unlocked[0].data.description).toBe(w.description);
  });

  it('loads legacy saved records and migrates their public name only after unlocking and saving', async () => {
    const w = createWorkspace('Legacy project', 'mainnet');
    const envelope = await encryptWorkspace(w, password);
    const storage = memoryStorage(
      JSON.stringify([{ id: w.id, savedAt: new Date().toISOString(), envelope }]),
    );
    const store = createBrowserWorkspaceStore({ storage });
    expect(store.getSnapshot().storageError).toBe('');
    expect(store.getSnapshot().saved[0].publicName).toBeUndefined();
    await store.unlock(store.getSnapshot().saved[0], password);
    expect(store.getSnapshot().unlocked[0].savedRevision).toBe(-1);
    expect(JSON.parse(storage.raw()!)[0].publicName).toBeUndefined();
    await store.persist(w.id);
    expect(JSON.parse(storage.raw()!)[0].publicName).toBe('Legacy project');
  });

  it('rejects malformed public names without discarding the original saved storage', async () => {
    const w = createWorkspace('Valid name', 'mainnet');
    const envelope = await encryptWorkspace(w, password);
    for (const publicName of [null, 123, {}, '', '   ', 'x'.repeat(101)]) {
      const original = JSON.stringify([
        { id: w.id, publicName, savedAt: new Date().toISOString(), envelope },
      ]);
      const storage = memoryStorage(original);
      const store = createBrowserWorkspaceStore({ storage });
      expect(store.getSnapshot().storageError).toContain('malformed');
      store.open(w, password);
      await expect(store.persist(w.id)).rejects.toThrow('malformed');
      expect(storage.raw()).toBe(original);
    }
  });

  it('validates optional description size without requiring it in legacy workspaces', () => {
    const w = createWorkspace('Description limits', 'testnet4');
    expect(parseWorkspace(w).description).toBeUndefined();
    expect(parseWorkspace({ ...w, description: 'x'.repeat(10000) }).description).toHaveLength(
      10000,
    );
    expect(() => parseWorkspace({ ...w, description: 'x'.repeat(10001) })).toThrow();
    expect(() => parseWorkspace({ ...w, description: 42 })).toThrow();
  });

  it('preserves user undo snapshots and newly accepted transaction data after refresh', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const w = createWorkspace('Before label', 'mainnet');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Labeled investigation' }));
    expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
    const txid = '1'.repeat(64);
    store.update(
      w.id,
      (current) => ({
        ...current,
        chainData: {
          ...current.chainData,
          transactions: {
            ...current.chainData.transactions,
            [txid]: {
              txid,
              vin: [{ coinbase: '0101' }],
              vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
            },
          },
        },
      }),
      false,
    );
    expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.chainData.transactions[txid]).toBeDefined();
    expect(store.getSnapshot().unlocked[0].data.name).toBe('Before label');
    store.update(w.id, (current) => ({ ...current, name: 'New edit' }));
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.chainData.transactions[txid]).toBeDefined();
    expect(store.getSnapshot().unlocked[0].data.name).toBe('Before label');
  });

  it('ignores no-op updates without touching revision or undo history', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const w = createWorkspace('No-op refresh', 'mainnet');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Labeled investigation' }));
    const before = store.getSnapshot().unlocked[0];
    expect(before.history).toHaveLength(1);
    // A scan result for a wallet that no longer exists merges nothing at all.
    store.update(w.id, (current) => current, false);
    const unchanged = store.getSnapshot().unlocked[0];
    expect(unchanged.revision).toBe(before.revision);
    expect(unchanged.history).toHaveLength(1);
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.name).toBe('No-op refresh');
  });

  it('keeps the latest scan metadata through quiet checks while undo restores user edits', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const wallet = {
      id: crypto.randomUUID(),
      name: 'Watch only',
      key: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      scriptType: 'p2wpkh' as const,
      color: '#aabbcc',
      addresses: [],
    };
    const w = {
      ...createWorkspace('Quiet refresh', 'mainnet'),
      wallets: { ...createWorkspace('Quiet refresh', 'mainnet').wallets, definitions: [wallet] },
    };
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'First edit' }));
    store.update(w.id, (current) => ({ ...current, description: 'Second edit' }));
    // A quiet check advances only scan-owned metadata; it must not invalidate
    // undo history, and undo must never roll that metadata back.
    const scannedAt = new Date().toISOString();
    const lastActivity = {
      newTransactionIds: [] as string[],
      refreshedTransactionCount: 0,
      missingTransactionCount: 2,
    };
    store.update(
      w.id,
      (current) => ({
        ...current,
        wallets: {
          ...current.wallets,
          definitions: current.wallets.definitions.map((item) => ({
            ...item,
            scannedAt,
            scanComplete: true,
            scanLimit: 200,
            scanGap: 20,
            pendingTransactionIds: ['b'.repeat(64)],
            lastActivity,
          })),
        },
      }),
      false,
    );
    const quiet = store.getSnapshot().unlocked[0];
    expect(quiet.history).toHaveLength(2);
    store.undo(w.id);
    store.undo(w.id);
    const restored = store.getSnapshot().unlocked[0];
    expect(restored.data.name).toBe('Quiet refresh');
    expect(restored.data.description).toBeUndefined();
    expect(restored.data.wallets.definitions[0]).toMatchObject({
      name: 'Watch only',
      scannedAt,
      scanComplete: true,
      scanLimit: 200,
      scanGap: 20,
      pendingTransactionIds: ['b'.repeat(64)],
      lastActivity,
    });
  });

  it('does not unacknowledge reviewed activity when undoing an earlier user edit', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const wallet = {
      id: crypto.randomUUID(),
      name: 'Watch only',
      key: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      scriptType: 'p2wpkh' as const,
      color: '#aabbcc',
      addresses: [],
      unreviewedTransactionIds: ['c'.repeat(64)],
    };
    const w = {
      ...createWorkspace('Review activity', 'mainnet'),
      wallets: { ...createWorkspace('Review activity', 'mainnet').wallets, definitions: [wallet] },
    };
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Renamed investigation' }));
    // Reviewing new activity is a non-undoable acknowledgment.
    store.update(
      w.id,
      (current) => ({
        ...current,
        wallets: {
          ...current.wallets,
          definitions: current.wallets.definitions.map((item) => ({
            ...item,
            unreviewedTransactionIds: [],
            activityOverflow: false,
          })),
        },
      }),
      false,
    );
    expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
    store.undo(w.id);
    const restored = store.getSnapshot().unlocked[0];
    expect(restored.data.name).toBe('Review activity');
    expect(restored.data.wallets.definitions[0].unreviewedTransactionIds).toEqual([]);
  });

  it('retains undo history when a wallet refresh changes chain data', () => {
    const store = createBrowserWorkspaceStore({ storage: memoryStorage() });
    const wallet = {
      id: crypto.randomUUID(),
      name: 'Watch only',
      key: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      scriptType: 'p2wpkh' as const,
      color: '#aabbcc',
      addresses: [],
    };
    const w = {
      ...createWorkspace('Evidence refresh', 'mainnet'),
      wallets: { ...createWorkspace('Evidence refresh', 'mainnet').wallets, definitions: [wallet] },
    };
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Edited before refresh' }));
    const txid = '5'.repeat(64);
    store.update(
      w.id,
      (current) => ({
        ...current,
        chainData: {
          ...current.chainData,
          transactions: {
            ...current.chainData.transactions,
            [txid]: {
              txid,
              vin: [{ coinbase: '0101' }],
              vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
            },
          },
        },
      }),
      false,
    );
    expect(store.getSnapshot().unlocked[0].history).toHaveLength(1);
    store.undo(w.id);
    expect(store.getSnapshot().unlocked[0].data.name).toBe('Evidence refresh');
    expect(store.getSnapshot().unlocked[0].data.chainData.transactions[txid]).toBeDefined();
  });

  it('saves same-turn edits before lock, blocks update and undo immediately, and unlocks the latest state', async () => {
    const storage = memoryStorage();
    const started = deferred(),
      release = deferred();
    const store = createBrowserWorkspaceStore({
      storage,
      encrypt: async (data, pw) => {
        started.resolve();
        await release.promise;
        return encryptWorkspace(data, pw);
      },
    });
    const w = createWorkspace('Initial', 'mainnet');
    store.open(w, password);
    store.update(w.id, (current) => ({ ...current, name: 'Latest edit before lock' }));
    const locked = store.lock(w.id);
    store.update(w.id, (current) => ({ ...current, name: 'Should not be accepted' }));
    store.undo(w.id);
    await started.promise;
    expect(store.getSnapshot().unlocked[0].data.name).toBe('Latest edit before lock');
    release.resolve();
    await locked;
    expect(store.getSnapshot().unlocked).toHaveLength(0);
    expect(JSON.parse(storage.raw()!)[0].publicName).toBe('Latest edit before lock');
    const restored = createBrowserWorkspaceStore({ storage });
    expect(restored.getSnapshot().storageError).toBe('');
    const saved = restored.getSnapshot().saved[0];
    await restored.unlock(saved, password);
    expect(restored.getSnapshot().unlocked[0].data.name).toBe('Latest edit before lock');
    expect(restored.getSnapshot().unlocked[0].savedRevision).toBe(
      restored.getSnapshot().unlocked[0].revision,
    );
  });

  it('queues locking behind an earlier snapshot and saves edits made while that snapshot was encrypting', async () => {
    const storage = memoryStorage();
    const started = deferred(),
      release = deferred();
    let count = 0;
    const store = createBrowserWorkspaceStore({
      storage,
      encrypt: async (data, pw) => {
        if (++count === 1) {
          started.resolve();
          await release.promise;
        }
        return encryptWorkspace(data, pw);
      },
    });
    const w = createWorkspace('Earlier snapshot', 'mainnet');
    store.open(w, password);
    const saving = store.persist(w.id);
    await started.promise;
    store.update(w.id, (current) => ({ ...current, name: 'Arrived during encryption' }));
    const locking = store.lock(w.id);
    release.resolve();
    await Promise.all([saving, locking]);
    expect(count).toBe(2);
    expect(await decryptWorkspace(JSON.parse(storage.raw()!)[0].envelope, password)).toMatchObject({
      name: 'Arrived during encryption',
    });
    expect(store.getSnapshot().unlocked).toHaveLength(0);
  });

  it('retains the unlocked state and dirty revision after quota failure, allowing retry', async () => {
    const memory = memoryStorage();
    let fail = true;
    const store = createBrowserWorkspaceStore({
      storage: {
        getItem: memory.getItem,
        setItem: (key, value) => {
          if (fail) throw new DOMException('Quota exceeded', 'QuotaExceededError');
          memory.setItem(key, value);
        },
      },
    });
    const w = createWorkspace('Unsaved data', 'mainnet');
    store.open(w, password);
    await expect(store.lock(w.id)).rejects.toThrow('Quota exceeded');
    expect(store.getSnapshot().unlocked[0].savedRevision).toBe(-1);
    expect(store.getSnapshot().storageError).toContain('Export');
    store.update(w.id, (current) => ({ ...current, name: 'Still editable' }));
    fail = false;
    await store.lock(w.id);
    expect(store.getSnapshot().unlocked).toHaveLength(0);
    expect(await decryptWorkspace(JSON.parse(memory.raw()!)[0].envelope, password)).toMatchObject({
      name: 'Still editable',
    });
  });

  it('preserves malformed browser storage and refuses to replace it with a filtered empty index', async () => {
    for (const raw of ['broken JSON', '{}', '[{"id":"broken","envelope":{}}]']) {
      const storage = memoryStorage(raw);
      const store = createBrowserWorkspaceStore({ storage });
      const w = createWorkspace('New data', 'mainnet');
      store.open(w, password);
      await expect(store.persist(w.id)).rejects.toThrow('malformed');
      expect(storage.raw()).toBe(raw);
      expect(store.getSnapshot().unlocked).toHaveLength(1);
    }
  });

  it('detects another tab changing storage during encryption without overwriting either session', async () => {
    const storage = memoryStorage();
    const started = deferred(),
      release = deferred();
    const first = createBrowserWorkspaceStore({
      storage,
      encrypt: async (data, pw) => {
        started.resolve();
        await release.promise;
        return encryptWorkspace(data, pw);
      },
    });
    const second = createBrowserWorkspaceStore({ storage });
    const a = createWorkspace('First tab', 'mainnet'),
      b = createWorkspace('Second tab', 'mainnet');
    first.open(a, password);
    second.open(b, password);
    const pending = first.persist(a.id);
    await started.promise;
    await second.persist(b.id);
    const otherTabData = storage.raw();
    release.resolve();
    await expect(pending).rejects.toThrow('another tab');
    expect(storage.raw()).toBe(otherTabData);
    expect(first.getSnapshot().unlocked[0].data.name).toBe('First tab');
    expect(first.getSnapshot().unlocked[0].savedRevision).toBe(-1);
  });

  it('serializes saves for different workspaces without losing index entries', async () => {
    const storage = memoryStorage();
    const store = createBrowserWorkspaceStore({ storage });
    const a = createWorkspace('A', 'mainnet'),
      b = createWorkspace('B', 'testnet4');
    store.open(a, password);
    store.open(b, password);
    await Promise.all([store.persist(a.id), store.persist(b.id)]);
    expect(
      new Set(JSON.parse(storage.getItem(STORAGE_KEY)!).map((entry: { id: string }) => entry.id)),
    ).toEqual(new Set([a.id, b.id]));
  });

  it('does not lock a clean session if its stored backup has changed or disappeared', async () => {
    const storage = memoryStorage();
    const store = createBrowserWorkspaceStore({ storage });
    const w = createWorkspace('Already saved', 'mainnet');
    store.open(w, password);
    await store.persist(w.id);
    storage.setItem(STORAGE_KEY, '[]');
    await expect(store.lock(w.id)).rejects.toThrow('another tab');
    expect(store.getSnapshot().unlocked[0].data.name).toBe('Already saved');
    expect(storage.raw()).toBe('[]');
  });
});
