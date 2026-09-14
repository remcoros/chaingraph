import { useEffect, useMemo, useState } from 'react';
import {
  planEntityRemoval,
  removeWorkspaceEntity,
  type EntityRemovalPlan,
} from '../../Domain/Workspace/entityRemoval';
import { addressNodeId, txNodeId, type Workspace } from '../../Domain/types';
import { buildGraph } from '../../Domain/Workspace/workspace';
import type { AppState } from '../useAppState';

/** The workspace fields a removal plan is derived from. */
type RemovalInput = Pick<
  Workspace,
  | 'network'
  | 'transactions'
  | 'inputContext'
  | 'contextTransactionIds'
  | 'annotations'
  | 'tags'
  | 'wallets'
  | 'watchedAddresses'
>;

export interface EntityRemoval {
  /** Removal awaiting confirmation, when the plan asks for one. */
  pending: { workspaceId: string; nodeId: string } | undefined;
  /** What removing the pending entity would affect. */
  plan: EntityRemovalPlan | undefined;
  /** What removing the current selection would affect. */
  selectedPlan: EntityRemovalPlan | undefined;
  /** Entities that can be removed at all: loaded transactions and watched addresses. */
  removableNodeIds: string[];
  /** Starts removal, confirming first only when the plan requires it. */
  request: (nodeId?: string) => void;
  confirm: (workspaceId: string, nodeId: string) => void;
  cancel: () => void;
}

interface Inputs {
  activeWorkspace: AppState['activeWorkspace'];
  activeWorkspaceRef: AppState['activeWorkspaceRef'];
  workspaces: AppState['workspaces'];
  workspaceId: string | undefined;
  selectedId: string | undefined;
  setSelectedId: (id: string | undefined) => void;
  clearFocusRequest: () => void;
  setNotice: AppState['setNotice'];
}

function planFor(input: RemovalInput | undefined, nodeId: string) {
  return input ? planEntityRemoval(input as Workspace, nodeId) : undefined;
}

export function useEntityRemoval({
  activeWorkspace,
  activeWorkspaceRef,
  workspaces,
  workspaceId,
  selectedId,
  setSelectedId,
  clearFocusRequest,
  setNotice,
}: Inputs): EntityRemoval {
  const [pending, setPending] = useState<{ workspaceId: string; nodeId: string }>();
  const network = activeWorkspace?.network;
  const transactions = activeWorkspace?.transactions;
  const inputContext = activeWorkspace?.inputContext;
  const contextTransactionIds = activeWorkspace?.contextTransactionIds;
  const annotations = activeWorkspace?.annotations;
  const tags = activeWorkspace?.tags;
  const wallets = activeWorkspace?.wallets;
  const watchedAddresses = activeWorkspace?.watchedAddresses;
  const input = useMemo<RemovalInput | undefined>(() => {
    if (!network || !transactions || !annotations || !wallets || !watchedAddresses)
      return undefined;
    return {
      network,
      transactions,
      inputContext,
      contextTransactionIds,
      annotations,
      tags,
      wallets,
      watchedAddresses,
    };
  }, [
    network,
    transactions,
    inputContext,
    contextTransactionIds,
    annotations,
    tags,
    wallets,
    watchedAddresses,
  ]);
  const plan = useMemo(() => {
    if (!pending || pending.workspaceId !== workspaceId) return undefined;
    return planFor(input, pending.nodeId);
  }, [workspaceId, input, pending]);
  const selectedPlan = useMemo(
    () => (selectedId ? planFor(input, selectedId) : undefined),
    [input, selectedId],
  );
  const hasPlan = plan !== undefined;
  // A pending removal cannot outlive its plan, so switching or locking a
  // workspace clears it without a separate reset step.
  useEffect(() => {
    if (pending && !hasPlan) setPending(undefined);
  }, [pending, hasPlan]);
  const removableNodeIds = useMemo(
    () =>
      transactions && watchedAddresses
        ? [...Object.keys(transactions).map(txNodeId), ...watchedAddresses.map(addressNodeId)]
        : [],
    [transactions, watchedAddresses],
  );
  const confirm = (targetWorkspaceId: string, nodeId: string) => {
    const current = activeWorkspaceRef.current;
    if (!current || current.id !== targetWorkspaceId) {
      setPending(undefined);
      return;
    }
    const resolved = planEntityRemoval(current, nodeId);
    if (!resolved) {
      setPending(undefined);
      return;
    }
    workspaces.update(targetWorkspaceId, (latest) => removeWorkspaceEntity(latest, nodeId));
    setPending(undefined);
    const remaining = workspaces.getUnlocked(targetWorkspaceId)?.data;
    if (
      resolved.kind === 'transaction' &&
      selectedId &&
      (resolved.affectedNodeIds.includes(selectedId) ||
        !remaining ||
        !buildGraph(remaining).nodes.some((node) => node.id === selectedId))
    ) {
      setSelectedId(undefined);
      clearFocusRequest();
    }
    setNotice(
      resolved.kind === 'transaction'
        ? `Transaction removed${resolved.automaticContextCount ? ` with ${resolved.automaticContextCount} unused input context transaction${resolved.automaticContextCount === 1 ? '' : 's'}` : ''}. Shared, independently added or annotated context is retained. Undo restores the removed data.`
        : 'Address is no longer watched. Loaded transactions remain. Undo restores the watch and annotations.',
    );
  };
  return {
    pending,
    plan,
    selectedPlan,
    removableNodeIds,
    request: (nodeId = selectedId) => {
      const current = activeWorkspaceRef.current;
      if (!current || !nodeId) return;
      const resolved = planEntityRemoval(current, nodeId);
      if (!resolved) return;
      if (resolved.requiresConfirmation)
        setPending({ workspaceId: current.id, nodeId: resolved.nodeId });
      else confirm(current.id, resolved.nodeId);
    },
    confirm,
    cancel: () => setPending(undefined),
  };
}
