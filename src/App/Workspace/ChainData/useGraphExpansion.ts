import { spendingNotice } from './spendingNotice';
import { addGraphNodes } from '../../../Domain/Graph/graphMembership';
import { useEffect, useRef } from 'react';
import { type GraphData, type GraphFilters } from '../../../Domain/types';
import type { AppState } from '../../useAppState';
import type { WorkspaceCore } from '../workspaceCore';
import type { WorkspaceSelection } from '../Selection/useWorkspaceSelection';
import { setNodesHidden } from '../../../Domain/Graph/visibility';
import { buildGraph } from '../../../Domain/Workspace/workspace';
import { openFlowPanel } from '../../../Domain/Workspace/panelState';
import { outputNodeId, txNodeId } from '../../../Domain/types';
import { loadSpending } from '../../../Infra/Bitcoin/api';
import { ancestryNotice, loadAncestors, traceSourceExists } from '../../../Infra/Bitcoin/tracing';
import type { Dispatch, SetStateAction } from 'react';

import type { ChainFetch } from './useChainFetch';

interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  fetch: ChainFetch;
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  setFocusRequest: Dispatch<
    SetStateAction<{ id: string; token: number; preserveZoom?: boolean } | undefined>
  >;
  recoveryGraph: GraphData;
  fetchScope: AppState['fetchScope'];
  canTraceAncestry: boolean;
}

