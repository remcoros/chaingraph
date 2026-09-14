import {
  TransactionFetchScope,
  transactionScheduler,
} from '../../Infra/Bitcoin/transactionScheduler';
import { WalletPreparationCache } from './Workbenches/Wallet/walletPreparation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Transaction, Workspace } from '../../Domain/types';
import { describeWorkspaceChange } from '../../Domain/Workspace/undoDescription';
import {
  MAX_SCAN_EVIDENCE_TRANSACTIONS,
  MAX_SCAN_RECORD_BYTES,
  scanResultEvidenceIds,
} from '../../Domain/ConnectionScan/connectionScanRecords';
import { parseWorkspace, assertWorkspaceBudget } from '../../Domain/Workspace/workspace';
import { carryScanMetadata, walletEvidenceChanged } from '../../Domain/Wallet/walletActivity';
import { carryObservationContext } from '../../Domain/Chain/observationContext';
import {
  assertEnvelopeHeader,
  WorkspaceCryptoError,
  encryptWorkspace,
  decryptWorkspace,
  MAX_ENCRYPTED_FILE_BYTES,
  type EncryptedEnvelope,
} from '../../Infra/Storage/crypto';

import { indexedEnvelopeStorage, type EnvelopeStorage } from '../../Infra/Storage/envelopeStorage';
import { operationError, operationErrorCode } from '../../Infra/Storage/workspaceOperationError';
import { validateAndEncryptWorkspace } from '../../Infra/Storage/workspaceEncryption';
import {
  decryptWorkspaceOffThread,
  encryptWorkspaceOffThread,
} from '../../Infra/Storage/workspaceEncryptionClient';

/** Undo keeps current results, retaining only proof absent from this older snapshot. */
function scanRecordsForUndo(snapshot: Workspace, current: Workspace): Workspace['connectionScans'] {
  const records = current.connectionScans;
  if (!records || snapshot.transactions === current.transactions) return records;
  const needed = new Set(
    records.runs.flatMap((run) =>
      run.results.flatMap((result) => [...scanResultEvidenceIds(result)]),
    ),
  );
  const evidence: Record<string, Transaction> = {};
  const encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify({ runs: records.runs, evidence: {} })).byteLength;
  let count = 0;
  for (const txid of needed) {
    if (snapshot.transactions[txid]) continue;
    const transaction =
      records.evidence[txid] ??
      current.transactions[txid] ??
      snapshot.connectionScans?.evidence[txid];
    if (!transaction) continue;
    // A conservative comma allowance keeps every snapshot inside normal save bounds.
    const entryBytes =
      encoder.encode(JSON.stringify(txid) + ':' + JSON.stringify(transaction)).byteLength + 1;
    if (count >= MAX_SCAN_EVIDENCE_TRANSACTIONS || bytes + entryBytes > MAX_SCAN_RECORD_BYTES)
      continue;
    evidence[txid] = transaction;
    count++;
    bytes += entryBytes;
  }
  // If a snapshot cannot retain every proof within the caps, existing path review
  // reports missing evidence and requires another scan before adding that path.
  return { runs: records.runs, evidence };
}

export const INLINE_INDEX_LIMIT = 1024 * 1024;
export const STORAGE_KEY = 'chaingraph.encrypted-workspaces.v1';
export interface SavedWorkspace {
  id: string;
  /** Deliberately public display name. Details remain inside the encrypted envelope. */
  publicName?: string;
  savedAt: string;
  envelope?: EncryptedEnvelope;
  envelopeRef?: string;
}
export interface UndoEntry {
  workspace: Workspace;
  description: string;
}
export interface UnlockedWorkspace {
  fetchScope: TransactionFetchScope;
  walletPreparation: WalletPreparationCache;
  data: Workspace;
  password: string;
  revision: number;
  savedRevision: number;
  history: UndoEntry[];
  redoHistory: UndoEntry[];
  /** Increments whenever the undo head changes, so a caller can tell whether its
   * own edit is still the step that Undo would restore. Presentation-only writes
   * leave it untouched. */
  undoRevision: number;
}
interface StoreState {
  saved: SavedWorkspace[];
  unlocked: UnlockedWorkspace[];
  activeId?: string;
  storageError: string;
  saving: boolean;
}
interface StoreOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  encrypt?: typeof encryptWorkspace;
  decrypt?: typeof decryptWorkspace;
  envelopes?: EnvelopeStorage;
}

