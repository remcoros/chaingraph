import { useEffect, useState } from 'react';
import type { AppState } from '../../../useAppState';
import type { AnalysisSession } from './analysisSession';

/**
 * Retained analysis state across workbench switches.
 *
 * A scan started in the Wallet workbench lands in the same cache the Analysis
 * workbench reads, so the revision is what tells Analysis to pick a new one up.
 */
export interface WorkspaceAnalysis {
  /**
   * Retained session per workspace, dropped when that workspace locks.
   *
   * One map for the life of the workspace controller, mutated in place. Held as
   * state rather than a ref so reading it while rendering is not a ref read.
   */
  sessions: Map<string, AnalysisSession>;
  /** Changes when a wallet-run analysis produces a new session. */
  walletRevision: number;
  noteWalletAnalysis: () => void;
}

export function useWorkspaceAnalysis(
  openWorkspaces: AppState['workspaces']['unlocked'],
): WorkspaceAnalysis {
  const [sessions] = useState(() => new Map<string, AnalysisSession>());
  const [walletRevision, setWalletRevision] = useState(0);
  useEffect(() => {
    const unlocked = new Set(openWorkspaces.map((entry) => entry.data.id));
    for (const id of sessions.keys()) if (!unlocked.has(id)) sessions.delete(id);
  }, [openWorkspaces, sessions]);
  return {
    sessions,
    walletRevision,
    noteWalletAnalysis: () => setWalletRevision((revision) => revision + 1),
  };
}
