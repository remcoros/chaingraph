import { useMemo, type Dispatch, type SetStateAction } from 'react';

import { addGraphNodes } from '../../../GraphState/graphMembership';
import { openFlowPanel } from '../../../GraphState/panelState';
import type { GraphFilters } from '../../../../../Core/Workspace/view';
import {
  addressReference,
  outpointReference,
  transactionReference,
} from '../../../../../Core/Workspace/entityReferences';
import type { GraphNode } from '../../../GraphState/types';
import type { WorkspaceCore } from '../../../workspaceCore';
import type { WorkspaceSelection } from '../../../Selection/useWorkspaceSelection';
import type { ChainDataAcquisition } from '../../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../../useWorkspaceOperation';

import { withHistoryHeight, type Transaction } from '../../../../../Core/ChainData';

import { mapLimit } from '../../../../../Core/ChainData/api';
import {
  listAddressHistory,
  recentAddressHistoryEntries,
  recentAddressUtxos,
  RECENT_ADDRESS_GRAPH_LIMIT,
  selectedAddress as selectedAddressForHistory,
} from './addressHistory';
import type { useAddressEvidence } from './useAddressEvidence';

interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  evidence: ReturnType<typeof useAddressEvidence>;
  selected: GraphNode | undefined;
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  setFocusRequest: Dispatch<
    SetStateAction<{ id: string; token: number; preserveZoom?: boolean } | undefined>
  >;
  canLoadChainData: boolean;
  revealLookup: (id: string) => void;
}