function validEnvelope(e: unknown): e is EncryptedEnvelope {
  if (!e || typeof e !== 'object') return false;
  const value = e as EncryptedEnvelope;
  return !(
    Object.keys(value).sort().join(',') !==
      (value.version === 2
        ? 'cipher,ciphertext,compression,format,iterations,iv,kdf,salt,version'
        : 'cipher,ciphertext,format,iterations,iv,kdf,salt,version') ||
    value.format !== 'chaingraph-workspace' ||
    (value.version !== 1 && value.version !== 2) ||
    (value.version === 2 && !['none', 'gzip'].includes(value.compression)) ||
    value.cipher !== 'AES-256-GCM' ||
    value.kdf !== 'PBKDF2-SHA256' ||
    value.iterations !== 600000 ||
    typeof value.salt !== 'string' ||
    !/^[A-Za-z0-9+/]{22}==$/.test(value.salt) ||
    typeof value.iv !== 'string' ||
    !/^[A-Za-z0-9+/]{16}$/.test(value.iv) ||
    typeof value.ciphertext !== 'string' ||
    value.ciphertext.length < 24 ||
    value.ciphertext.length > MAX_ENCRYPTED_FILE_BYTES ||
    value.ciphertext.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.ciphertext)
  );
}

function parseSaved(raw: string | null): SavedWorkspace[] {
  if (raw === null) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.length > 100)
    throw new Error('Invalid saved workspace index.');
  const ids = new Set<string>();
  for (const record of records) {
    const e = record?.envelope;
    if (e) assertEnvelopeHeader(e);
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
      (record.envelopeRef !== undefined
        ? typeof record.envelopeRef !== 'string' ||
          !/^indexeddb:[0-9a-f-]{36}$/i.test(record.envelopeRef) ||
          e !== undefined
        : !validEnvelope(e))
    ) {
      throw new Error('Invalid saved workspace index or encrypted envelope.');
    }
    ids.add(record.id);
  }
  return records as SavedWorkspace[];
}

/** Synchronous state transitions keep async encryption independent of React render timing. */
export class WorkspaceStore {
  private state: StoreState = {
    saved: [],
    unlocked: [],
    storageError: '',
    saving: false,
  };
  private listeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();
  private locking = new Map<string, Promise<void>>();
  private editGroups = new Map<string, { key: string; at: number }>();
  private storedRaw: string | null = null;
  private storageInvalid = false;
  private options: StoreOptions;
  private envelopes?: EnvelopeStorage;
  private autosavePaused = new Set<string>();
  private idleWaiters = new Map<string, Set<() => void>>();

