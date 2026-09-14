import type { AppState } from '../useAppState';

/** Undo, redo and the batch edits that produce a single undo step. */
export interface WorkspaceHistory {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  undoLabel: string;
  redoLabel: string;
  /** Undo revision of the loaded workspace, identifying one undoable step. */
  token: number;
  undoDescription: string | undefined;
}

interface Inputs {
  activeWorkspace: AppState['activeWorkspace'];
  workspaces: AppState['workspaces'];
}

export function useWorkspaceHistory({ activeWorkspace, workspaces }: Inputs) {
  const undoDescription = workspaces.active?.history.at(-1)?.description;
  const redoDescription = workspaces.active?.redoHistory.at(-1)?.description;
  return {
    canUndo: !!workspaces.active?.history.length,
    canRedo: !!workspaces.active?.redoHistory.length,
    undo: () => {
      if (activeWorkspace) workspaces.undo(activeWorkspace.id);
    },
    redo: () => {
      if (activeWorkspace) workspaces.redo(activeWorkspace.id);
    },
    undoLabel: undoDescription ? `Undo: ${undoDescription}` : 'Nothing to undo',
    redoLabel: redoDescription ? `Redo: ${redoDescription}` : 'Nothing to redo',
    token: workspaces.getUnlocked(activeWorkspace?.id ?? '')?.undoRevision ?? 0,
    undoDescription,
  } satisfies WorkspaceHistory;
}
