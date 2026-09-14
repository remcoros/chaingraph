import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Workspace } from '../../../../Domain/types';
import type { AppState } from '../../../useAppState';

/** A request to move the camera to one entity. */
export interface GraphFocusRequest {
  id: string;
  token: number;
  preserveZoom?: boolean;
}

/**
 * Camera and saved-view state for the graph canvas, separate from what the
 * canvas shows, which the graph projection derives.
 */
export interface GraphCanvas {
  focusRequest: GraphFocusRequest | undefined;
  setFocusRequest: Dispatch<SetStateAction<GraphFocusRequest | undefined>>;
  clearFocus: () => void;
  /** Bumped to fit the whole graph in view. */
  fitToken: number;
  fitAll: () => void;
  /** Applies a view change without creating an undo step. */
  changeView: (update: (view: Workspace['view']) => Workspace['view']) => void;
  /** Lets the renderer offer its snapshot so a save or lock can capture the latest view. */
  registerSnapshotFlush: AppState['registerGraphSnapshotFlush'];
  /** Captures the active canvas snapshot, returning the workspace it belongs to. */
  flushActive: AppState['flushActiveGraph'];
  /** Workspace whose snapshot is still being written. */
  pendingWorkspaceId: AppState['pendingGraphWorkspace'];
  setPendingWorkspaceId: AppState['setPendingGraphWorkspace'];
}

interface Inputs {
  workspaceId: string | undefined;
  getUnlockedWorkspace: AppState['getUnlockedWorkspace'];
  registerSnapshotFlush: AppState['registerGraphSnapshotFlush'];
  flushActive: AppState['flushActiveGraph'];
  pendingWorkspaceId: AppState['pendingGraphWorkspace'];
  setPendingWorkspaceId: AppState['setPendingGraphWorkspace'];
}

export function useGraphCanvas({
  workspaceId,
  getUnlockedWorkspace,
  registerSnapshotFlush,
  flushActive,
  pendingWorkspaceId,
  setPendingWorkspaceId,
}: Inputs): GraphCanvas {
  const [focusRequest, setFocusRequest] = useState<GraphFocusRequest>();
  const [fitToken, setFitToken] = useState(0);
  return {
    focusRequest,
    setFocusRequest,
    clearFocus: () => setFocusRequest(undefined),
    fitToken,
    fitAll: () => setFitToken((token) => token + 1),
    changeView: (update) => {
      if (!workspaceId) return;
      getUnlockedWorkspace(workspaceId)?.edit((workspace) => {
        const view = update(workspace.view);
        return view === workspace.view ? workspace : { ...workspace, view };
      }, false);
    },
    registerSnapshotFlush,
    flushActive,
    pendingWorkspaceId,
    setPendingWorkspaceId,
  };
}
