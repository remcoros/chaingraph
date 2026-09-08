import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Workspace } from '../domain/types';
import { parseWorkspace, assertWorkspaceBudget } from '../domain/workspace';
import { walletEvidenceChanged } from '../domain/walletActivity';
import {
  encryptWorkspace,
  decryptWorkspace,
  MAX_ENCRYPTED_FILE_BYTES,
  type EncryptedEnvelope,
} from './crypto';

export const STORAGE_KEY = 'chaingraph.encrypted-workspaces.v1';
export interface SavedWorkspace {
  id: string;
  /** Deliberately public display name. Details remain inside the encrypted envelope. */
  publicName?: string;
  savedAt: string;
  envelope: EncryptedEnvelope;
}
export interface Session {
  data: Workspace;
  password: string;
  revision: number;
  savedRevision: number;
  history: Workspace[];
}
interface StoreState {
  saved: SavedWorkspace[];
  sessions: Session[];
  activeId?: string;
  storageError: string;
  saving: boolean;
}
interface StoreOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  encrypt?: typeof encryptWorkspace;
  decrypt?: typeof decryptWorkspace;
}

function parseSaved(raw: string | null): SavedWorkspace[] {
  if (raw === null) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.length > 100)
    throw new Error('Invalid saved workspace index.');
  const ids = new Set<string>();
  for (const record of records) {
    const e = record?.envelope;
    if (
      !record ||
      typeof record.id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(record.id) ||
      ids.has(record.id) ||
      (record.publicName !== undefined &&
        (typeof record.publicName !== 'string' ||
          !record.publicName.trim() ||
          record.publicName.length > 100)) ||
      typeof record.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.savedAt)) ||
      !e ||
      Object.keys(e).sort().join(',') !==
        'cipher,ciphertext,format,iterations,iv,kdf,salt,version' ||
      e.format !== 'chaingraph-workspace' ||
      e.version !== 1 ||
      e.cipher !== 'AES-256-GCM' ||
      e.kdf !== 'PBKDF2-SHA256' ||
      e.iterations !== 600000 ||
      typeof e.salt !== 'string' ||
      !/^[A-Za-z0-9+/]{22}==$/.test(e.salt) ||
      typeof e.iv !== 'string' ||
      !/^[A-Za-z0-9+/]{16}$/.test(e.iv) ||
      typeof e.ciphertext !== 'string' ||
      e.ciphertext.length < 24 ||
      e.ciphertext.length > MAX_ENCRYPTED_FILE_BYTES ||
      e.ciphertext.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(e.ciphertext)
    ) {
      throw new Error('Invalid saved workspace index or encrypted envelope.');
    }
    ids.add(record.id);
  }
  return records as SavedWorkspace[];
}

/** Synchronous state transitions keep async encryption independent of React render timing. */
export class WorkspaceSessionStore {
  private state: StoreState = { saved: [], sessions: [], storageError: '', saving: false };
  private listeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();
  private locking = new Map<string, Promise<void>>();
  private storedRaw: string | null = null;
  private storageInvalid = false;
  private options: StoreOptions;

  constructor(options: StoreOptions = {}) {
    this.options = options;
    try {
      this.storedRaw = this.storage().getItem(STORAGE_KEY);
      this.state.saved = parseSaved(this.storedRaw);
    } catch {
      this.storageInvalid = true;
      this.state.storageError =
        'Saved workspace storage is unreadable or malformed. Existing data was preserved. Export any open workspace; repair or restore browser storage before saving.';
    }
  }

