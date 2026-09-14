import { spendingNotice } from './spendingNotice';
import {
  indexAddressHistoryTransactions,
  listAddressHistory,
  projectAddressHistory,
  recentAddressHistoryEntries,
  recentAddressUtxos,
  RECENT_ADDRESS_GRAPH_LIMIT,
  shouldLoadAddressHistory,
  selectedAddress as selectedAddressForHistory,
} from '../../../Domain/Chain/addressHistory';
import { addGraphNodes, ensureGraphMembership } from '../../../Domain/Graph/graphMembership';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type GraphData, type GraphFilters, type GraphNode } from '../../../Domain/types';
import type { AppState } from '../../useAppState';
import type { WorkspaceCore } from '../workspaceCore';
import type { WorkspaceSelection } from '../Selection/useWorkspaceSelection';
import type { WorkspaceLookup } from '../useWorkspaceLookup';
import { setNodesHidden } from '../../../Domain/Graph/visibility';
import {
  buildGraph,
  clearContextProvenance,
  markContextTransactions,
  promoteInputContext,
} from '../../../Domain/Workspace/workspace';
import { mergeTransactionObservations } from '../../../Domain/Chain/prevouts';
import { withHistoryHeight } from '../../../Domain/Chain/transactionStatus';
import { outputNodeId, addressNodeId, txNodeId, type Transaction } from '../../../Domain/types';
import {
  fetchAddressBalance,
  fetchAddressUtxos,
  fetchHistory,
  fetchTransaction,
  loadAddress,
  loadSpending,
  mapLimit,
  MAX_SCAN_TRANSACTIONS,
  type AddressHistoryLoadCallbacks,
} from '../../../Infra/Bitcoin/api';
import { addressToScriptHash } from '../../../Domain/Wallet/wallet';
import { ancestryNotice, loadAncestors, traceSourceExists } from '../../../Infra/Bitcoin/tracing';
import type { Dispatch, SetStateAction, RefObject } from 'react';

