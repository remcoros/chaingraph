import {
  graphNavigationTransactionIds,
  resolveGraphHandoff,
} from '../../../../Domain/Graph/graphHandoff';
import { txNodeId, type Workspace } from '../../../../Domain/types';
import type { Dispatch, SetStateAction } from 'react';

import type { WorkbenchMode } from '../../workbenchTypes';
import type { WorkspaceCore } from '../../workspaceCore';

import type { GraphHandoff } from '../workbenchHandoff';
import type { ChainFetch } from '../../ChainData/useChainFetch';

interface AnalysisActionRuntime {
  /** Captures the current selection generation and verifies it after asynchronous work. */
  captureCurrent: (workspaceId: string) => () => boolean;
  hasActiveOperation: () => boolean;
  recordHandoffInvoker: (origin: 'analysis' | 'wallet') => void;
  switchWorkbench: (next: WorkbenchMode, handoffFocus?: boolean, destination?: 'inspector') => void;
}

interface Inputs {
  activeWorkspace: Workspace | undefined;
  workspaces: WorkspaceCore['workspaces'];
  setNotice: WorkspaceCore['setNotice'];
  handoff: GraphHandoff;
  fetch: ChainFetch;
  canLoadChainData: boolean;
  setReturnWorkbench: Dispatch<SetStateAction<WorkbenchMode | undefined>>;
}
export function createAnalysisActions({
  activeWorkspace,
  workspaces,
  setNotice,
  handoff,
  fetch,
  canLoadChainData,
  setReturnWorkbench,
}: Inputs) {
  const { showOnGraph, loadGraphTransactions } = handoff;
  const { mergeTransactions, run } = fetch;

  function showFindingOnGraph(
    runtime: AnalysisActionRuntime,
    ids: string[],
    isolate = false,
    supportingTxids: string[] = [],
  ) {
    const current = activeWorkspace && workspaces.getUnlocked(activeWorkspace.id)?.data;
    if (!current) return false;
    const target = resolveGraphHandoff(current, ids, supportingTxids);
    runtime.recordHandoffInvoker('analysis');
    const finish = () => {
      const latest = workspaces.getUnlocked(current.id)?.data;
      const resolved = latest && resolveGraphHandoff(latest, ids, supportingTxids);
      if (!resolved) return false;
      workspaces.getUnlocked(current.id)?.edit(() => resolved.workspace, false);
      setReturnWorkbench('analysis');
      runtime.switchWorkbench('graph', true);
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
    if (!missing.length || !canLoadChainData || runtime.hasActiveOperation()) return false;
    const isCurrent = runtime.captureCurrent(current.id);
    void run(async (signal) => {
      const loaded = await loadGraphTransactions(unresolved, signal);
      signal.throwIfAborted();
      if (!isCurrent()) return;
      mergeTransactions(current.id, loaded, missing);
      if (!finish()) setNotice('The requested entity is not present in its transaction.');
    });
    return true;
  }
  return { showFindingOnGraph };
}
