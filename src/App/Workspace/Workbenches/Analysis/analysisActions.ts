import {
  graphNavigationTransactionIds,
  resolveGraphHandoff,
} from '../../../../Domain/Graph/graphHandoff';
import { txNodeId } from '../../../../Domain/types';
import type { Dispatch, SetStateAction, RefObject } from 'react';

import type { WorkbenchMode } from '../../workbenchTypes';

import type { AppState } from '../../../useAppState';
import type { GraphHandoff } from '../workbenchHandoff';
import type { WorkspaceEvidence } from '../../ChainData/useWorkspaceEvidence';
interface Inputs {
  activeWorkspace: AppState['activeWorkspace'];
  workspaces: AppState['workspaces'];
  recordHandoffInvoker: (origin: 'analysis' | 'wallet') => void;
  setReturnWorkbench: Dispatch<SetStateAction<WorkbenchMode | undefined>>;
  switchWorkbench: (next: WorkbenchMode, handoffFocus?: boolean, destination?: 'inspector') => void;
  showOnGraph: GraphHandoff['showOnGraph'];
  canLoadChainData: boolean;
  operationRef: RefObject<AbortController | undefined>;
  selectionGeneration: RefObject<number>;
  loadGraphTransactions: GraphHandoff['loadGraphTransactions'];
  activeWorkspaceRef: AppState['activeWorkspaceRef'];
  mergeTransactions: WorkspaceEvidence['mergeTransactions'];
  setNotice: AppState['setNotice'];
  run: WorkspaceEvidence['run'];
}
export function createAnalysisActions({
  activeWorkspace,
  workspaces,
  recordHandoffInvoker,
  setReturnWorkbench,
  switchWorkbench,
  showOnGraph,
  canLoadChainData,
  operationRef,
  selectionGeneration,
  loadGraphTransactions,
  activeWorkspaceRef,
  mergeTransactions,
  setNotice,
  run,
}: Inputs) {
  function showFindingOnGraph(ids: string[], isolate = false, supportingTxids: string[] = []) {
    const current = activeWorkspace && workspaces.getUnlocked(activeWorkspace.id)?.data;
    if (!current) return false;
    const target = resolveGraphHandoff(current, ids, supportingTxids);
    recordHandoffInvoker('analysis');
    const finish = () => {
      const latest = workspaces.getUnlocked(current.id)?.data;
      const resolved = latest && resolveGraphHandoff(latest, ids, supportingTxids);
      if (!resolved) return false;
      workspaces.update(current.id, () => resolved.workspace, false);
      setReturnWorkbench('analysis');
      switchWorkbench('graph', true);
      return showOnGraph(resolved.ids, { isolate, selectedId: resolved.selectedId });
    };
    const unresolved = ids.length
      ? ids.filter((id) => !target?.ids.includes(id))
      : target
        ? []
        : supportingTxids.map(txNodeId);
    if (!unresolved.length) return finish();
    const missing = graphNavigationTransactionIds(unresolved).filter(
      (id) => !current.transactions[id],
    );
    if (!missing.length || !canLoadChainData || operationRef.current) return false;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const loaded = await loadGraphTransactions(unresolved, signal);
      signal.throwIfAborted();
      if (
        activeWorkspaceRef.current?.id !== current.id ||
        selectionGeneration.current !== generation
      )
        return;
      mergeTransactions(current.id, loaded, missing);
      if (!finish()) setNotice('The requested entity is not present in its transaction.');
    });
    return true;
  }
  return { showFindingOnGraph };
}
