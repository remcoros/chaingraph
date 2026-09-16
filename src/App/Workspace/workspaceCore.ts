import type { Workspace } from '../../Domain/Workspace/workspaceTypes';
import type { AppState } from '../useAppState';

/**
 * The services every workspace concept needs: the workspace being worked on, the
 * sanctioned way to change it, and how to report progress or a problem.
 *
 * Concepts take this rather than a handful of loose callbacks, so gaining a need
 * does not change every hook signature between here and the caller.
 */
export interface WorkspaceCore {
  activeWorkspace: AppState['activeWorkspace'];
  /** The latest workspace, for asynchronous work that outlives a render. */
  activeWorkspaceRef: AppState['activeWorkspaceRef'];
  workspaceId: string | undefined;
  /** Reaching any unlocked workspace, including one an async job started on. */
  workspaces: AppState['workspaces'];
  /** Applies an edit to the active workspace, with undo, autosave and lock rules. */
  edit: (
    fn: (workspace: Workspace) => Workspace,
    undo?: boolean,
    group?: string,
    description?: string,
  ) => void;
  setNotice: AppState['setNotice'];
  setError: AppState['setError'];
  setOperation: React.Dispatch<React.SetStateAction<string>>;
}
