import type { Workspace } from '../workspace';
import type { SavedWorkspace, WorkspaceExport } from './savedWorkspace';
import { WorkspaceStorage, type WorkspaceStorageOptions } from './Browser/workspaceStorage';
import type { decryptWorkspace, encryptWorkspace } from './Codec/encryptedEnvelope';
import { parseWorkspace } from './Codec/parseWorkspace';
import { validateAndEncryptWorkspace } from './Codec/workspaceCodec';
import { decryptWorkspaceOffThread, encryptWorkspaceOffThread } from './Codec/workspaceCodecClient';

export interface WorkspaceSaveHooks {
  /** Capture the latest view only when the queued encoding job can start. */
  beforeEncrypt?: () => Promise<void>;
  /** Recheck the session and gesture state before durable publication. */
  beforePublish?: () => Promise<void>;
}

/** Durable workspace operations. Session lifetime and passwords are caller-owned. */
export interface WorkspacePersistence {
  readonly initialError: string;
  list(): SavedWorkspace[];
  assertCurrent(): void;
  load(entry: SavedWorkspace, password: string, signal?: AbortSignal): Promise<Workspace>;
  save(
    workspace: Workspace,
    password: string,
    hooks?: WorkspaceSaveHooks,
  ): Promise<SavedWorkspace[]>;
  remove(id: string, precondition?: () => void): Promise<SavedWorkspace[]>;
  readFile(input: Blob, password: string, signal?: AbortSignal): Promise<Workspace>;
  exportFile(workspace: Workspace, password: string): Promise<WorkspaceExport>;
}

/** Private injection seam for persistence behavior tests, not exported by the module. */
export interface WorkspacePersistenceOptions extends WorkspaceStorageOptions {
  encrypt?: typeof encryptWorkspace;
  decrypt?: typeof decryptWorkspace;
}

/** Owns document processing and publication without giving file callers a storage dependency. */
export class WorkspacePersistenceImplementation implements WorkspacePersistence {
  private browser?: WorkspaceStorage;
  constructor(private readonly options: WorkspacePersistenceOptions = {}) {}

  private storage(): WorkspaceStorage {
    return (this.browser ??= new WorkspaceStorage(this.options));
  }
  get initialError(): string {
    return this.storage().initialError;
  }
  list(): SavedWorkspace[] {
    return this.storage().getSaved();
  }
  assertCurrent(): void {
    this.storage().assertCurrent();
  }

  private async encode(workspace: Workspace, password: string, beforeStart?: () => Promise<void>) {
    if (!this.options.encrypt) return encryptWorkspaceOffThread(workspace, password, beforeStart);
    await beforeStart?.();
    return validateAndEncryptWorkspace(workspace, password, this.options.encrypt);
  }

  async load(entry: SavedWorkspace, password: string, signal?: AbortSignal): Promise<Workspace> {
    const snapshot = await this.storage().read(entry, signal);
    const workspace = this.options.decrypt
      ? parseWorkspace(await this.options.decrypt(snapshot.envelope, password))
      : await decryptWorkspaceOffThread(snapshot.envelope, password, signal);
    signal?.throwIfAborted();
    if (workspace.id !== entry.id)
      throw new Error('Workspace identity does not match its encrypted contents.');
    snapshot.assertUnchanged();
    return workspace;
  }

  async save(
    workspace: Workspace,
    password: string,
    hooks: WorkspaceSaveHooks = {},
  ): Promise<SavedWorkspace[]> {
    // Capture the storage revision before asynchronous encoding, never after another tab publishes.
    const storage = this.storage();
    const envelope = await this.encode(workspace, password, hooks.beforeEncrypt);
    await hooks.beforePublish?.();
    await storage.publishWorkspace(workspace, envelope);
    return storage.getSaved();
  }
  remove(id: string, precondition?: () => void): Promise<SavedWorkspace[]> {
    return this.storage().remove(id, precondition);
  }
  readFile(input: Blob, password: string, signal?: AbortSignal): Promise<Workspace> {
    return decryptWorkspaceOffThread(input, password, signal);
  }
  async exportFile(workspace: Workspace, password: string): Promise<WorkspaceExport> {
    const envelope = await this.encode(workspace, password);
    return { name: workspace.name, contents: JSON.stringify(envelope) };
  }
}

export function createWorkspacePersistence(): WorkspacePersistence {
  return new WorkspacePersistenceImplementation();
}