  constructor(options: StoreOptions = {}) {
    this.options = options;
    this.envelopes = options.envelopes;
    if (!this.envelopes) {
      try {
        if (globalThis.indexedDB) this.envelopes = indexedEnvelopeStorage(globalThis.indexedDB);
      } catch {
        // Some restricted browser contexts disallow IndexedDB while allowing localStorage.
      }
    }
    try {
      this.storedRaw = this.storage().getItem(STORAGE_KEY);
      this.state.saved = parseSaved(this.storedRaw);
    } catch (error) {
      this.storageInvalid = true;
      this.state.storageError =
        error instanceof WorkspaceCryptoError && error.code === 'unsupported-format'
          ? operationError(error.code).message
          : 'Saved workspace storage is unreadable or malformed. Existing data was preserved. Export any open workspace; repair or restore browser storage before saving.';
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

  private async commitIndex(raw: string, hasWebLock: boolean, precondition?: () => void) {
    let published = false;
    const publish = () => {
      this.assertStorageUnchanged();
      precondition?.();
      this.storage().setItem(STORAGE_KEY, raw);
      this.storedRaw = raw;
      published = true;
    };
    if (this.envelopes?.commitIndex) {
      // Use the same coordinator even when Web Locks is present, so a context
      // without Web Locks cannot race a context that has it.
      try {
        await this.envelopes.commitIndex(publish);
      } catch (error) {
        // localStorage publication is the commit point. An IDB mutex abort after
        // that point must not cause removal of ciphertext the index now references.
        if (!published) throw error;
      }
    } else if (hasWebLock) publish();
    else
      throw new Error(
        'This browser cannot coordinate encrypted saves. Enable browser storage or use a browser with Web Locks or IndexedDB support.',
      );
  }
  private async publish(saved: SavedWorkspace[], hasWebLock: boolean): Promise<SavedWorkspace[]> {
    this.assertStorageUnchanged();
    // Ciphertext is base64, so its string length is exact without serializing it.
    // Public metadata is bounded; 1 KiB per entry safely overestimates JSON escaping.
    const estimatedLength = saved.reduce(
      (length, entry) => length + (entry.envelope?.ciphertext.length ?? 0) + 1024,
      2,
    );
    const alreadyExternal = this.state.saved.some((entry) => entry.envelopeRef);
    if (estimatedLength <= INLINE_INDEX_LIMIT && !alreadyExternal) {
      try {
        await this.commitIndex(JSON.stringify(saved), hasWebLock);
        return saved;
      } catch (error) {
        if (
          !this.envelopes ||
          !(error instanceof DOMException) ||
          error.name !== 'QuotaExceededError'
        )
          throw error;
      }
    }
    if (!this.envelopes)
      throw new Error('Large encrypted workspaces require IndexedDB browser storage.');
    const blobs: { reference: string; envelope: EncryptedEnvelope }[] = [];
    const external = saved.map((entry) => {
      if (!entry.envelope) return entry;
      const reference = `indexeddb:${crypto.randomUUID()}`;
      blobs.push({ reference, envelope: entry.envelope });
      return {
        id: entry.id,
        publicName: entry.publicName,
        savedAt: entry.savedAt,
        envelopeRef: reference,
      };
    });
    try {
      await this.envelopes!.write(blobs);
      // The index is the commit point. Immutable new blobs cannot replace another tab's data.
      const externalRaw = JSON.stringify(external);
      await this.commitIndex(externalRaw, hasWebLock);
      return external;
    } catch (error) {
      await this.envelopes!.remove(blobs.map((blob) => blob.reference)).catch(() => {});
      throw error;
    }
  }
  private async cleanReplaced(previous: SavedWorkspace[], next: SavedWorkspace[]) {
    const retained = new Set(next.map((entry) => entry.envelopeRef));
    const removed = previous.flatMap((entry) =>
      entry.envelopeRef && !retained.has(entry.envelopeRef) ? [entry.envelopeRef] : [],
    );
    if (removed.length) await this.envelopes?.remove(removed).catch(() => {});
  }

  setActiveId = (activeId: string | undefined) => {
    this.patch({ activeId });
  };
  private add(data: Workspace, password: string, alreadySaved: boolean) {
    if (this.locking.has(data.id)) throw new Error('This workspace is currently locking.');
    if (this.state.unlocked.some((s) => s.data.id === data.id)) {
      this.setActiveId(data.id);
      return;
    }
    // Typing groups belong to one unlocked session, never a later reopen.
    this.editGroups.delete(data.id);
    this.patch({
      unlocked: [
        ...this.state.unlocked,
        {
          data,
          fetchScope: new TransactionFetchScope(data.network),
          walletPreparation: new WalletPreparationCache(),
          password,
          revision: 0,
          savedRevision: alreadySaved ? 0 : -1,
          history: [],
          redoHistory: [],
          undoRevision: 0,
        },
      ],
      activeId: data.id,
    });
  }
  open = (data: Workspace, password: string) => {
    this.add(data, password, false);
  };
  unlock = async (entry: SavedWorkspace, password: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!this.state.saved.includes(entry))
      throw new Error('Saved workspace changed; reload before unlocking.');
    // Leaving another open workspace may still be publishing its save. Wait before
    // capturing the index so our own queued write cannot invalidate this unlock.
    let pending: Promise<void>;
    do {
      pending = this.writing;
      await pending.catch(() => {});
    } while (pending !== this.writing);
    signal?.throwIfAborted();
    this.assertStorageUnchanged();
    // An inline-to-IndexedDB migration can replace this entry without editing its
    // workspace. Resolve its current reference only after our queued writes settle.
    const currentEntry = this.state.saved.find((candidate) => candidate.id === entry.id);
    if (!currentEntry) throw new Error('Saved workspace changed; reload before unlocking.');
    entry = currentEntry;
    const indexAtStart = this.storedRaw;
    const envelope = entry.envelopeRef
      ? await this.envelopes?.read(entry.envelopeRef)
      : entry.envelope;
    if (envelope) {
      try {
        assertEnvelopeHeader(envelope);
      } catch (error) {
        throw operationError(operationErrorCode(error));
      }
    }
    if (!validEnvelope(envelope))
      throw new Error(
        'Encrypted workspace data is missing or malformed. Restore an exported backup.',
      );
    const data = this.options.decrypt
      ? parseWorkspace(await this.options.decrypt(envelope, password))
      : await decryptWorkspaceOffThread(envelope, password, signal);
    signal?.throwIfAborted();
    if (data.id !== entry.id)
      throw new Error('Workspace identity does not match its encrypted contents.');
    this.assertStorageUnchanged();
    if (this.storedRaw !== indexAtStart || !this.state.saved.includes(entry))
      throw new Error('Saved workspace changed; reload before unlocking.');
    // Legacy or stale index labels are migrated from the authenticated workspace on save.
    this.add(data, password, entry.publicName === data.name);
  };
  update = (
    id: string,
    fn: (w: Workspace) => Workspace,
    undo = true,
    group?: string,
    description?: string,
  ) => {
    if (this.locking.has(id)) return;
    const current = this.state.unlocked.find((s) => s.data.id === id);
    if (!current) return;
    let data = fn(current.data);
    // An identical result (for example a scan for a deleted wallet) is not an
    // edit: keep the revision, undo history and autosave state untouched.
    if (data === current.data) return;
    const evidenceChanged =
      data.transactions !== current.data.transactions ||
      walletEvidenceChanged(current.data.wallets, data.wallets);
    if (evidenceChanged) {
      data = {
        ...data,
        findings: data.findings.map((finding) => ({ ...finding, stale: true })),
      };
    }
    assertWorkspaceBudget(data);
    if (data.id !== id) throw new Error('A workspace edit cannot change its identity.');
    const previousGroup = this.editGroups.get(id);
    const now = Date.now();
    const coalesce = undo && group && previousGroup?.key === group && now - previousGroup.at < 1500;
    if (undo && group) this.editGroups.set(id, { key: group, at: now });
    else if (undo || evidenceChanged) this.editGroups.delete(id);
    const carryPresentation = (entry: UndoEntry): UndoEntry => {
      const snapshot = entry.workspace;
      return {
        ...entry,
        workspace: {
          ...carryObservationContext(carryScanMetadata(snapshot, data), current.data, data),
          // Latest scan results are not an undoable archive. Preserve
          // pre-path evidence on camera writes, but carry explicit
          // result replacement/clearing through both history stacks.
          ...(data.connectionScans !== current.data.connectionScans
            ? { connectionScans: scanRecordsForUndo(snapshot, data) }
            : {}),
          view: {
            ...data.view,
            hiddenNodeIds: snapshot.view.hiddenNodeIds,
            graphNodeIds: snapshot.view.graphNodeIds,
          },
        },
      };
    };
    // Chain refreshes are not undoable. Both history stacks are invalidated only when
    // evidence changed; a quiet check retains them, with the latest scan-owned
    // metadata carried in so undo restores user edits, never stale check state.
    this.patch({
      unlocked: this.state.unlocked.map((s) =>
        s !== current
          ? s
          : {
              ...s,
              data,
              revision: s.revision + 1,
              undoRevision:
                s.undoRevision + ((undo && !coalesce) || (!undo && evidenceChanged) ? 1 : 0),
              history: undo
                ? coalesce
                  ? s.history.map((entry, index) =>
                      index === s.history.length - 1
                        ? {
                            ...entry,
                            description:
                              description ?? describeWorkspaceChange(entry.workspace, data),
                          }
                        : entry,
                    )
                  : [
                      ...s.history.slice(-14),
                      {
                        workspace: s.data,
                        description: description ?? describeWorkspaceChange(s.data, data),
                      },
                    ]
                : evidenceChanged
                  ? []
                  : s.history.map(carryPresentation),
              redoHistory: undo || evidenceChanged ? [] : s.redoHistory.map(carryPresentation),
            },
      ),
    });
  };
  undo = (id: string) => {
    if (this.locking.has(id)) return;
    this.editGroups.delete(id);
    this.patch({
      unlocked: this.state.unlocked.map((s) =>
        s.data.id === id && s.history.length
          ? {
              ...s,
              data: s.history[s.history.length - 1].workspace,
              history: s.history.slice(0, -1),
              redoHistory: [
                ...s.redoHistory,
                { workspace: s.data, description: s.history[s.history.length - 1].description },
              ],
              revision: s.revision + 1,
              undoRevision: s.undoRevision + 1,
            }
          : s,
      ),
    });
  };

  redo = (id: string) => {
    if (this.locking.has(id)) return;
    this.editGroups.delete(id);
    this.patch({
      unlocked: this.state.unlocked.map((s) =>
        s.data.id === id && s.redoHistory.length
          ? {
              ...s,
              data: s.redoHistory[s.redoHistory.length - 1].workspace,
              history: [
                ...s.history,
                {
                  workspace: s.data,
                  description: s.redoHistory[s.redoHistory.length - 1].description,
                },
              ],
              redoHistory: s.redoHistory.slice(0, -1),
              revision: s.revision + 1,
              undoRevision: s.undoRevision + 1,
            }
          : s,
      ),
    });
  };

  getSaved = (id: string) => this.state.saved.find((entry) => entry.id === id);
  getUnlocked = (id: string) => this.state.unlocked.find((session) => session.data.id === id);
  private resumeAutosave(id: string) {
    this.autosavePaused.delete(id);
    for (const resume of this.idleWaiters.get(id) ?? []) resume();
    this.idleWaiters.delete(id);
  }
  pauseAutosave = (id: string, paused: boolean) => {
    if (paused) this.autosavePaused.add(id);
    else {
      this.resumeAutosave(id);
      const session = this.getUnlocked(id);
      if (session && session.revision !== session.savedRevision)
        void this.persist(id, true).catch(() => {});
    }
  };
  private async waitForIdle(id: string) {
    while (this.autosavePaused.has(id))
      await new Promise<void>((resolve) => {
        const waiters = this.idleWaiters.get(id) ?? new Set();
        waiters.add(resolve);
        this.idleWaiters.set(id, waiters);
      });
  }
  private prepareEnvelope(data: Workspace, password: string, beforeStart?: () => Promise<void>) {
    return this.options.encrypt
      ? validateAndEncryptWorkspace(data, password, this.options.encrypt)
      : encryptWorkspaceOffThread(data, password, beforeStart);
  }
  exportEncrypted = async (id: string) => {
    this.resumeAutosave(id);
    const session = this.getUnlocked(id);
    if (!session) throw new Error('This workspace is no longer unlocked.');
    return {
      name: session.data.name,
      envelope: await this.prepareEnvelope(session.data, session.password),
    };
  };
  persist = (id: string, automatic = false): Promise<void> => {
    if (!automatic) this.resumeAutosave(id);
    const operation = this.writing
      .catch(() => {})
      .then(async () => {
        if (automatic) await this.waitForIdle(id);
        const session = this.state.unlocked.find((s) => s.data.id === id);
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
          const envelope = await this.prepareEnvelope(
            session.data,
            session.password,
            automatic ? () => this.waitForIdle(id) : undefined,
          );
          if (automatic) await this.waitForIdle(id);
          const commit = async (hasWebLock: boolean) => {
            this.assertStorageUnchanged();
            const entry = {
              id,
              publicName: session.data.name,
              savedAt: new Date().toISOString(),
              envelope,
            };
            let saved = [entry, ...this.state.saved.filter((e) => e.id !== id)];
            const previous = this.state.saved;
            if (saved.length > 100)
              throw new Error(
                'Browser storage supports at most 100 saved workspaces. Export this workspace to a file.',
              );
            saved = await this.publish(saved, hasWebLock);
            this.patch({
              saved,
              unlocked: this.state.unlocked.map((s) =>
                s.data.id === id ? { ...s, savedRevision: session.revision } : s,
              ),
              storageError: '',
            });
            await this.cleanReplaced(previous, saved);
          };
          // Serialize cross-tab check/write where the browser provides Web Locks.
          if (typeof navigator !== 'undefined' && navigator.locks)
            await navigator.locks.request(STORAGE_KEY, async () => {
              await commit(true);
            });
          else await commit(false);
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
        const commit = async (hasWebLock: boolean) => {
          this.assertStorageUnchanged();
          if (this.state.unlocked.some((session) => session.data.id === id))
            throw new Error('Lock this workspace before deleting its saved copy.');
          const previous = this.state.saved;
          const saved = this.state.saved.filter((entry) => entry.id !== id);
          const raw = JSON.stringify(saved);
          await this.commitIndex(raw, hasWebLock, () => {
            if (this.state.unlocked.some((session) => session.data.id === id))
              throw new Error('Lock this workspace before deleting its saved copy.');
          });
          this.patch({ saved, storageError: '' });
          await this.cleanReplaced(previous, saved);
        };
        if (typeof navigator !== 'undefined' && navigator.locks)
          await navigator.locks.request(STORAGE_KEY, async () => commit(true));
        else await commit(false);
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
        const current = this.state.unlocked.find((s) => s.data.id === id);
        if (current && current.revision !== current.savedRevision)
          throw new Error('Workspace changed while locking; keep it open and save again.');
        this.editGroups.delete(id);
        if (current) {
          transactionScheduler.dispose(current.fetchScope);
          current.walletPreparation.dispose();
        }
        this.patch({
          unlocked: this.state.unlocked.filter((s) => s.data.id !== id),
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
  const [store] = useState(() => new WorkspaceStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const ids = state.unlocked.filter((s) => s.revision !== s.savedRevision).map((s) => s.data.id);
    if (!ids.length) return;
    const timer = setTimeout(() => {
      for (const id of ids) void store.persist(id, true).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [state.unlocked, store]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (store.getSnapshot().unlocked.some((s) => s.revision !== s.savedRevision)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store]);
  return {
    ...state,
    active: state.unlocked.find((s) => s.data.id === state.activeId),
    setActiveId: store.setActiveId,
    open: store.open,
    unlock: store.unlock,
    update: store.update,
    undo: store.undo,
    redo: store.redo,
    lock: store.lock,
    persist: store.persist,
    getUnlocked: store.getUnlocked,
    getSaved: store.getSaved,
    exportEncrypted: store.exportEncrypted,
    pauseAutosave: store.pauseAutosave,
    removeSaved: store.removeSaved,
  };
}
