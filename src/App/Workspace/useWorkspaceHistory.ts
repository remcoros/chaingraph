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
  w: AppState['w'];
  ws: AppState['ws'];
}

export function useWorkspaceHistory({ w, ws }: Inputs) {
  const undoDescription = ws.active?.history.at(-1)?.description;
  const redoDescription = ws.active?.redoHistory.at(-1)?.description;
  return {
    canUndo: !!ws.active?.history.length,
    canRedo: !!ws.active?.redoHistory.length,
    undo: () => {
      if (w) ws.undo(w.id);
    },
    redo: () => {
      if (w) ws.redo(w.id);
    },
    undoLabel: undoDescription ? `Undo: ${undoDescription}` : 'Nothing to undo',
    redoLabel: redoDescription ? `Redo: ${redoDescription}` : 'Nothing to redo',
    token: ws.getSession(w?.id ?? '')?.undoRevision ?? 0,
    undoDescription,
  } satisfies WorkspaceHistory;
}
