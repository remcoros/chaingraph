import {
  TransactionFetchScope,
  transactionScheduler,
} from '../../../Infra/Bitcoin/transactionScheduler';
import { WalletPreparationCache } from '../Wallet/walletPreparation';
import type { Transaction } from '../../../Domain/Chain/transaction';
import type { Workspace } from '../workspace';
import { describeWorkspaceChange } from '../undoDescription';
import {
  MAX_SCAN_EVIDENCE_TRANSACTIONS,
  MAX_SCAN_RECORD_BYTES,
  scanResultEvidenceIds,
} from '../ConnectionScan/records';
import { assertWorkspaceBudget } from '../workspaceValidation';
import { carryScanMetadata, walletEvidenceChanged } from '../Wallet/walletActivity';
import { carryObservationContext } from '../Evidence/InputContext';
import type { SavedWorkspace } from '../savedWorkspace';
import type { WorkspacePersistence } from './WorkspacePersistence';

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

export interface UndoEntry {
  workspace: Workspace;
  description: string;
}
/** What can be done to one unlocked workspace. Stable across snapshots. */
export interface WorkspaceOperations {
  /** Applies an edit, recording an undo step unless the write is presentation-only. */
  edit: (
    fn: (workspace: Workspace) => Workspace,
    undo?: boolean,
    group?: string,
    description?: string,
  ) => void;
  undo: () => void;
  redo: () => void;
  /** Saves and closes this workspace, dropping its decrypted data and password. */
  lock: () => Promise<void>;
  persist: () => Promise<void>;
  /** Defers saving while a gesture is in progress. */
  pauseAutosave: (paused: boolean) => void;
}
export interface UnlockedWorkspace extends WorkspaceOperations {
  fetchScope: TransactionFetchScope;
  walletPreparation: WalletPreparationCache;
  data: Workspace;
  password: string;
  revision: number;
  savedRevision: number;
  history: UndoEntry[];
  redoHistory: UndoEntry[];
  /** True while this workspace is being saved and closed. It accepts no edits,
   * undo or redo until that finishes. */
  locking: boolean;
  /** Open typing group, so rapid edits under one key coalesce into one undo step. */
  editGroup?: { key: string; at: number };
  /** True while a graph gesture defers saving, so autosave waits for it to finish. */
  autosavePaused: boolean;
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
  private persistence: WorkspacePersistence;
  private idleWaiters = new Map<string, Set<() => void>>();
  private operations = new Map<string, WorkspaceOperations>();

