import {
  indexAddressHistoryTransactions,
  listAddressHistory,
  projectAddressHistory,
  shouldLoadAddressHistory,
  selectedAddress as selectedAddressForHistory,
} from './addressHistory';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../../GraphState/types';
import type { WorkspaceCore } from '../../../workspaceCore';
import type { WorkspaceSelection } from '../../../Selection/useWorkspaceSelection';
import type { Transaction } from '../../../../../Core/ChainData';

import { mapLimit, MAX_SCAN_TRANSACTIONS } from '../../../../../Core/ChainData/api';

import { type AddressHistoryLoadState, addressHistoryLoadKey } from './addressHistoryLoad';

import type { ChainDataAcquisition } from '../../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../../useWorkspaceOperation';

interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  selected: GraphNode | undefined;
  canLoadChainData: boolean;
}

/** Observed history, balance and outputs for the selected Graph address. */
export function useAddressEvidence({
  core,
  selection,
  transactions,
  operation,
  selected,
  canLoadChainData,
}: Inputs) {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setNotice } = core;
  const { getUnlocked } = workspaces;
  const { generation: selectionGeneration } = selection;
  const {
    transaction: getTransaction,
    addressBalance: getAddressBalance,
    addressUtxos: getAddressUtxos,
  } = transactions.read;
  const {
    transactions: recordTransactions,
    addresses: recordAddressObservations,
    addressHistory: observeAddressHistory,
  } = transactions.observe;
  const { run } = operation;
  const [addressHistoryLoads, setAddressHistoryLoads] = useState<
    Record<string, AddressHistoryLoadState>
  >({});
  const addressHistoryJobsRef = useRef(
    new Map<string, { workspaceId: string; controller: AbortController }>(),
  );
  useEffect(() => {
    const workspaceId = activeWorkspace?.id;
    const jobs = addressHistoryJobsRef.current;
    return () => {
      for (const [key, job] of jobs) {
        if (job.workspaceId !== workspaceId) continue;
        job.controller.abort();
        jobs.delete(key);
      }
    };
  }, [activeWorkspace?.id, addressHistoryJobsRef]);
  const addressHistoryNetwork = activeWorkspace?.network;
  const addressHistoryTransactions = activeWorkspace?.chainData.transactions;
  const addressHistoryWallets = activeWorkspace?.wallets.definitions;
  const addressHistoryObservations = activeWorkspace?.chainData.addressHistories;
  const addressHistoryGraphNodeIds = activeWorkspace?.view.graphNodeIds;
  const addressHistoryHiddenNodeIds = activeWorkspace?.view.hiddenNodeIds;
  const addressHistorySelectedAddress =
    activeWorkspace && selected?.kind === 'address' && selected.address
      ? selectedAddressForHistory(selected, activeWorkspace.network)
      : undefined;
  const hasAddressHistorySelection = addressHistorySelectedAddress !== undefined;
  const addressHistoryIndex = useMemo(() => {
    if (!hasAddressHistorySelection || !addressHistoryNetwork || !addressHistoryTransactions)
      return undefined;
    return indexAddressHistoryTransactions({
      network: addressHistoryNetwork,
      chainData: { transactions: addressHistoryTransactions },
    });
  }, [addressHistoryNetwork, addressHistoryTransactions, hasAddressHistorySelection]);
  // React Compiler cannot prove the validated address result is immutable. Retain this
  // bounded projection memo independently of component compilation.
  // oxlint-disable react/preserve-manual-memoization
  const addressHistory = useMemo(() => {
    if (
      !addressHistoryNetwork ||
      !addressHistoryTransactions ||
      !addressHistoryIndex ||
      !addressHistorySelectedAddress
    )
      return undefined;
    return projectAddressHistory(
      {
        network: addressHistoryNetwork,
        view: {
          graphNodeIds: addressHistoryGraphNodeIds,
          hiddenNodeIds: addressHistoryHiddenNodeIds,
        },
        chainData: {
          transactions: addressHistoryTransactions,
          addressHistories: addressHistoryObservations,
        },
        wallets: { definitions: addressHistoryWallets ?? [] },
      },
      addressHistorySelectedAddress,
      addressHistoryIndex,
    );
  }, [
    addressHistoryNetwork,
    addressHistoryTransactions,
    addressHistoryWallets,
    addressHistoryObservations,
    addressHistoryGraphNodeIds,
    addressHistoryHiddenNodeIds,
    addressHistoryIndex,
    addressHistorySelectedAddress,
  ]);
  // oxlint-enable react/preserve-manual-memoization
  const addressBalance =
    activeWorkspace && selected?.kind === 'address' && selected.address
      ? activeWorkspace.chainData.addressBalances?.[selected.address]
      : undefined;
  const addressUtxos =
    activeWorkspace && selected?.kind === 'address' && selected.address
      ? activeWorkspace.chainData.addressUtxos?.[selected.address]
      : undefined;
  const addressHistoryLoad =
    activeWorkspace && selected?.kind === 'address' && selected.address
      ? addressHistoryLoads[
          addressHistoryLoadKey(activeWorkspace.id, activeWorkspace.network, selected.address)
        ]
      : undefined;
  const backgroundAddressHistoryLoad = activeWorkspace
    ? Object.values(addressHistoryLoads).find(
        (load) => load.workspaceId === activeWorkspace.id && !load.error,
      )
    : undefined;
  const startAddressHistoryLoad = useCallback(
    (address: string, force = false) => {
      const current = activeWorkspaceRef.current;
      if (!current || !canLoadChainData) return;
      const ownerId = current.id;
      const key = addressHistoryLoadKey(ownerId, current.network, address);
      if (addressHistoryJobsRef.current.has(key)) return;
      const currentHistory = listAddressHistory(current, address);
      const needsHistory =
        force || shouldLoadAddressHistory(currentHistory) || !currentHistory?.complete;
      const needsBalance = force || !current.chainData.addressBalances?.[address];
      if (!needsHistory && !needsBalance) return;

      const controller = new AbortController();
      addressHistoryJobsRef.current.set(key, { workspaceId: ownerId, controller });
      setAddressHistoryLoads((loads) => ({
        ...loads,
        [key]: {
          workspaceId: ownerId,
          address,
          phase: needsHistory ? 'history' : 'balance',
          done: 0,
          total: 0,
        },
      }));

      const updateProgress = (update: Partial<AddressHistoryLoadState>) => {
        setAddressHistoryLoads((loads) => {
          const previous = loads[key];
          return previous ? { ...loads, [key]: { ...previous, ...update } } : loads;
        });
      };

      let failed = false;
      void (async () => {
        let historyFailed = false;
        let balanceFailed = false;
        const reportHistoryFailure = () => {
          failed = true;
          setAddressHistoryLoads((loads) => ({
            ...loads,
            [key]: {
              ...loads[key],
              phase: 'history',
              error: 'Address history could not be loaded. Retry.',
            },
          }));
          setNotice('Address history could not be loaded. Retry.');
        };
        const balancePromise = needsBalance
          ? getAddressBalance(address, controller.signal).catch(() => {
              controller.signal.throwIfAborted();
              balanceFailed = true;
              return undefined;
            })
          : Promise.resolve(undefined);
        let result:
          Awaited<ReturnType<ChainDataAcquisition['observe']['addressHistory']>> | undefined;
        try {
          if (needsHistory) {
            try {
              result = await observeAddressHistory(address, {
                signal: controller.signal,
                accept: () => activeWorkspaceRef.current?.id === ownerId,
                onHistory: (detailTotal) =>
                  updateProgress({ phase: 'details', done: 0, total: detailTotal }),
                onProgress: (progress) =>
                  updateProgress({
                    phase: 'details',
                    done: progress.done,
                    total: progress.total ?? 0,
                  }),
              });
            } catch {
              controller.signal.throwIfAborted();
              historyFailed = true;
            }
          }
          controller.signal.throwIfAborted();
          if (needsBalance) updateProgress({ phase: 'balance' });
          const balance = await balancePromise;
          controller.signal.throwIfAborted();
          if (balance && activeWorkspaceRef.current?.id === ownerId)
            recordAddressObservations({ addressBalances: { [address]: balance } });
          if (historyFailed) reportHistoryFailure();
          else {
            if (balanceFailed)
              setNotice(
                result
                  ? 'Address history loaded, but the address balance could not be checked. Retry.'
                  : 'Address balance could not be checked. Retry.',
              );
            if (result?.truncated)
              setNotice(
                balanceFailed
                  ? 'Address history is partial and the balance could not be checked. Retry.'
                  : 'Address history is partial: some transaction details are not loaded. Select a row to load one.',
              );
          }
        } catch {
          if (controller.signal.aborted) return;
          reportHistoryFailure();
        }
      })().finally(() => {
        addressHistoryJobsRef.current.delete(key);
        if (!failed)
          setAddressHistoryLoads((loads) => {
            if (!loads[key]) return loads;
            const next = { ...loads };
            delete next[key];
            return next;
          });
      });
    },
    [
      canLoadChainData,
      getAddressBalance,
      observeAddressHistory,
      recordAddressObservations,
      activeWorkspaceRef,
      addressHistoryJobsRef,
      setNotice,
      setAddressHistoryLoads,
    ],
  );
  const autoLoadAddress =
    activeWorkspace && selected?.kind === 'address' && selected.address
      ? selectedAddressForHistory(selected, activeWorkspace.network)
      : undefined;
  useEffect(() => {
    if (!activeWorkspace?.id || !canLoadChainData || !autoLoadAddress) return;
    const current = getUnlocked(activeWorkspace.id)?.data;
    if (!current || !shouldLoadAddressHistory(listAddressHistory(current, autoLoadAddress))) return;
    // Selection is the stable trigger. Do not depend on the observation itself:
    // an empty successful result must not start an endless refresh loop.
    startAddressHistoryLoad(autoLoadAddress);
  }, [
    autoLoadAddress,
    canLoadChainData,
    getUnlocked,
    startAddressHistoryLoad,
    activeWorkspace?.id,
  ]);
  function refreshAddressBalance() {
    if (!activeWorkspace || !selected) return;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    if (!address || !canLoadChainData) return;
    const ownerId = activeWorkspace.id;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      setOperation('Checking address balance…');
      const observation = await getAddressBalance(address, signal);
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || activeWorkspaceRef.current?.id !== ownerId)
        return;
      recordAddressObservations({ addressBalances: { [address]: observation } });
    });
  }
  function loadAddressUtxos(force = false) {
    if (!activeWorkspace || !selected) return;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    if (!address) return;
    const ownerId = activeWorkspace.id;
    const current = getUnlocked(ownerId)?.data;
    if (!current) return;
    if (!force && current.chainData.addressUtxos?.[address]) return;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      setOperation('Loading address UTXOs…');
      const utxos = await getAddressUtxos(address, signal);
      let balance: Awaited<ReturnType<typeof getAddressBalance>> | undefined;
      let balanceFailed = false;
      if (force || !current.chainData.addressBalances?.[address]) {
        try {
          balance = await getAddressBalance(address, signal);
        } catch {
          signal.throwIfAborted();
          balanceFailed = true;
        }
      }
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || activeWorkspaceRef.current?.id !== ownerId)
        return;
      recordAddressObservations({
        addressUtxos: { [address]: utxos },
        ...(balance && { addressBalances: { [address]: balance } }),
      });
      if (balanceFailed) setNotice('UTXOs loaded. Address balance could not be checked. Retry.');

      const latestTransactions = (getUnlocked(ownerId)?.data ?? current).chainData.transactions;
      const detailTargets = [
        ...new Map(
          utxos.utxos
            .filter((utxo) => utxo.height > 0 && !latestTransactions[utxo.txid])
            .map((utxo) => [utxo.txid, utxo] as const),
        ).values(),
      ];
      const boundedDetailTargets = detailTargets.slice(0, MAX_SCAN_TRANSACTIONS);
      if (!boundedDetailTargets.length) return;
      setOperation(
        `Loading UTXO timestamps 0/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
      );
      let loaded = 0;
      const details = await mapLimit(
        boundedDetailTargets,
        4,
        async (utxo): Promise<Transaction | undefined> => {
          try {
            const transaction = await getTransaction(utxo.txid, signal, 'background');
            if (
              transaction.status?.confirmations !== undefined &&
              transaction.status?.confirmations < 0
            )
              return undefined;
            const conflictingHeight =
              transaction.status?.blockHeight !== undefined &&
              transaction.status?.blockHeight !== utxo.height;
            const observed = conflictingHeight
              ? {
                  ...transaction,
                  status: {
                    kind: 'confirmed' as const,
                    blockHeight: utxo.height,
                    blockhash: undefined,
                    blocktime: undefined,
                    time: undefined,
                    confirmations: undefined,
                  },
                }
              : {
                  ...transaction,
                  status: {
                    ...transaction.status,
                    kind: 'confirmed' as const,
                    blockHeight: utxo.height,
                    confirmations:
                      transaction.status?.confirmations !== undefined &&
                      transaction.status?.confirmations > 0
                        ? transaction.status?.confirmations
                        : undefined,
                  },
                };
            loaded = loaded + 1;
            setOperation(
              `Loading UTXO timestamps ${loaded}/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
            );
            return observed;
          } catch {
            signal.throwIfAborted();
            loaded = loaded + 1;
            setOperation(
              `Loading UTXO timestamps ${loaded}/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
            );
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      const loadedDetails = details.filter(
        (transaction): transaction is Transaction => !!transaction,
      );
      if (loadedDetails.length) recordTransactions(ownerId, loadedDetails);
    });
  }
  const isAddressHistoryLoading = useCallback(
    (
      workspaceId: string,
      network: NonNullable<typeof activeWorkspace>['network'],
      address: string,
    ) => addressHistoryJobsRef.current.has(addressHistoryLoadKey(workspaceId, network, address)),
    [addressHistoryJobsRef],
  );
  return {
    addressHistory,
    addressBalance,
    addressUtxos,
    addressHistoryLoad,
    backgroundAddressHistoryLoad,
    startAddressHistoryLoad,
    isAddressHistoryLoading,
    refreshAddressBalance,
    loadAddressUtxos,
  };
}
