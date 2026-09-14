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
  workspaces: AppState['workspaces'];
}

export function useWorkspaceHistory({ workspaces }: Inputs) {
  const active = workspaces.active;
  const undoDescription = active?.history.at(-1)?.description;
  const redoDescription = active?.redoHistory.at(-1)?.description;
  return {
    // A locking workspace accepts neither, so the buttons must not offer them.
    canUndo: !!active?.history.length && !active.locking,
    canRedo: !!active?.redoHistory.length && !active.locking,
    undo: () => active?.undo(),
    redo: () => active?.redo(),
    undoLabel: undoDescription ? `Undo: ${undoDescription}` : 'Nothing to undo',
    redoLabel: redoDescription ? `Redo: ${redoDescription}` : 'Nothing to redo',
    token: active?.undoRevision ?? 0,
    undoDescription,
  } satisfies WorkspaceHistory;
}