import type { AddressHistoryLoadState } from './addressHistoryLoad';
import { addressHistoryLoadKey } from './addressHistoryLoad';
interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  lookup: WorkspaceLookup;
  /** Plain callbacks, because evidence is shared and must not depend on a workbench. */
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  setFocusRequest: Dispatch<
    SetStateAction<{ id: string; token: number; preserveZoom?: boolean } | undefined>
  >;
  /** Selected node and recovery graph, which the projection derives. */
  selected: GraphNode | undefined;
  recoveryGraph: GraphData;
  fetchScope: AppState['fetchScope'];
  operationRef: RefObject<AbortController | undefined>;
  canLoadChainData: boolean;
  canTraceAncestry: boolean;
  prefetchDepth: 0 | 1 | 2;
  revealLookup: (id: string) => void;
}
export function useWorkspaceEvidence({
  core,
  selection,
  lookup,
  setGraphFilters,
  setFocusRequest,
  selected,
  recoveryGraph,
  fetchScope,
  operationRef,
  canLoadChainData,
  canTraceAncestry,
  prefetchDepth,
  revealLookup,
}: Inputs) {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setError, setNotice } =
    core;
  const {
    generation: selectionGeneration,
    preserveCamera: preserveSelectionCamera,
    select,
    selectedId,
  } = selection;
  const { resolveLoaded: loadedLookupId, clear: clearQuery } = lookup;

  const [addressHistoryLoads, setAddressHistoryLoads] = useState<
    Record<string, AddressHistoryLoadState>
  >({});
  const addressHistoryJobsRef = useRef(
    new Map<string, { workspaceId: string; controller: AbortController }>(),
  );
  const spendingOffsets = useRef(
    new Map<string, { offset: number; unavailableTxids?: string[] }>(),
  );
  useEffect(() => {
    const workspaceId = activeWorkspace?.id;
    const jobs = addressHistoryJobsRef.current;
    const offsets = spendingOffsets.current;
    return () => {
      for (const [key, job] of jobs) {
        if (job.workspaceId !== workspaceId) continue;
        job.controller.abort();
        jobs.delete(key);
      }
      // Spending offsets describe one workspace's search position, so leaving it
      // discards them rather than resuming a later workspace mid-search.
      offsets.clear();
    };
  }, [activeWorkspace?.id, addressHistoryJobsRef, spendingOffsets]);
  const addressHistoryNetwork = activeWorkspace?.network;
  const addressHistoryTransactions = activeWorkspace?.transactions;
  const addressHistoryWallets = activeWorkspace?.wallets;
  const addressHistoryObservations = activeWorkspace?.addressHistories;
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
      transactions: addressHistoryTransactions,
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
        transactions: addressHistoryTransactions,
        wallets: addressHistoryWallets ?? [],
        addressHistories: addressHistoryObservations,
        view: {
          graphNodeIds: addressHistoryGraphNodeIds,
          hiddenNodeIds: addressHistoryHiddenNodeIds,
        },
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
      ? activeWorkspace.addressBalances?.[selected.address]
      : undefined;
  const addressUtxos =
    activeWorkspace && selected?.kind === 'address' && selected.address
      ? activeWorkspace.addressUtxos?.[selected.address]
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
  const getTransaction = async (
    id: string,
    signal?: AbortSignal,
    priority: 'navigation' | 'background' = 'navigation',
  ) => {
    signal?.throwIfAborted();
    if (!activeWorkspace) throw new Error('Open a workspace first.');
    if (activeWorkspace.demo)
      throw new Error('Live lookups are disabled for legacy synthetic workspaces.');
    return (
      activeWorkspace.transactions[id] ??
      fetchTransaction(activeWorkspace.network, id, signal, undefined, {
        scope: fetchScope,
        priority,
      })
    );
  };
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operationRef.current) return;
    const controller = new AbortController();
    const workspaceId = activeWorkspaceRef.current?.id;
    operationRef.current = controller;
    setOperation('Working…');
    setError('');
    setNotice('');
    try {
      await task(controller.signal);
    } catch (e) {
      if (activeWorkspaceRef.current?.id !== workspaceId || operationRef.current !== controller)
        return;
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Operation failed.');
      else setNotice('Operation cancelled. Completed data from earlier actions is preserved.');
    } finally {
      if (operationRef.current === controller) {
        operationRef.current = undefined;
        setOperation('');
      }
    }
  };
  const mergeTransactions = (
    id: string,
    transactions: Transaction[],
    promotionIds = transactions.map((transaction) => transaction.txid),
    contextIds?: string[],
    requiredSourceId?: string,
  ) => {
    if (!transactions.length && !promotionIds.length) {
      const current = workspaces.getUnlocked(id)?.data;
      return !!current && (!requiredSourceId || traceSourceExists(current, requiredSourceId));
    }
    let accepted = false;
    workspaces.getUnlocked(id)?.edit((current) => {
      if (requiredSourceId && !traceSourceExists(current, requiredSourceId)) return current;
      accepted = true;
      const initialized = ensureGraphMembership(current);
      const promoted = contextIds
        ? promoteInputContext(initialized, promotionIds)
        : clearContextProvenance(initialized, promotionIds);
      const merged = !transactions.length
        ? promoted
        : {
            ...promoted,
            transactions: {
              ...current.transactions,
              ...Object.fromEntries(
                transactions.map((transaction) => [
                  transaction.txid,
                  mergeTransactionObservations(
                    current.transactions[transaction.txid],
                    transaction,
                    current.network,
                  ),
                ]),
              ),
            },
          };
      return contextIds ? markContextTransactions(merged, contextIds) : merged;
    }, false);
    return accepted;
  };
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
      const needsBalance = force || !current.addressBalances?.[address];
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
      const persistHistory: NonNullable<AddressHistoryLoadCallbacks['onHistory']> = (
        history,
        detailTotal,
        truncated,
      ) => {
        if (activeWorkspaceRef.current?.id !== ownerId) return;
        workspaces.getUnlocked(ownerId)?.edit(
          (latest) => ({
            ...latest,
            addressHistories: {
              ...latest.addressHistories,
              [address]: {
                history,
                truncated,
                scannedAt: new Date().toISOString(),
              },
            },
          }),
          false,
        );
        updateProgress({ phase: 'details', done: 0, total: detailTotal });
      };
      let pendingTransactions: Transaction[] = [];
      let transactionFlushTimer: ReturnType<typeof setTimeout> | undefined;
      const flushTransactions = () => {
        if (transactionFlushTimer) {
          clearTimeout(transactionFlushTimer);
          transactionFlushTimer = undefined;
        }
        const batch = pendingTransactions;
        pendingTransactions = [];
        if (!batch.length || activeWorkspaceRef.current?.id !== ownerId) return;
        workspaces.getUnlocked(ownerId)?.edit(
          (latest) => ({
            ...clearContextProvenance(
              latest,
              batch.map((transaction) => transaction.txid),
            ),
            transactions: {
              ...latest.transactions,
              ...Object.fromEntries(
                batch.map((transaction) => [
                  transaction.txid,
                  mergeTransactionObservations(
                    latest.transactions[transaction.txid],
                    transaction,
                    latest.network,
                  ),
                ]),
              ),
            },
          }),
          false,
        );
      };
      const persistTransaction = (transaction: Transaction) => {
        pendingTransactions.push(transaction);
        if (!transactionFlushTimer) transactionFlushTimer = setTimeout(flushTransactions, 16);
      };

      let failed = false;
      void (async () => {
        let historyError: unknown;
        let balanceFailed = false;
        const balancePromise = needsBalance
          ? fetchAddressBalance(current.network, address, controller.signal).catch(() => {
              controller.signal.throwIfAborted();
              balanceFailed = true;
              return undefined;
            })
          : Promise.resolve(undefined);
        let result: Awaited<ReturnType<typeof loadAddress>> | undefined;
        try {
          if (needsHistory) {
            try {
              result = await loadAddress(
                address,
                current.network,
                current.transactions,
                controller.signal,
                (progress) =>
                  updateProgress({
                    phase: 'details',
                    done: progress.done,
                    total: progress.total ?? 0,
                  }),
                { scope: fetchScope },
                { onHistory: persistHistory, onTransaction: persistTransaction },
              );
            } catch (error) {
              controller.signal.throwIfAborted();
              historyError = error;
            }
          }
          flushTransactions();
          controller.signal.throwIfAborted();
          if (result && activeWorkspaceRef.current?.id === ownerId)
            workspaces
              .getUnlocked(ownerId)
              ?.edit(
                (latest) => clearContextProvenance(latest, result!.observedTransactionIds),
                false,
              );
          if (needsBalance) updateProgress({ phase: 'balance' });
          const balance = await balancePromise;
          controller.signal.throwIfAborted();
          if (balance && activeWorkspaceRef.current?.id === ownerId)
            workspaces.getUnlocked(ownerId)?.edit(
              (latest) => ({
                ...latest,
                addressBalances: { ...latest.addressBalances, [address]: balance },
              }),
              false,
            );
          if (historyError) throw historyError;
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
        } catch {
          if (controller.signal.aborted) return;
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
        }
      })().finally(() => {
        if (transactionFlushTimer) clearTimeout(transactionFlushTimer);
        flushTransactions();
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
      fetchScope,
      workspaces,
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
    const current = workspaces.getUnlocked(activeWorkspace.id)?.data;
    if (!current || !shouldLoadAddressHistory(listAddressHistory(current, autoLoadAddress))) return;
    // Selection is the stable trigger. Do not depend on the observation itself:
    // an empty successful result must not start an endless refresh loop.
    startAddressHistoryLoad(autoLoadAddress);
  }, [autoLoadAddress, canLoadChainData, workspaces, startAddressHistoryLoad, activeWorkspace?.id]);
  function openAddressHistory(force = false) {
    if (!activeWorkspace || !selected) return;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    if (!address) return;
    const current = workspaces.getUnlocked(activeWorkspace.id)?.data;
    if (!current) return;
    revealLookup(addressNodeId(address));
    if (!canLoadChainData) {
      if (listAddressHistory(current, address)?.source === 'loaded transactions')
        setNotice('Showing transactions mentioning this address in the loaded workspace data.');
      return;
    }
    startAddressHistoryLoad(address, force);
  }
  function refreshAddressBalance() {
    if (!activeWorkspace || !selected) return;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    if (!address || !canLoadChainData) return;
    const ownerId = activeWorkspace.id;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      setOperation('Checking address balance…');
      const observation = await fetchAddressBalance(activeWorkspace.network, address, signal);
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || activeWorkspaceRef.current?.id !== ownerId)
        return;
      workspaces.getUnlocked(ownerId)?.edit(
        (latest) => ({
          ...latest,
          addressBalances: {
            ...latest.addressBalances,
            [address]: observation,
          },
        }),
        false,
      );
    });
  }
  function loadAddressUtxos(force = false) {
    if (!activeWorkspace || !selected) return;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    if (!address) return;
    const ownerId = activeWorkspace.id;
    const current = workspaces.getUnlocked(ownerId)?.data;
    if (!current) return;
    if (!force && current.addressUtxos?.[address]) return;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      setOperation('Loading address UTXOs…');
      const utxos = await fetchAddressUtxos(current.network, address, signal);
      let balance: Awaited<ReturnType<typeof fetchAddressBalance>> | undefined;
      let balanceFailed = false;
      if (force || !current.addressBalances?.[address]) {
        try {
          balance = await fetchAddressBalance(current.network, address, signal);
        } catch {
          signal.throwIfAborted();
          balanceFailed = true;
        }
      }
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || activeWorkspaceRef.current?.id !== ownerId)
        return;
      workspaces.getUnlocked(ownerId)?.edit(
        (latest) => ({
          ...latest,
          addressUtxos: {
            ...latest.addressUtxos,
            [address]: utxos,
          },
          ...(balance
            ? {
                addressBalances: {
                  ...latest.addressBalances,
                  [address]: balance,
                },
              }
            : {}),
        }),
        false,
      );
      if (balanceFailed) setNotice('UTXOs loaded. Address balance could not be checked. Retry.');

      const latestTransactions = (workspaces.getUnlocked(ownerId)?.data ?? current).transactions;
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
            const transaction = await fetchTransaction(
              current.network,
              utxo.txid,
              signal,
              undefined,
              {
                scope: fetchScope,
                priority: 'background',
              },
            );
            if (transaction.confirmations !== undefined && transaction.confirmations < 0)
              return undefined;
            const conflictingHeight =
              transaction.blockHeight !== undefined && transaction.blockHeight !== utxo.height;
            const observed = conflictingHeight
              ? {
                  ...transaction,
                  blockHeight: utxo.height,
                  blockhash: undefined,
                  blocktime: undefined,
                  time: undefined,
                  confirmations: undefined,
                  mempool: undefined,
                }
              : {
                  ...transaction,
                  blockHeight: utxo.height,
                  confirmations:
                    transaction.confirmations !== undefined && transaction.confirmations > 0
                      ? transaction.confirmations
                      : undefined,
                  mempool: undefined,
                };
            setOperation(
              `Loading UTXO timestamps ${++loaded}/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
            );
            return observed;
          } catch {
            signal.throwIfAborted();
            setOperation(
              `Loading UTXO timestamps ${++loaded}/${Math.min(detailTargets.length, MAX_SCAN_TRANSACTIONS)}`,
            );
            return undefined;
          }
        },
      );
      signal.throwIfAborted();
      const loadedDetails = details.filter(
        (transaction): transaction is Transaction => !!transaction,
      );
      if (loadedDetails.length) mergeTransactions(ownerId, loadedDetails);
    });
  }
  function selectedAddressGraphAction() {
    if (!activeWorkspace || selected?.kind !== 'address' || !selected.address) return undefined;
    const address = selectedAddressForHistory(selected, activeWorkspace.network);
    return address
      ? { address, generation: selectionGeneration.current, ownerId: activeWorkspace.id }
      : undefined;
  }
  function revealAddressGraphNodes(ownerId: string, ids: string[]) {
    if (!ids.length) return;
    workspaces.getUnlocked(ownerId)?.edit((current) => {
      const revealed = addGraphNodes(current, ids);
      return {
        ...revealed,
        view: { ...revealed.view, smallAmountThreshold: undefined },
      };
    }, false);
    setGraphFilters({});
  }
  function showRecentAddressUtxos() {
    const action = selectedAddressGraphAction();
    if (!action) return;
    const current = workspaces.getUnlocked(action.ownerId)?.data;
    if (!current) return;
    const cached = current.addressUtxos?.[action.address];
    if (!cached && !canLoadChainData) return;
    void run(async (signal) => {
      setOperation('Loading recent UTXOs…');
      const observation =
        cached ?? (await fetchAddressUtxos(current.network, action.address, signal));
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== action.generation ||
        activeWorkspaceRef.current?.id !== action.ownerId
      )
        return;
      if (!cached)
        workspaces.getUnlocked(action.ownerId)?.edit(
          (latest) => ({
            ...latest,
            addressUtxos: {
              ...latest.addressUtxos,
              [action.address]: observation,
            },
          }),
          false,
        );
      const recent = recentAddressUtxos(observation, RECENT_ADDRESS_GRAPH_LIMIT);
      if (!recent.length) {
        setNotice('No unspent outputs observed for this address.');
        return;
      }
      const latestTransactions = (workspaces.getUnlocked(action.ownerId)?.data ?? current)
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
            const transaction = await fetchTransaction(
              current.network,
              utxo.txid,
              signal,
              utxo.height,
              { scope: fetchScope, priority: 'visible' },
            );
            return transaction.confirmations !== undefined && transaction.confirmations < 0
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
      mergeTransactions(
        action.ownerId,
        details.filter((transaction): transaction is Transaction => !!transaction),
        [...new Set(recent.map((utxo) => utxo.txid))],
      );
      const latest = workspaces.getUnlocked(action.ownerId)?.data;
      if (!latest) return;
      const outpointIds = recent.flatMap((utxo) => {
        const transaction = latest.transactions[utxo.txid];
        return transaction?.vout.some((output) => output.n === utxo.vout)
          ? [outputNodeId(utxo.txid, utxo.vout)]
          : [];
      });
      revealAddressGraphNodes(action.ownerId, outpointIds);
    });
  }
  function showRecentAddressTransactions() {
    const action = selectedAddressGraphAction();
    if (!action) return;
    const current = workspaces.getUnlocked(action.ownerId)?.data;
    if (!current) return;
    const historyKey = addressHistoryLoadKey(action.ownerId, current.network, action.address);
    void run(async (signal) => {
      let latest = workspaces.getUnlocked(action.ownerId)?.data ?? current;
      let history = listAddressHistory(latest, action.address);
      let historyLoadActive = addressHistoryJobsRef.current.has(historyKey);
      const needsObservedHistory =
        !history || history.source === 'loaded transactions' || history.entries.length === 0;
      if (needsObservedHistory && !historyLoadActive && canLoadChainData) {
        setOperation('Loading recent transactions…');
        const observedHistory = await fetchHistory(
          latest.network,
          addressToScriptHash(action.address, latest.network),
          signal,
        );
        signal.throwIfAborted();
        if (
          selectionGeneration.current !== action.generation ||
          activeWorkspaceRef.current?.id !== action.ownerId
        )
          return;
        workspaces.getUnlocked(action.ownerId)?.edit(
          (workspace) => ({
            ...workspace,
            addressHistories: {
              ...workspace.addressHistories,
              [action.address]: {
                history: observedHistory,
                truncated: false,
                scannedAt: new Date().toISOString(),
              },
            },
          }),
          false,
        );
        latest = workspaces.getUnlocked(action.ownerId)?.data ?? latest;
        history = listAddressHistory(latest, action.address);
        historyLoadActive = addressHistoryJobsRef.current.has(historyKey);
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
      const latestTransactions = latest.transactions;
      const detailTargets = recent.filter((entry) => !latestTransactions[entry.txid]);
      const details = await mapLimit(
        canLoadChainData ? detailTargets : [],
        4,
        async (entry): Promise<Transaction | undefined> => {
          try {
            return await fetchTransaction(latest.network, entry.txid, signal, entry.height, {
              scope: fetchScope,
              priority: 'visible',
            });
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
      mergeTransactions(
        action.ownerId,
        details.filter((transaction): transaction is Transaction => !!transaction),
        [...new Set(recent.map((entry) => entry.txid))],
      );
      revealAddressGraphNodes(
        action.ownerId,
        recent.map((entry) => txNodeId(entry.txid)),
      );
    });
  }
  function openAddressHistoryTransaction(txid: string, height?: number, vout?: number) {
    if (!activeWorkspace || !/^[0-9a-f]{64}$/i.test(txid)) return;
    const ownerId = activeWorkspace.id;
    const generation = selectionGeneration.current;
    void run(async (signal) => {
      const current = workspaces.getUnlocked(ownerId)?.data;
      if (!current) return;
      const cached = current.transactions[txid];
      setOperation(cached ? 'Opening transaction…' : 'Loading transaction…');
      const transaction =
        cached ??
        (await fetchTransaction(current.network, txid, signal, height, {
          scope: fetchScope,
          priority: 'navigation',
        }));
      signal.throwIfAborted();
      if (selectionGeneration.current !== generation || activeWorkspaceRef.current?.id !== ownerId)
        return;
      mergeTransactions(ownerId, cached ? [] : [transaction], [transaction.txid]);
      workspaces.getUnlocked(ownerId)?.edit((latest) => {
        const admitted = addGraphNodes(latest, [txNodeId(transaction.txid)]);
        return {
          ...admitted,
          view: {
            ...admitted.view,
            transactionFlow: {
              ...latest.view.transactionFlow,
              transactionId: transaction.txid,
              open: true,
            },
          },
        };
      }, false);
      const selectedId =
        vout !== undefined && transaction.vout.some((output) => output.n === vout)
          ? outputNodeId(transaction.txid, vout)
          : txNodeId(transaction.txid);
      select(selectedId);
      setFocusRequest({ id: selectedId, token: Date.now() });
    });
  }
  async function addQuery(text: string) {
    if (!activeWorkspace || !text || operationRef.current) return;
    text = text.trim();
    if (/^(bc1|tb1)/i.test(text)) text = text.toLowerCase();
    const existing = loadedLookupId(text);
    if (existing && !existing.startsWith('addr:')) {
      setError('');
      setNotice('');
      mergeTransactions(activeWorkspace.id, [], [existing.split(':')[1]]);
      revealLookup(existing);
      if (!canLoadChainData || !prefetchDepth) {
        clearQuery();
        return;
      }
    }
    if (!/^[0-9a-f]{64}(:\d+)?$/i.test(text)) {
      if (!canLoadChainData && !existing) return;
      setError('');
      setNotice('');
      revealLookup(addressNodeId(text));
      clearQuery();
      startAddressHistoryLoad(text);
      return;
    }
    if (!canLoadChainData) return;
    const generation = selectionGeneration.current;
    await run(async (signal) => {
      if (/^[0-9a-f]{64}(:\d+)?$/i.test(text)) {
        const [id, index] = text.split(':');
        setOperation('Loading transaction…');
        const cached = activeWorkspace.transactions[id.toLowerCase()];
        const t =
          cached ??
          (await fetchTransaction(activeWorkspace.network, id, signal, undefined, {
            scope: fetchScope,
            priority: 'navigation',
          }));
        if (index !== undefined && !t.vout.some((o) => o.n === Number(index)))
          throw new Error('This output index does not exist in the transaction.');
        signal.throwIfAborted();
        if (
          selectionGeneration.current !== generation ||
          activeWorkspaceRef.current?.id !== activeWorkspace.id
        )
          return;
        mergeTransactions(activeWorkspace.id, cached ? [] : [t], [t.txid]);
        const requestedId =
          index === undefined ? txNodeId(t.txid) : outputNodeId(t.txid, Number(index));
        revealLookup(requestedId);
        if (prefetchDepth) {
          const before = workspaces.getUnlocked(activeWorkspace.id)!.data;
          const result = await loadAncestors([t], before.transactions, prefetchDepth, {
            fetch: (id, signal) => getTransaction(id, signal, 'background'),
            signal,
            onProgress: setOperation,
          });
          signal.throwIfAborted();
          if (
            mergeTransactions(
              activeWorkspace.id,
              result.transactions,
              result.resolvedTransactionIds,
              result.transactions.map((tx) => tx.txid),
              txNodeId(t.txid),
            )
          )
            setNotice(ancestryNotice(result));
        }
      }
      clearQuery();
    });
  }
  async function expand(
    direction: 'funding' | 'spending',
    nodeId = selectedId,
    options?: { preserveCamera?: boolean },
  ) {
    if (!activeWorkspace) return;
    const snapshot = workspaces.getUnlocked(activeWorkspace.id)?.data;
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
      if (!traceSourceExists(workspaces.getUnlocked(activeWorkspace.id)!.data, traceSourceId))
        return;
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
                transactionFlow: {
                  ...current.view.transactionFlow,
                  transactionId: transaction.txid,
                  open: true,
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
          const before = workspaces.getUnlocked(activeWorkspace.id)!.data;
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
                  transactionFlow: {
                    ...admitted.view.transactionFlow,
                    transactionId: result.transactions[0].txid,
                    open: true,
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
        const active = workspaces.getUnlocked(activeWorkspace.id)?.data;
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
  const recentAddressUtxoTargets = useMemo(
    () => recentAddressUtxos(addressUtxos, RECENT_ADDRESS_GRAPH_LIMIT),
    [addressUtxos],
  );
  const recentAddressTransactionTargets = useMemo(
    () => recentAddressHistoryEntries(addressHistory, RECENT_ADDRESS_GRAPH_LIMIT),
    [addressHistory],
  );
  return {
    addressHistory,
    addressBalance,
    addressUtxos,
    addressHistoryLoad,
    backgroundAddressHistoryLoad,
    getTransaction,
    run,
    mergeTransactions,
    openAddressHistory,
    refreshAddressBalance,
    loadAddressUtxos,
    showRecentAddressUtxos,
    showRecentAddressTransactions,
    openAddressHistoryTransaction,
    addQuery,
    expand,
    recentAddressUtxoTargets,
    recentAddressTransactionTargets,
  };
}

/** Bounded evidence loading and cancellation shared across workbenches. */
export type WorkspaceEvidence = ReturnType<typeof useWorkspaceEvidence>;
