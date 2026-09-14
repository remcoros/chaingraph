import {
  graphNavigationTransactionIds,
  resolveGraphHandoff,
} from '../../../../Domain/Graph/graphHandoff';
import { txNodeId } from '../../../../Domain/types';
import type { Dispatch, SetStateAction, RefObject } from 'react';

import type { WorkbenchMode } from '../../workbenchTypes';

interface Inputs {
  w: ReturnType<typeof import('../../../useAppState').useAppState>['w'];
  ws: ReturnType<typeof import('../../../useAppState').useAppState>['ws'];
  recordHandoffInvoker: (origin: 'analysis' | 'wallet') => void;
  setReturnWorkbench: Dispatch<SetStateAction<WorkbenchMode | undefined>>;
  switchWorkbench: (next: WorkbenchMode, handoffFocus?: boolean, destination?: 'inspector') => void;
  showOnGraph: ReturnType<typeof import('../Graph/useGraphActions').useGraphActions>['showOnGraph'];
  canQuery: boolean;
  operationRef: RefObject<AbortController | undefined>;
  selectionGeneration: RefObject<number>;
  loadGraphTransactions: ReturnType<
    typeof import('../Graph/useGraphActions').useGraphActions
  >['loadGraphTransactions'];
  wRef: ReturnType<typeof import('../../../useAppState').useAppState>['wRef'];
  mergeTransactions: ReturnType<
    typeof import('../../ChainData/useWorkspaceEvidence').useWorkspaceEvidence
  >['mergeTransactions'];
  setNotice: ReturnType<typeof import('../../../useAppState').useAppState>['setNotice'];
  run: ReturnType<
    typeof import('../../ChainData/useWorkspaceEvidence').useWorkspaceEvidence
  >['run'];
}
export function createAnalysisActions({
  w,
  ws,
  recordHandoffInvoker,
  setReturnWorkbench,
  switchWorkbench,
  showOnGraph,
  canQuery,
  operationRef,
  selectionGeneration,
  loadGraphTransactions,
  wRef,
  mergeTransactions,
  setNotice,
  run,
}: Inputs) {
  function showFindingOnGraph(ids: string[], isolate = false, supportingTxids: string[] = []) {
    const current = w && ws.getSession(w.id)?.data;
    if (!current) return false;
    const target = resolveGraphHandoff(current, ids, supportingTxids);
    recordHandoffInvoker('analysis');
    const finish = () => {
      const latest = ws.getSession(current.id)?.data;
      const resolved = latest && resolveGraphHandoff(latest, ids, supportingTxids);
      if (!resolved) return false;
      ws.update(current.id, () => resolved.workspace, false);
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
    if (!missing.length || !canQuery || operationRef.current) return false;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const loaded = await loadGraphTransactions(unresolved, signal);
      signal.throwIfAborted();
      if (wRef.current?.id !== current.id || selectionGeneration.current !== generation) return;
      mergeTransactions(current.id, loaded, missing);
      if (!finish()) setNotice('The requested entity is not present in its transaction.');
    });
    return true;
  }
  return { showFindingOnGraph };
}
