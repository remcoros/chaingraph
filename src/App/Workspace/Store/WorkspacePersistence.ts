import type { SavedWorkspace, WorkspaceExport } from '../savedWorkspace';
import type { Workspace } from '../workspace';

export interface WorkspaceSaveHooks {
  /** Runs when a queued encryption job is actually ready to capture its input. */
  beforeEncrypt?: () => Promise<void>;
  /** Runs after encryption but before the durable browser index is published. */
  beforePublish?: () => Promise<void>;
}

/** Durable operations required by WorkspaceStore, independent of browser mechanisms. */
export interface WorkspacePersistence {
  readonly initialError: string;
  getSaved(): SavedWorkspace[];
  assertCurrent(): void;
  unlock(entry: SavedWorkspace, password: string, signal?: AbortSignal): Promise<Workspace>;
  save(
    workspace: Workspace,
    password: string,
    hooks?: WorkspaceSaveHooks,
  ): Promise<SavedWorkspace[]>;
  exportWorkspace(workspace: Workspace, password: string): Promise<WorkspaceExport>;
  remove(id: string, precondition?: () => void): Promise<SavedWorkspace[]>;
}
