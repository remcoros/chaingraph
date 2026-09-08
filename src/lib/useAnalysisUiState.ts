import { useCallback, useEffect, useRef, useState } from 'react';
import {
  analysisTools,
  defaultsFor,
  type AnalysisOptions,
  type AnalysisRunReport,
  type AnalysisScope,
} from '../domain/analysis';

export interface AnalysisUiRunReport extends AnalysisRunReport {
  inputScope?: AnalysisScope;
  inputOptions?: AnalysisOptions;
  runAt?: string;
}
export interface AnalysisUiState {
  query: string;
  scope: AnalysisScope;
  options: Record<string, AnalysisOptions>;
  resultQuery: string;
  resultKind: string;
  resultState: string;
  resultTool: string;
  limit: number;
  expandedTools: Record<string, boolean>;
}
export function createAnalysisUiState(): AnalysisUiState {
  return {
    query: '',
    scope: 'graph',
    options: Object.fromEntries(analysisTools.map((tool) => [tool.id, defaultsFor(tool)])),
    resultQuery: '',
    resultKind: 'all',
    resultState: 'all',
    resultTool: 'all',
    limit: 30,
    expandedTools: {},
  };
}

/** Temporary controls and incomplete numeric drafts stay in memory while the workspace is unlocked. */
export function useAnalysisUiState(
  workspaceId: string | undefined,
  unlockedWorkspaceIds: readonly string[],
) {
  const [states, setStates] = useState<Record<string, AnalysisUiState>>({});
  const fallback = useRef(createAnalysisUiState());
  const unlocked = new Set(unlockedWorkspaceIds);
  const activeIds = useRef(unlocked);
  activeIds.current = unlocked;
  const key = JSON.stringify([...unlocked].sort());
  useEffect(() => {
    setStates((previous) => {
      if (Object.keys(previous).every((id) => activeIds.current.has(id))) return previous;
      return Object.fromEntries(
        Object.entries(previous).filter(([id]) => activeIds.current.has(id)),
      );
    });
  }, [key]);
  const update = useCallback(
    (change: (state: AnalysisUiState) => AnalysisUiState) => {
      if (!workspaceId || !activeIds.current.has(workspaceId)) return;
      setStates((previous) => ({
        ...previous,
        [workspaceId]: change(previous[workspaceId] ?? createAnalysisUiState()),
      }));
    },
    [workspaceId],
  );
  return {
    state:
      workspaceId && unlocked.has(workspaceId)
        ? (states[workspaceId] ?? fallback.current)
        : fallback.current,
    update,
  };
}
