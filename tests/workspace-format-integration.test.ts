import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGraph, newWorkspace } from '../src/domain/workspace';
import type { Workspace } from '../src/domain/types';
import { decryptWorkspace, encryptWorkspace, type EncryptedEnvelope } from '../src/lib/crypto';
import {
  decryptAndValidateWorkspace,
  validateAndEncryptWorkspace,
} from '../src/lib/workspaceEncryption';
import { WorkspaceSessionStore } from '../src/lib/useWorkspaces';
import { transactionScheduler } from '../src/lib/transactionScheduler';

const password = 'public format integration fixture';
// Independent pre-compression writer, including the exact legacy AAD order.
function legacyEnvelope(payload: unknown): EncryptedEnvelope {
  const salt = Buffer.alloc(16, 3),
    iv = Buffer.alloc(12, 4);
  const header = {
    format: 'chaingraph-workspace' as const,
    version: 1 as const,
    cipher: 'AES-256-GCM' as const,
    kdf: 'PBKDF2-SHA256' as const,
    iterations: 600000 as const,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
  const cipher = createCipheriv(
    'aes-256-gcm',
    pbkdf2Sync(password, salt, 600000, 32, 'sha256'),
    iv,
  );
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return { ...header, ciphertext: body.toString('base64') };
}
function storageFixture(initial: string | null = null) {
  let raw = initial,
    fail = false;
  return {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      if (fail) throw new Error('Synthetic storage failure');
      raw = value;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
function savedIndex(workspace: { id: string; name: string }, envelope: unknown) {
  return JSON.stringify([
    { id: workspace.id, publicName: workspace.name, savedAt: '2026-09-10T00:00:00.000Z', envelope },
  ]);
}
afterEach(() => vi.unstubAllGlobals());

describe('workspace format at persistence and import boundaries', () => {
  it('validates legacy observations before persisting migrated membership without dropping other fields', async () => {
    const current = newWorkspace('Legacy save fixture', 'mainnet');
    const txid = 'a'.repeat(64);
    current.transactions[txid] = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: {} }],
    };
    const { graphNodeIds: _membership, ...view } = current.view;
    const legacy = { ...current, version: 1, view, retainedField: 'public fixture metadata' };
    const original = structuredClone(legacy);
    const saved = await validateAndEncryptWorkspace(legacy as unknown as Workspace, password);
    expect(await decryptWorkspace(saved, password)).toMatchObject({
      version: 2,
      view: { graphNodeIds: buildGraph(current).nodes.map((node) => node.id) },
      retainedField: 'public fixture metadata',
    });
    const restored = await decryptAndValidateWorkspace(saved, password);
    expect(restored.view.graphNodeIds).toEqual(buildGraph(current).nodes.map((node) => node.id));
    expect(legacy).toEqual(original);
  });

  it('unlocks a versionless v1 save without rewriting it, then checkpoints edits and exports v2', async () => {
    const current = newWorkspace('Legacy fixture', 'testnet4');
    const { version: _version, ...legacy } = current;
    const original = savedIndex(current, legacyEnvelope(legacy));
    const storage = storageFixture(original);
    const store = new WorkspaceSessionStore({ storage });
    await store.unlock(store.getSnapshot().saved[0], password);
    expect(store.getSession(current.id)!.data).toEqual(current);
    expect(storage.getItem()).toBe(original);
    store.pauseAutosave(current.id, true);
    store.update(current.id, (w) => ({
      ...w,
      description: 'Latest edit. '.repeat(500),
      view: { ...w.view, glow: false },
    }));
    const backup = await store.exportEncrypted(current.id);
    expect(backup.envelope).toMatchObject({ version: 2, compression: 'gzip' });
    const imported = await decryptAndValidateWorkspace(
      new Blob([JSON.stringify(backup.envelope)]),
      password,
    );
    expect(imported).toEqual(store.getSession(current.id)!.data);
    expect(storage.getItem()).toBe(original);
    await store.lock(current.id);
    expect(JSON.parse(storage.getItem()!)[0].envelope).toMatchObject({
      version: 2,
      compression: 'gzip',
    });
    await store.unlock(store.getSnapshot().saved[0], password);
    expect(store.getSession(current.id)!.data).toEqual(imported);
  });

  it('preserves originals when future envelope or schema versions are encountered', async () => {
    const workspace = newWorkspace('Future fixture', 'mainnet');
    const envelope = await encryptWorkspace({ ...workspace, version: 9 }, password);
    const raw = savedIndex(workspace, envelope);
    const storage = storageFixture(raw);
    const store = new WorkspaceSessionStore({ storage });
    await expect(store.unlock(store.getSnapshot().saved[0], password)).rejects.toThrow(
      'Unsupported workspace schema',
    );
    await expect(
      decryptAndValidateWorkspace(new Blob([JSON.stringify(envelope)]), password),
    ).rejects.toThrow('Unsupported workspace schema');
    expect(store.getSnapshot().sessions).toHaveLength(0);
    expect(storage.getItem()).toBe(raw);
    const futureRaw = savedIndex(workspace, { ...envelope, version: 9 });
    const futureStorage = storageFixture(futureRaw);
    const future = new WorkspaceSessionStore({ storage: futureStorage });
    expect(future.getSnapshot().storageError).toContain('Unsupported encrypted workspace');
    future.open(newWorkspace('Other fixture', 'mainnet'), password);
    await expect(future.persist(future.getSnapshot().sessions[0].data.id)).rejects.toThrow(
      'will not be overwritten',
    );
    expect(futureStorage.getItem()).toBe(futureRaw);
  });

  it('retains edits and the prior encrypted save through missing-codec and storage failures', async () => {
    const workspace = newWorkspace('Recovery fixture', 'mainnet');
    const storage = storageFixture();
    const store = new WorkspaceSessionStore({ storage });
    store.open(workspace, password);
    await store.persist(workspace.id);
    const original = storage.getItem();
    store.update(workspace.id, (w) => ({ ...w, description: 'Unsaved note. '.repeat(500) }));
    const scope = store.getSession(workspace.id)!.fetchScope;
    let fetchSignal: AbortSignal | undefined;
    const fetching = transactionScheduler.request(
      'mainnet',
      'public-pending-transaction',
      (signal) => {
        fetchSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      undefined,
      { scope },
    );
    const cancelledFetch = expect(fetching).rejects.toMatchObject({ name: 'AbortError' });

    vi.stubGlobal('CompressionStream', undefined);
    await expect(store.lock(workspace.id)).rejects.toThrow('gzip support');
    expect(storage.getItem()).toBe(original);
    expect(store.getSession(workspace.id)!.data.description).toContain('Unsaved note');
    expect(store.getSession(workspace.id)!.fetchScope).toBe(scope);
    expect(scope.closed).toBe(false);
    expect(fetchSignal?.aborted).toBe(false);
    vi.unstubAllGlobals();
    storage.fail(true);
    await expect(store.lock(workspace.id)).rejects.toThrow('storage failure');
    expect(storage.getItem()).toBe(original);
    expect(store.getSession(workspace.id)!.savedRevision).not.toBe(
      store.getSession(workspace.id)!.revision,
    );
    expect(store.getSession(workspace.id)!.fetchScope).toBe(scope);
    expect(scope.closed).toBe(false);
    expect(fetchSignal?.aborted).toBe(false);
    storage.fail(false);
    await store.lock(workspace.id);
    await cancelledFetch;
    expect(scope.closed).toBe(true);
    expect(fetchSignal?.aborted).toBe(true);
    expect(store.getSession(workspace.id)).toBeUndefined();
    await store.unlock(store.getSnapshot().saved[0], password);
    expect(store.getSession(workspace.id)!.data.description).toContain('Unsaved note');
    expect(store.getSession(workspace.id)!.fetchScope).not.toBe(scope);
    expect(store.getSession(workspace.id)!.fetchScope.closed).toBe(false);
    const backup = await store.exportEncrypted(workspace.id);
    const decoded = await decryptAndValidateWorkspace(backup.envelope, password);
    expect(decoded).not.toHaveProperty('fetchScope');
  });

  it('does not open a cancelled unlock even if a decrypt dependency returns late', async () => {
    const workspace = newWorkspace('Cancelled fixture', 'mainnet');
    const raw = savedIndex(workspace, legacyEnvelope(workspace));
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = storageFixture(raw);
    const store = new WorkspaceSessionStore({
      storage,
      decrypt: async () => {
        started();
        await blocked;
        return workspace;
      },
    });
    const controller = new AbortController();
    const unlocking = store.unlock(store.getSnapshot().saved[0], password, controller.signal);
    const rejected = expect(unlocking).rejects.toMatchObject({ name: 'AbortError' });
    await waiting;
    controller.abort();
    release();
    await rejected;
    expect(store.getSnapshot().sessions).toHaveLength(0);
    expect(storage.getItem()).toBe(raw);
  });

  it('runs the real worker handler for encrypted-file import and sanitized schema errors', async () => {
    const postMessage = vi.fn();
    const workerScope: {
      onmessage: null | ((event: MessageEvent) => Promise<void>);
      postMessage: typeof postMessage;
    } = { onmessage: null, postMessage };
    vi.stubGlobal('self', workerScope);
    await import('../src/lib/workspaceEncryption.worker');
    const handle = workerScope.onmessage!;
    const workspace = newWorkspace('Worker import fixture', 'mainnet');
    const envelope = legacyEnvelope(workspace);
    await handle({
      data: {
        type: 'decrypt-workspace',
        id: 'import',
        input: new Blob([JSON.stringify(envelope)]),
        password,
      },
    } as MessageEvent);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'workspace-decrypted',
      id: 'import',
      workspace,
    });
    const bad = legacyEnvelope({ ...workspace, version: 'private invalid version' });
    await handle({
      data: { type: 'decrypt-workspace', id: 'future', input: bad, password },
    } as MessageEvent);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'workspace-operation-failed',
      id: 'future',
      code: 'schema-version',
    });
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain(password);
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain('private invalid version');
  });
});