/** Following funding and spending outward from what is already loaded. */
export function useGraphExpansion({
  core,
  selection,
  fetch,
  setGraphFilters,
  setFocusRequest,
  recoveryGraph,
  fetchScope,
  canTraceAncestry,
}: Inputs) {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setNotice } = core;
  const { getUnlocked } = workspaces;
  const {
    generation: selectionGeneration,
    preserveCamera: preserveSelectionCamera,
    select,
    selectedId,
  } = selection;
  const { getTransaction, run, mergeTransactions } = fetch;
  // A search position belongs to one workspace, so leaving it discards the
  // offsets rather than resuming a later workspace mid-search.
  const spendingOffsets = useRef(
    new Map<string, { offset: number; unavailableTxids?: string[] }>(),
  );
  useEffect(() => {
    const offsets = spendingOffsets.current;
    return () => offsets.clear();
  }, [activeWorkspace?.id]);
  async function expand(
    direction: 'funding' | 'spending',
    nodeId = selectedId,
    options?: { preserveCamera?: boolean },
  ) {
    if (!activeWorkspace) return;
    const snapshot = getUnlocked(activeWorkspace.id)?.data;
    if (!snapshot) return;
    // A flow arrow selects and traces in one event. Read newly exposed input
    // placeholders from the session instead of waiting for the next render.
    const node =
      recoveryGraph.nodes.find((n) => n.id === nodeId) ??
      buildGraph(snapshot).nodes.find((n) => n.id === nodeId);
    if (!node?.txid || node.kind === 'address') return;
    const generation = selectionGeneration.current;
    if (
      !canTraceAncestry &&
      !(direction === 'funding' && node.kind === 'output' && snapshot.transactions[node.txid])
    )
      return;
    if (options?.preserveCamera) {
      preserveSelectionCamera(selectedId);
      setFocusRequest(undefined);
    }
    await run(async (signal) => {
      setOperation(
        direction === 'funding'
          ? 'Loading previous transactions…'
          : 'Checking outputs for spending transactions…',
      );
      const loaded = snapshot.transactions[node.txid!];
      const traceSourceId = loaded ? txNodeId(node.txid!) : node.id;
      const transaction = loaded ?? (await getTransaction(node.txid!, signal));
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== generation ||
        activeWorkspaceRef.current?.id !== activeWorkspace.id
      )
        return;
      if (!traceSourceExists(getUnlocked(activeWorkspace.id)!.data, traceSourceId)) return;
      if (direction === 'funding') {
        if (node.kind === 'output') {
          mergeTransactions(activeWorkspace.id, loaded ? [] : [transaction], [transaction.txid]);
          const id = txNodeId(transaction.txid);
          workspaces.active?.edit(
            (current) => ({
              ...setNodesHidden(current, [id], false),
              view: {
                ...current.view,
                hiddenNodeIds: current.view.hiddenNodeIds?.filter((hidden) => hidden !== id),
                panels: {
                  ...current.view.panels,
                  flow: openFlowPanel(current.view.panels?.flow, {
                    transactionId: transaction.txid,
                  }),
                },
              },
            }),
            false,
          );
          select(id, options);
          setGraphFilters({});
          if (!options?.preserveCamera) setFocusRequest({ id, token: Date.now() });
        } else if (!loaded) {
          signal.throwIfAborted();
          mergeTransactions(activeWorkspace.id, [transaction]);
        } else {
          const before = getUnlocked(activeWorkspace.id)!.data;
          const result = await loadAncestors([transaction], before.transactions, 1, {
            signal,
            fetch: (id, signal) => getTransaction(id, signal, 'background'),
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          if (
            selectionGeneration.current !== generation ||
            activeWorkspaceRef.current?.id !== activeWorkspace.id
          )
            return;
          if (
            mergeTransactions(
              activeWorkspace.id,
              result.transactions,
              result.resolvedTransactionIds,
              result.transactions.map((tx) => tx.txid),
              traceSourceId,
            )
          ) {
            const parents = new Set(result.resolvedTransactionIds);
            workspaces.active?.edit((current) =>
              addGraphNodes(current, [
                ...result.resolvedTransactionIds.map(txNodeId),
                ...transaction.vin.flatMap((input) =>
                  input.txid && input.vout !== undefined && parents.has(input.txid)
                    ? [outputNodeId(input.txid, input.vout)]
                    : [],
                ),
              ]),
            );
            setNotice(ancestryNotice(result));
          }
        }
      } else {
        const outputIndex = node.kind === 'output' ? node.vout : undefined;
        const searchKey = `${transaction.txid}:${outputIndex ?? 'all'}`;
        const result = await loadSpending(
          transaction,
          activeWorkspace,
          outputIndex,
          signal,
          spendingOffsets.current.get(searchKey)?.offset ?? 0,
          { scope: fetchScope, priority: 'background' },
          spendingOffsets.current.get(searchKey)?.unavailableTxids,
        );
        signal.throwIfAborted();
        if (
          selectionGeneration.current !== generation ||
          activeWorkspaceRef.current?.id !== activeWorkspace.id
        )
          return;
        if (
          !mergeTransactions(
            activeWorkspace.id,
            [...(!loaded ? [transaction] : []), ...result.transactions],
            result.transactions.map((tx) => tx.txid),
            undefined,
            traceSourceId,
          )
        )
          return;
        const spendingNodeIds = result.transactions.map((item) => txNodeId(item.txid));
        const connectingOutputs = result.transactions.flatMap((item) =>
          item.vin.flatMap((input) =>
            input.txid === transaction.txid &&
            input.vout !== undefined &&
            (outputIndex === undefined || input.vout === outputIndex)
              ? [outputNodeId(input.txid, input.vout)]
              : [],
          ),
        );
        workspaces.active?.edit((current) => {
          const admitted = addGraphNodes(current, [...spendingNodeIds, ...connectingOutputs]);
          return node.kind === 'output' && result.transactions.length === 1
            ? {
                ...admitted,
                view: {
                  ...admitted.view,
                  panels: {
                    ...admitted.view.panels,
                    flow: openFlowPanel(admitted.view.panels?.flow, {
                      transactionId: result.transactions[0].txid,
                    }),
                  },
                },
              }
            : admitted;
        });
        if ('nextOffset' in result && result.nextOffset !== undefined)
          spendingOffsets.current.set(searchKey, {
            offset: result.nextOffset,
            unavailableTxids: result.unavailableTxids,
          });
        else spendingOffsets.current.delete(searchKey);

        if (
          selectionGeneration.current !== generation ||
          activeWorkspaceRef.current?.id !== activeWorkspace.id
        )
          return;
        if (!result.transactions.length && outputIndex !== undefined)
          setOperation('Checking current UTXO status…');
        const notice = await spendingNotice(
          result,
          transaction,
          activeWorkspace.network,
          outputIndex,
          signal,
        );
        signal.throwIfAborted();
        const active = getUnlocked(activeWorkspace.id)?.data;
        if (
          notice &&
          active &&
          selectionGeneration.current === generation &&
          activeWorkspaceRef.current?.id === activeWorkspace.id &&
          traceSourceExists(active, traceSourceId)
        )
          setNotice(notice);
      }
      // Tracing extends the investigation without taking over its camera.
      // Initial framing, explicit Fit and Lock to selection own camera changes.
    });
  }
  return { expand };
}
