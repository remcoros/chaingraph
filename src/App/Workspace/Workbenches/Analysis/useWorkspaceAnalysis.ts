import { useEffect, useState } from 'react';
import type { AppState } from '../../../useAppState';
import type { AnalysisSession } from './analysisSession';

/**
 * Retained analysis state across workbench switches.
 */
export interface WorkspaceAnalysis {
  /**
   * Retained session per workspace, dropped when that workspace locks.
   *
   * One map for the life of the workspace controller, mutated in place. Held as
   * state rather than a ref so reading it while rendering is not a ref read.
   */
  sessions: Map<string, AnalysisSession>;
}

export function useWorkspaceAnalysis(
  openWorkspaces: AppState['workspaces']['unlocked'],
): WorkspaceAnalysis {
  const [sessions] = useState(() => new Map<string, AnalysisSession>());
  useEffect(() => {
    const unlocked = new Set(openWorkspaces.map((entry) => entry.data.id));
    for (const id of sessions.keys()) if (!unlocked.has(id)) sessions.delete(id);
  }, [openWorkspaces, sessions]);
  return {
    sessions,
  };
}
