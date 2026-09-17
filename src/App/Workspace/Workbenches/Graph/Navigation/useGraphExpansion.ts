import { spendingNotice } from './spendingNotice';
import { addGraphNodes } from '../../../GraphState/graphMembership';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { GraphData } from '../../../GraphState/types';
import type { GraphFilters } from '../../../../../Core/Workspace/view';
import {
  outpointReference,
  transactionReference,
} from '../../../../../Core/Workspace/entityReferences';
import type { WorkspaceCore } from '../../../workspaceCore';
import type { WorkspaceSelection } from '../../../Selection/useWorkspaceSelection';
import { setNodesHidden } from '../../../GraphState/visibility';
import { buildGraph } from '../../../GraphState/graphEvidence';
import { openFlowPanel } from '../../../GraphState/panelState';

import { ancestryNotice } from './ancestryNotice';
import { loadAncestors } from './ancestry';
import { traceSourceExists } from '../../../GraphState/traceSource';

import type { ChainDataAcquisition } from '../../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../../useWorkspaceOperation';

interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  setFocusRequest: Dispatch<
    SetStateAction<{ id: string; token: number; preserveZoom?: boolean } | undefined>
  >;
  recoveryGraph: GraphData;
  canTraceAncestry: boolean;
}

/** Following funding and spending outward from what is already loaded. */
export function useGraphExpansion({
  core,
  selection,
  transactions,
  operation,
  setGraphFilters,
  setFocusRequest,
  recoveryGraph,
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
  const { transaction: getTransaction } = transactions.read;
  const { transactions: recordTransactions } = transactions.observe;
  const { run } = operation;
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
      !(
        direction === 'funding' &&
        node.kind === 'output' &&
        snapshot.chainData.transactions[node.txid]
      )
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
      const loaded = snapshot.chainData.transactions[node.txid!];
      const traceSourceId = loaded ? transactionReference(node.txid!) : node.id;
      const transaction = loaded ?? (await getTransaction(node.txid!, signal));
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== generation ||
        activeWorkspaceRef.current?.id !== activeWorkspace.id
      )
        return;
      if (!traceSourceExists(getUnlocked(activeWorkspace.id)!.data.chainData, traceSourceId))
        return;
      if (direction === 'funding') {
        if (node.kind === 'output') {
          recordTransactions(activeWorkspace.id, loaded ? [] : [transaction], {
            promotionIds: [transaction.txid],
          });
          const id = transactionReference(transaction.txid);
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
          recordTransactions(activeWorkspace.id, [transaction]);
        } else {
          const before = getUnlocked(activeWorkspace.id)!.data;
          const result = await loadAncestors([transaction], before.chainData.transactions, 1, {
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
            recordTransactions(activeWorkspace.id, result.transactions, {
              promotionIds: result.resolvedTransactionIds,
              contextIds: result.transactions.map((tx) => tx.txid),
              accept: (current) => traceSourceExists(current.chainData, traceSourceId),
            })
          ) {
            const parents = new Set(result.resolvedTransactionIds);
            workspaces.active?.edit((current) =>
              addGraphNodes(current, [
                ...result.resolvedTransactionIds.map(transactionReference),
                ...transaction.vin.flatMap((input) =>
                  input.txid && input.vout !== undefined && parents.has(input.txid)
                    ? [outpointReference(input.txid, input.vout)]
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
        const result = await transactions.read.spending(
          transaction,
          outputIndex,
          signal,
          spendingOffsets.current.get(searchKey)?.offset ?? 0,
          spendingOffsets.current.get(searchKey)?.unavailableTxids,
        );
        signal.throwIfAborted();
        if (
          selectionGeneration.current !== generation ||
          activeWorkspaceRef.current?.id !== activeWorkspace.id
        )
          return;
        if (
          !recordTransactions(
            activeWorkspace.id,
            [...(!loaded ? [transaction] : []), ...result.transactions],
            {
              promotionIds: result.transactions.map((tx) => tx.txid),
              accept: (current) => traceSourceExists(current.chainData, traceSourceId),
            },
          )
        )
          return;
        const spendingNodeIds = result.transactions.map((item) => transactionReference(item.txid));
        const connectingOutputs = result.transactions.flatMap((item) =>
          item.vin.flatMap((input) =>
            input.txid === transaction.txid &&
            input.vout !== undefined &&
            (outputIndex === undefined || input.vout === outputIndex)
              ? [outpointReference(input.txid, input.vout)]
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
          traceSourceExists(active.chainData, traceSourceId)
        )
          setNotice(notice);
      }
      // Tracing extends the investigation without taking over its camera.
      // Initial framing, explicit Fit and Lock to selection own camera changes.
    });
  }
  return { expand };
}