/** Navigation from an address record into concrete Graph nodes and flow views. */
export function useAddressNavigation({
  core,
  selection,
  transactions,
  operation,
  evidence,
  selected,
  setGraphFilters,
  setFocusRequest,
  canLoadChainData,
  revealLookup,
}: Inputs) {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setNotice } = core;
  const { getUnlocked } = workspaces;
  const { generation: selectionGeneration, select } = selection;
  const {
    transaction: getTransaction,
    addressUtxos: getAddressUtxos,
    addressHistory: getAddressHistory,
  } = transactions.read;
  const { transactions: recordTransactions, addresses: recordAddressObservations } =
    transactions.observe;
  const { run } = operation;

  function selectedAddressAction() {
    if (!activeWorkspace || selected?.kind !== 'address' || !selected.address) return undefined;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    return address
      ? { address, generation: selectionGeneration.current, ownerId: activeWorkspace.id }
      : undefined;
  }

  function revealAddressGraphNodes(ownerId: string, ids: string[]) {
    if (!ids.length) return;
    getUnlocked(ownerId)?.edit((current) => {
      const revealed = addGraphNodes(current, ids);
      return {
        ...revealed,
        view: { ...revealed.view, smallAmountThreshold: undefined },
      };
    }, false);
    setGraphFilters({});
  }

  function openAddressHistory(force = false) {
    const action = selectedAddressAction();
    if (!action) return;
    const current = getUnlocked(action.ownerId)?.data;
    if (!current) return;
    revealLookup(addressReference(action.address));
    if (!canLoadChainData) {
      if (listAddressHistory(current, action.address)?.source === 'loaded transactions')
        setNotice('Showing transactions mentioning this address in the loaded workspace data.');
      return;
    }
    evidence.startAddressHistoryLoad(action.address, force);
  }

  function openSelectedOutputAddress() {
    if (!activeWorkspace || selected?.kind !== 'output') return;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    if (!address) return;
    const id = addressReference(address);
    revealAddressGraphNodes(activeWorkspace.id, [id]);
    revealLookup(id);
  }

  function showRecentAddressUtxos() {
    const action = selectedAddressAction();
    if (!action) return;
    const current = getUnlocked(action.ownerId)?.data;
    if (!current) return;
    const cached = current.chainData.addressUtxos?.[action.address];
    if (!cached && !canLoadChainData) return;
    void run(async (signal) => {
      setOperation('Loading recent UTXOs…');
      const observation = cached ?? (await getAddressUtxos(action.address, signal));
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== action.generation ||
        activeWorkspaceRef.current?.id !== action.ownerId
      )
        return;
      if (!cached) recordAddressObservations({ addressUtxos: { [action.address]: observation } });
      const recent = recentAddressUtxos(observation, RECENT_ADDRESS_GRAPH_LIMIT);
      if (!recent.length) {
        setNotice('No unspent outputs observed for this address.');
        return;
      }
      const latestTransactions = (getUnlocked(action.ownerId)?.data ?? current).chainData
        .transactions;
      const detailTargets = [
        ...new Map(
          recent
            .filter((utxo) => !latestTransactions[utxo.txid])
            .map((utxo) => [utxo.txid, utxo] as const),
        ).values(),
      ];
      const details = await mapLimit(
        canLoadChainData ? detailTargets : [],
        4,
        async (utxo): Promise<Transaction | undefined> => {
          try {
            const transaction = await getTransaction(utxo.txid, signal, 'visible', utxo.height);
            return transaction.status?.confirmations !== undefined &&
              transaction.status?.confirmations < 0
              ? undefined
              : withHistoryHeight(transaction, utxo.height);
          } catch {
            signal.throwIfAborted();
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== action.generation ||
        activeWorkspaceRef.current?.id !== action.ownerId
      )
        return;
      recordTransactions(
        action.ownerId,
        details.filter((transaction): transaction is Transaction => !!transaction),
        { promotionIds: [...new Set(recent.map((utxo) => utxo.txid))] },
      );
      const latest = getUnlocked(action.ownerId)?.data;
      if (!latest) return;
      revealAddressGraphNodes(
        action.ownerId,
        recent.flatMap((utxo) => {
          const transaction = latest.chainData.transactions[utxo.txid];
          return transaction?.vout.some((output) => output.n === utxo.vout)
            ? [outpointReference(utxo.txid, utxo.vout)]
            : [];
        }),
      );
    });
  }

  function showRecentAddressTransactions() {
    const action = selectedAddressAction();
    if (!action) return;
    const current = getUnlocked(action.ownerId)?.data;
    if (!current) return;
    void run(async (signal) => {
      let latest = getUnlocked(action.ownerId)?.data ?? current;
      let history = listAddressHistory(latest, action.address);
      let historyLoadActive = evidence.isAddressHistoryLoading(
        action.ownerId,
        current.network,
        action.address,
      );
      const needsObservedHistory =
        !history || history.source === 'loaded transactions' || history.entries.length === 0;
      if (needsObservedHistory && !historyLoadActive && canLoadChainData) {
        setOperation('Loading recent transactions…');
        const observedHistory = await getAddressHistory(action.address, signal);
        signal.throwIfAborted();
        if (
          selectionGeneration.current !== action.generation ||
          activeWorkspaceRef.current?.id !== action.ownerId
        )
          return;
        recordAddressObservations({ addressHistories: { [action.address]: observedHistory } });
        latest = getUnlocked(action.ownerId)?.data ?? latest;
        history = listAddressHistory(latest, action.address);
        historyLoadActive = evidence.isAddressHistoryLoading(
          action.ownerId,
          current.network,
          action.address,
        );
      }
      const recent = recentAddressHistoryEntries(history, RECENT_ADDRESS_GRAPH_LIMIT);
      if (!recent.length) {
        setNotice(
          historyLoadActive
            ? 'Address history is still loading. Try again when recent transactions are available.'
            : 'No observed transactions for this address.',
        );
        return;
      }
      const detailTargets = recent.filter((entry) => !latest.chainData.transactions[entry.txid]);
      const details = await mapLimit(
        canLoadChainData ? detailTargets : [],
        4,
        async (entry): Promise<Transaction | undefined> => {
          try {
            return await getTransaction(entry.txid, signal, 'visible', entry.height);
          } catch {
            signal.throwIfAborted();
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== action.generation ||
        activeWorkspaceRef.current?.id !== action.ownerId
      )
        return;
      recordTransactions(
        action.ownerId,
        details.filter((transaction): transaction is Transaction => !!transaction),
        { promotionIds: [...new Set(recent.map((entry) => entry.txid))] },
      );
      revealAddressGraphNodes(
        action.ownerId,
        recent.map((entry) => transactionReference(entry.txid)),
      );
    });
  }

  function openAddressHistoryTransaction(txid: string, height?: number, vout?: number) {
    if (!activeWorkspace || !/^[0-9a-f]{64}$/i.test(txid)) return;
    const ownerId = activeWorkspace.id;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const current = getUnlocked(ownerId)?.data;
      if (!current) return;
      const cached = current.chainData.transactions[txid];
      setOperation(cached ? 'Opening transaction…' : 'Loading transaction…');
      const transaction = cached ?? (await getTransaction(txid, signal, 'navigation', height));
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || activeWorkspaceRef.current?.id !== ownerId)
        return;
      recordTransactions(ownerId, cached ? [] : [transaction], {
        promotionIds: [transaction.txid],
      });
      getUnlocked(ownerId)?.edit((latest) => {
        const admitted = addGraphNodes(latest, [transactionReference(transaction.txid)]);
        return {
          ...admitted,
          view: {
            ...admitted.view,
            panels: {
              ...latest.view.panels,
              flow: openFlowPanel(latest.view.panels?.flow, {
                transactionId: transaction.txid,
              }),
            },
          },
        };
      }, false);
      const selectedId =
        vout !== undefined && transaction.vout.some((output) => output.n === vout)
          ? outpointReference(transaction.txid, vout)
          : transactionReference(transaction.txid);
      select(selectedId);
      setFocusRequest({ id: selectedId, token: Date.now() });
    });
  }

  const recentAddressUtxoTargets = useMemo(
    () => recentAddressUtxos(evidence.addressUtxos, RECENT_ADDRESS_GRAPH_LIMIT),
    [evidence.addressUtxos],
  );
  const recentAddressTransactionTargets = useMemo(
    () => recentAddressHistoryEntries(evidence.addressHistory, RECENT_ADDRESS_GRAPH_LIMIT),
    [evidence.addressHistory],
  );

  return {
    openAddressHistory,
    openSelectedOutputAddress,
    showRecentAddressUtxos,
    showRecentAddressTransactions,
    openAddressHistoryTransaction,
    recentAddressUtxoTargets,
    recentAddressTransactionTargets,
  };
}