  constructor(persistence: WorkspacePersistence) {
    this.persistence = persistence;
    this.state.saved = this.persistence.getSaved();
    this.state.storageError = this.persistence.initialError;
  }
  getSnapshot = (): StoreState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** One stable set of operations per unlocked workspace, so records can carry
   * them without changing identity on every snapshot. */
  private operationsFor(id: string): WorkspaceOperations {
    const existing = this.operations.get(id);
    if (existing) return existing;
    const bound: WorkspaceOperations = {
      edit: (fn, undo, group, description) => this.update(id, fn, undo, group, description),
      undo: () => this.undo(id),
      redo: () => this.redo(id),
      lock: () => this.lock(id),
      persist: () => this.persist(id),
      pauseAutosave: (paused) => this.pauseAutosave(id, paused),
    };
    this.operations.set(id, bound);
    return bound;
  }
  private patch(update: Partial<StoreState>) {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  /** Replaces one unlocked workspace, leaving the rest of the snapshot untouched. */
  private patchUnlocked(id: string, update: (entry: UnlockedWorkspace) => UnlockedWorkspace) {
    let changed = false;
    const unlocked = this.state.unlocked.map((entry) => {
      if (entry.data.id !== id) return entry;
      const next = update(entry);
      changed ||= next !== entry;
      return next;
    });
    if (changed) this.patch({ unlocked });
  }
  setActiveId = (activeId: string | undefined) => {
    this.patch({ activeId });
  };
  private add(data: Workspace, password: string, alreadySaved: boolean) {
    // The in-flight handle, not the record: a finished lock has already removed
    // its record but may still be settling.
    if (this.locking.has(data.id)) throw new Error('This workspace is currently locking.');
    if (this.state.unlocked.some((s) => s.data.id === data.id)) {
      this.setActiveId(data.id);
      return;
    }
    this.patch({
      unlocked: [
        ...this.state.unlocked,
        {
          ...this.operationsFor(data.id),
          data,
          fetchScope: new TransactionFetchScope(data.network),
          walletPreparation: new WalletPreparationCache(),
          password,
          revision: 0,
          savedRevision: alreadySaved ? 0 : -1,
          locking: false,
          autosavePaused: false,
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
    // An inline-to-IndexedDB migration can replace this entry without editing its
    // workspace. Resolve its current reference only after our queued writes settle.
    const currentEntry = this.state.saved.find((candidate) => candidate.id === entry.id);
    if (!currentEntry) throw new Error('Saved workspace changed; reload before unlocking.');
    entry = currentEntry;
    const data = await this.persistence.unlock(entry, password, signal);
    // Legacy or stale index labels are migrated from the authenticated workspace on save.
    this.add(data, password, entry.publicName === data.name);
  };
  private isLocking(id: string) {
    return this.state.unlocked.some((entry) => entry.data.id === id && entry.locking);
  }
  update = (
    id: string,
    fn: (w: Workspace) => Workspace,
    undo = true,
    group?: string,
    description?: string,
  ) => {
    if (this.isLocking(id)) return;
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
    const previousGroup = current.editGroup;
    const now = Date.now();
    const coalesce = undo && group && previousGroup?.key === group && now - previousGroup.at < 1500;
    const editGroup =
      undo && group ? { key: group, at: now } : undo || evidenceChanged ? undefined : previousGroup;
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
              editGroup,
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
    if (this.isLocking(id)) return;
    this.patch({
      unlocked: this.state.unlocked.map((s) =>
        s.data.id === id && s.history.length
          ? {
              ...s,
              editGroup: undefined,
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
    if (this.isLocking(id)) return;
    this.patch({
      unlocked: this.state.unlocked.map((s) =>
        s.data.id === id && s.redoHistory.length
          ? {
              ...s,
              editGroup: undefined,
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
    this.patchUnlocked(id, (entry) =>
      entry.autosavePaused ? { ...entry, autosavePaused: false } : entry,
    );
    for (const resume of this.idleWaiters.get(id) ?? []) resume();
    this.idleWaiters.delete(id);
  }
  pauseAutosave = (id: string, paused: boolean) => {
    if (paused)
      this.patchUnlocked(id, (entry) =>
        entry.autosavePaused ? entry : { ...entry, autosavePaused: true },
      );
    else {
      this.resumeAutosave(id);
      const session = this.getUnlocked(id);
      if (session && session.revision !== session.savedRevision)
        void this.persist(id, true).catch(() => {});
    }
  };
  private async waitForIdle(id: string) {
    while (this.getUnlocked(id)?.autosavePaused)
      await new Promise<void>((resolve) => {
        const waiters = this.idleWaiters.get(id) ?? new Set();
        waiters.add(resolve);
        this.idleWaiters.set(id, waiters);
      });
  }
  exportEncrypted = async (id: string) => {
    this.resumeAutosave(id);
    const session = this.getUnlocked(id);
    if (!session) throw new Error('This workspace is no longer unlocked.');
    return this.persistence.exportWorkspace(session.data, session.password);
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
          this.persistence.assertCurrent();
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
          const saved = await this.persistence.save(
            session.data,
            session.password,
            automatic
              ? {
                  beforeEncrypt: () => this.waitForIdle(id),
                  beforePublish: () => this.waitForIdle(id),
                }
              : undefined,
          );
          this.patch({
            saved,
            unlocked: this.state.unlocked.map((s) =>
              s.data.id === id ? { ...s, savedRevision: session.revision } : s,
            ),
            storageError: '',
          });
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
        const saved = await this.persistence.remove(id, () => {
          if (this.state.unlocked.some((session) => session.data.id === id))
            throw new Error('Lock this workspace before deleting its saved copy.');
        });
        this.patch({ saved, storageError: '' });
      });
    this.writing = operation;
    return operation;
  };

  lock = (id: string): Promise<void> => {
    const pending = this.locking.get(id);
    if (pending) return pending;
    // No state callbacks are queued: all earlier edits are already in state.
    this.patchUnlocked(id, (entry) => ({ ...entry, locking: true }));
    const operation = Promise.resolve()
      .then(async () => {
        await this.persist(id);
        const current = this.state.unlocked.find((s) => s.data.id === id);
        if (current && current.revision !== current.savedRevision)
          throw new Error('Workspace changed while locking; keep it open and save again.');
        if (current) {
          transactionScheduler.dispose(current.fetchScope);
          current.walletPreparation.dispose();
        }
        this.operations.delete(id);
        this.patch({
          unlocked: this.state.unlocked.filter((s) => s.data.id !== id),
          activeId: this.state.activeId === id ? undefined : this.state.activeId,
        });
      })
      .finally(() => {
        this.locking.delete(id);
        // A failed lock leaves the workspace open, so it must accept edits again.
        this.patchUnlocked(id, (entry) => (entry.locking ? { ...entry, locking: false } : entry));
      });
    this.locking.set(id, operation);
    return operation;
  };
}
