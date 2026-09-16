import { graphNavigationTransactionIds, resolveGraphHandoff } from '../graphHandoffNavigation';
import { txNodeId } from '../../../../Domain/Metadata/entityReferences';
import type { Workspace } from '../../workspace';

import type { WorkbenchMode, WorkbenchSwitchOptions } from '../../workbenchTypes';
import type { WorkspaceCore } from '../../workspaceCore';

import type { GraphHandoff } from '../workbenchHandoff';
import type { TransactionEvidence } from '../../Evidence/Transactions';
import type { WorkspaceOperation } from '../../useWorkspaceOperation';

interface AnalysisActionRuntime {
  /** Captures the current selection generation and verifies it after asynchronous work. */
  captureCurrent: (workspaceId: string) => () => boolean;
  hasActiveOperation: () => boolean;
  switchWorkbench: (next: WorkbenchMode, options?: WorkbenchSwitchOptions) => void;
}

interface Inputs {
  activeWorkspace: Workspace | undefined;
  workspaces: WorkspaceCore['workspaces'];
  setNotice: WorkspaceCore['setNotice'];
  handoff: GraphHandoff;
  transactions: TransactionEvidence;
  operation: WorkspaceOperation;
  canLoadChainData: boolean;
}
export function createAnalysisActions({
  activeWorkspace,
  workspaces,
  setNotice,
  handoff,
  transactions,
  operation,
  canLoadChainData,
}: Inputs) {
  const { showOnGraph, loadGraphTransactions } = handoff;
  const { recordTransactions } = transactions;
  const { run } = operation;

  function showFindingOnGraph(
    runtime: AnalysisActionRuntime,
    ids: string[],
    isolate = false,
    supportingTxids: string[] = [],
  ) {
    const current = activeWorkspace && workspaces.getUnlocked(activeWorkspace.id)?.data;
    if (!current) return false;
    const target = resolveGraphHandoff(current, ids, supportingTxids);
    const finish = () => {
      const latest = workspaces.getUnlocked(current.id)?.data;
      const resolved = latest && resolveGraphHandoff(latest, ids, supportingTxids);
      if (!resolved) return false;
      workspaces.getUnlocked(current.id)?.edit(() => resolved.workspace, false);
      if (!showOnGraph(resolved.ids, { isolate, selectedId: resolved.selectedId })) return false;
      runtime.switchWorkbench('graph', { interaction: 'handoff', focus: 'stage' });
      return true;
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
      recordTransactions(current.id, loaded, { promotionIds: missing });
      if (!finish()) setNotice('The requested entity is not present in its transaction.');
    });
    return true;
  }
  return { showFindingOnGraph };
}
