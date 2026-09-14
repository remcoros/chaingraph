import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../useAppState';
import type { AnalysisSession } from './analysisSession';

/**
 * Retained analysis state across workbench switches.
 *
 * A scan started in the Wallet workbench lands in the same cache the Analysis
 * workbench reads, so the revision is what tells Analysis to pick a new one up.
 */
export interface WorkspaceAnalysis {
  /** Retained session per workspace, dropped when that workspace locks. */
  sessions: React.RefObject<Map<string, AnalysisSession>>;
  /** Changes when a wallet-run analysis produces a new session. */
  walletRevision: number;
  noteWalletAnalysis: () => void;
  /** The analysis workbench section, for focus moves and handoff returns. */
  sectionRef: React.RefObject<HTMLElement | null>;
}

export function useWorkspaceAnalysis(openSessions: AppState['ws']['sessions']): WorkspaceAnalysis {
  const sessions = useRef(new Map<string, AnalysisSession>());
  const [walletRevision, setWalletRevision] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const unlocked = new Set(openSessions.map((session) => session.data.id));
    for (const id of sessions.current.keys()) if (!unlocked.has(id)) sessions.current.delete(id);
  }, [openSessions]);
  return {
    sessions,
    walletRevision,
    noteWalletAnalysis: () => setWalletRevision((revision) => revision + 1),
    sectionRef,
  };
}
