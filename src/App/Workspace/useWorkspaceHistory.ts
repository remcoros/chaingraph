import type { Workspace } from '../../Domain/types';
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
  /**
   * Applies a batch as one undo step. Returns its token when something changed,
   * so a caller can offer to undo exactly that batch.
   */
  applyBatch: (summary: string, update: (data: Workspace) => Workspace) => number | undefined;
}

interface Inputs {
  w: AppState['w'];
  ws: AppState['ws'];
  change: (fn: (data: Workspace) => Workspace) => void;
  setError: AppState['setError'];
  setNotice: AppState['setNotice'];
}

export function useWorkspaceHistory({ w, ws, change, setError, setNotice }: Inputs) {
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
    applyBatch: (summary: string, update: (data: Workspace) => Workspace) => {
      if (!w) return undefined;
      const before = ws.getSession(w.id)?.undoRevision;
      try {
        // A single workspace update keeps one Undo step for the whole batch.
        change(update);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : 'The batch edit could not be applied.',
        );
        return undefined;
      }
      const after = ws.getSession(w.id)?.undoRevision;
      setError('');
      if (after === undefined || after === before) {
        // Nothing changed, so no undo step exists and none is offered.
        setNotice('That batch left every selected entity unchanged.');
        return undefined;
      }
      setNotice(`${summary}. Undo restores the previous values.`);
      return after;
    },
  } satisfies WorkspaceHistory;
}