  private storage() {
    return this.options.storage ?? globalThis.localStorage;
  }
  getSnapshot = (): StoreState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(update: Partial<StoreState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  private assertStorageUnchanged() {
    if (this.storageInvalid)
      throw new Error('Saved storage is malformed or unavailable; it will not be overwritten.');
    if (this.storage().getItem(STORAGE_KEY) !== this.storedRaw)
      throw new Error(
        'Saved storage changed in another tab. Export your open workspace, then reload before saving.',
      );
  }

  setActiveId = (activeId: string | undefined) => {
    this.patch({ activeId });
  };
  private add(data: Workspace, password: string, alreadySaved: boolean) {
    if (this.locking.has(data.id)) throw new Error('This workspace is currently locking.');
    if (this.state.sessions.some((s) => s.data.id === data.id)) {
      this.setActiveId(data.id);
      return;
    }
    this.patch({
      sessions: [
        ...this.state.sessions,
        { data, password, revision: 0, savedRevision: alreadySaved ? 0 : -1, history: [] },
      ],
      activeId: data.id,
    });
  }
  open = (data: Workspace, password: string) => {
    this.add(data, password, false);
  };
  unlock = async (entry: SavedWorkspace, password: string) => {
    this.assertStorageUnchanged();
    const data = parseWorkspace(
      await (this.options.decrypt ?? decryptWorkspace)(entry.envelope, password),
    );
    if (data.id !== entry.id)
      throw new Error('Workspace identity does not match its encrypted contents.');
    this.assertStorageUnchanged();
    if (
      !this.state.saved.some((saved) => saved.id === entry.id && saved.envelope === entry.envelope)
    )
      throw new Error('Saved workspace changed; reload before unlocking.');
    // Legacy or stale index labels are migrated from the authenticated workspace on save.
    this.add(data, password, entry.publicName === data.name);
  };
  update = (id: string, fn: (w: Workspace) => Workspace, undo = true) => {
    if (this.locking.has(id)) return;
    const current = this.state.sessions.find((s) => s.data.id === id);
    if (!current) return;
    let data = fn(current.data);
    if (
      data.transactions !== current.data.transactions ||
      walletEvidenceChanged(current.data.wallets, data.wallets)
    ) {
      data = { ...data, findings: data.findings.map((finding) => ({ ...finding, stale: true })) };
    }
    assertWorkspaceBudget(data);
    if (data.id !== id) throw new Error('A workspace edit cannot change its identity.');
    // Chain refreshes are not undoable and invalidate older full-workspace snapshots.
    this.patch({
      sessions: this.state.sessions.map((s) =>
        s !== current
          ? s
          : {
              ...s,
              data,
              revision: s.revision + 1,
              history: undo ? [...s.history.slice(-14), s.data] : [],
            },
      ),
    });
  };
  undo = (id: string) => {
    if (this.locking.has(id)) return;
    this.patch({
      sessions: this.state.sessions.map((s) =>
        s.data.id === id && s.history.length
          ? {
              ...s,
              data: s.history[s.history.length - 1],
              history: s.history.slice(0, -1),
              revision: s.revision + 1,
            }
          : s,
      ),
    });
  };

  persist = (id: string): Promise<void> => {
    const operation = this.writing
      .catch(() => {})
      .then(async () => {
        const session = this.state.sessions.find((s) => s.data.id === id);
        if (!session) return;
        this.patch({ saving: true });
        try {
          this.assertStorageUnchanged();
          if (session.savedRevision === session.revision) return;
          if (
            typeof session.data.name !== 'string' ||
            !session.data.name.trim() ||
            session.data.name.length > 100
          )
            throw new Error('Workspace name must contain 1 to 100 characters.');
          if (
            session.data.description !== undefined &&
            (typeof session.data.description !== 'string' ||
              session.data.description.length > 10000)
          )
            throw new Error('Workspace description must contain at most 10,000 characters.');
          // Full shape/semantic validation keeps a save readable. Imported wallet bindings
          // are cryptographically verified at unlock/import; local derivation owns scan writes.
          parseWorkspace(session.data, false);
          const envelope = await (this.options.encrypt ?? encryptWorkspace)(
            session.data,
            session.password,
          );
          const commit = () => {
            this.assertStorageUnchanged();
            const entry = {
              id,
              publicName: session.data.name,
              savedAt: new Date().toISOString(),
              envelope,
            };
            const saved = [entry, ...this.state.saved.filter((e) => e.id !== id)];
            if (saved.length > 100)
              throw new Error(
                'Browser storage supports at most 100 saved workspaces. Export this workspace to a file.',
              );
            const raw = JSON.stringify(saved);
            this.storage().setItem(STORAGE_KEY, raw);
            this.storedRaw = raw;
            this.patch({
              saved,
              sessions: this.state.sessions.map((s) =>
                s.data.id === id ? { ...s, savedRevision: session.revision } : s,
              ),
              storageError: '',
            });
          };
          // Serialize cross-tab check/write where the browser provides Web Locks.
          if (typeof navigator !== 'undefined' && navigator.locks)
            await navigator.locks.request(STORAGE_KEY, async () => {
              commit();
            });
          else commit();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Encrypted save failed.';
          this.patch({
            storageError: `Autosave failed: ${message} Export your workspace to preserve it.`,
          });
          throw error;
        } finally {
          this.patch({ saving: false });
        }
      });
    this.writing = operation;
    return operation;
  };

  removeSaved = (id: string): Promise<void> => {
    const operation = this.writing
      .catch(() => {})
      .then(async () => {
        const commit = () => {
          this.assertStorageUnchanged();
          if (this.state.sessions.some((session) => session.data.id === id))
            throw new Error('Lock this workspace before deleting its saved copy.');
          const saved = this.state.saved.filter((entry) => entry.id !== id);
          const raw = JSON.stringify(saved);
          this.storage().setItem(STORAGE_KEY, raw);
          this.storedRaw = raw;
          this.patch({ saved, storageError: '' });
        };
        if (typeof navigator !== 'undefined' && navigator.locks)
          await navigator.locks.request(STORAGE_KEY, async () => commit());
        else commit();
      });
    this.writing = operation;
    return operation;
  };

  lock = (id: string): Promise<void> => {
    const pending = this.locking.get(id);
    if (pending) return pending;
    // No state callbacks are queued: all earlier edits are already in state.
    const operation = Promise.resolve()
      .then(async () => {
        await this.persist(id);
        const current = this.state.sessions.find((s) => s.data.id === id);
        if (current && current.revision !== current.savedRevision)
          throw new Error('Workspace changed while locking; keep it open and save again.');
        this.patch({
          sessions: this.state.sessions.filter((s) => s.data.id !== id),
          activeId: this.state.activeId === id ? undefined : this.state.activeId,
        });
      })
      .finally(() => {
        this.locking.delete(id);
      });
    this.locking.set(id, operation);
    return operation;
  };
}

export function useWorkspaces() {
  const storeRef = useRef<WorkspaceSessionStore | null>(null);
  if (!storeRef.current) storeRef.current = new WorkspaceSessionStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const ids = state.sessions.filter((s) => s.revision !== s.savedRevision).map((s) => s.data.id);
    if (!ids.length) return;
    const timer = setTimeout(() => {
      for (const id of ids) void store.persist(id).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [state.sessions, store]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (store.getSnapshot().sessions.some((s) => s.revision !== s.savedRevision)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store]);
  return {
    ...state,
    active: state.sessions.find((s) => s.data.id === state.activeId),
    setActiveId: store.setActiveId,
    open: store.open,
    unlock: store.unlock,
    update: store.update,
    undo: store.undo,
    lock: store.lock,
    persist: store.persist,
    removeSaved: store.removeSaved,
  };
}
