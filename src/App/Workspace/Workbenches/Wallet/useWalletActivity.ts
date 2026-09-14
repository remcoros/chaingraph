import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { applyWalletScan, walletActivitySummary } from '../../../../Domain/Wallet/walletActivity';
import { clearContextProvenance } from '../../../../Domain/Workspace/workspace';
import { mergeTransactionObservations } from '../../../../Domain/Chain/prevouts';
import { type Transaction, type Wallet, type Workspace } from '../../../../Domain/types';
import { loadAddress, scanWallet } from '../../../../Infra/Bitcoin/api';
import type { RefObject } from 'react';

import type { AppState } from '../../../useAppState';
import type { ChainFetch } from '../../ChainData/useChainFetch';
import type { WorkspaceCore } from '../../workspaceCore';
/**
 * Address discovery for wallets: derive branches, pull their history and
 * optionally keep checking for new activity. Distinct from wallet analysis,
 * which looks for findings in already loaded transactions.
 */
export interface WalletDiscovery {
  /** Stop a branch after this many consecutive addresses with no history. */
  gapLimit: number;
  setGapLimit: (value: number) => void;
  /** Maximum addresses derived on each receive/change branch per run. */
  addressesPerBranch: number;
  setAddressesPerBranch: (value: number) => void;
  /** Re-check every unlocked wallet for new activity on a timer. */
  monitorActivity: boolean;
  setMonitorActivity: (value: boolean) => void;
  run: (wallet?: Wallet) => Promise<void> | void;
}
interface Inputs {
  core: WorkspaceCore;
  fetch: ChainFetch;
  fetchScope: AppState['fetchScope'];
  canLoadChainData: boolean;
  operationRef: RefObject<AbortController | undefined>;
  /** Fits the graph once a first scan brings a wallet's transactions in. */
  fitAll: () => void;
}
export function useWalletActivity({
  core,
  fetch,
  fetchScope,
  canLoadChainData,
  operationRef,
  fitAll,
}: Inputs): WalletDiscovery {
  const { activeWorkspace, activeWorkspaceRef, workspaceId, workspaces, setOperation, setNotice } =
    core;
  const { run, mergeTransactions } = fetch;

  const [gapLimit, setGapLimit] = useState(20);
  const [addressesPerBranch, setAddressesPerBranch] = useState(200);
  // Scoped to the workspace being monitored, so switching or locking one stops
  // the timer without a reset step that could outlive its workspace.
  const [monitoredWorkspaceId, setMonitoredWorkspaceId] = useState<string>();
  const monitorActivity = !!workspaceId && monitoredWorkspaceId === workspaceId;
  const setMonitorActivity = (value: boolean) =>
    setMonitoredWorkspaceId(value ? workspaceId : undefined);
  const monitorOperationRef = useRef<AbortController | undefined>(undefined);
  async function refreshWallets(targets: Wallet[], initial: Workspace, signal: AbortSignal) {
    let snapshot = initial;
    let added = 0;
    let refreshed = 0;
    let partial = false;
    let missing = 0;
    for (const target of targets) {
      setOperation(`${target.scannedAt ? 'Refreshing' : 'Scanning'} ${target.name}…`);
      const result = await scanWallet(target, snapshot.network, snapshot.transactions, {
        gap: gapLimit,
        maxIndex: addressesPerBranch,
        signal,
        fetchHints: { scope: fetchScope },
        onProgress: (p) => setOperation(p.message),
      });
      signal.throwIfAborted();
      workspaces
        .getUnlocked(initial.id)
        ?.edit((current) => applyWalletScan(current, result.wallet, result.transactions), false);
      snapshot = applyWalletScan(snapshot, result.wallet, result.transactions);
      added += result.wallet.lastActivity?.newTransactionIds.length ?? 0;
      refreshed += result.wallet.lastActivity?.refreshedTransactionCount ?? 0;
      missing += result.wallet.lastActivity?.missingTransactionCount ?? 0;
      partial = partial || !result.wallet.scanComplete;
    }
    return { snapshot, added, refreshed, partial, missing };
  }
  async function scan(target?: Wallet) {
    if (!activeWorkspace || !canLoadChainData) return;
    await run(async (signal) => {
      const result = await refreshWallets(
        target ? [target] : activeWorkspace.wallets,
        activeWorkspace,
        signal,
      );
      const checkedWallets = result.snapshot.wallets.filter(
        (entry) => !target || entry.id === target.id,
      );
      const pendingTransactions = checkedWallets.reduce(
        (count, entry) => count + (entry.pendingTransactionIds?.length ?? 0),
        0,
      );
      setNotice(
        `${target ? walletActivitySummary(result.snapshot.wallets.find((item) => item.id === target.id)!) : `${result.added} new to workspace · ${result.refreshed} transactions refreshed`}.${pendingTransactions ? ` ${pendingTransactions} transactions waiting; Refresh again to continue.` : result.partial ? ` Address search reached its ${addressesPerBranch}/branch limit. Increase Addresses / branch in Graph wallet controls to search further.` : ''}${result.missing ? ` ${result.missing} previously observed transactions absent from checked histories; saved graph retained.` : ''}`,
      );
      // Only the first discovery frames an empty canvas. Returning checks leave
      // the user's camera, selection, filters and annotations alone.
      if (!Object.keys(activeWorkspace.transactions).length && result.added) fitAll();
    });
  }
  const pollWalletActivity = useEffectEvent(() => {
    if (operationRef.current) return;
    const current = activeWorkspaceRef.current;
    if (!current) return;
    void run(async (signal) => {
      monitorOperationRef.current = operationRef.current;
      setOperation('Checking watched activity…');
      const checked = await refreshWallets(current.wallets, current, signal);
      let added = checked.added;
      let refreshed = checked.refreshed;
      let partial = checked.partial;
      let snapshot = checked.snapshot;
      const polledTransactions: Transaction[] = [];
      const polledObservedTransactionIds = new Set<string>();
      const refreshedHistories: NonNullable<Workspace['addressHistories']> = {};
      let pollFailed = false;
      let pollFailure: unknown;
      try {
        for (const address of current.watchedAddresses) {
          const result = await loadAddress(
            address,
            current.network,
            snapshot.transactions,
            signal,
            undefined,
            { scope: fetchScope },
          );
          signal.throwIfAborted();
          polledTransactions.push(...result.transactions);
          for (const txid of result.observedTransactionIds) polledObservedTransactionIds.add(txid);
          refreshedHistories[address] = {
            history: result.history,
            truncated: result.truncated,
            scannedAt: new Date().toISOString(),
          };
          added += result.transactions.filter((tx) => !snapshot.transactions[tx.txid]).length;
          refreshed += result.transactions.filter((tx) => !!snapshot.transactions[tx.txid]).length;
          snapshot = {
            ...clearContextProvenance(snapshot, result.observedTransactionIds),
            transactions: {
              ...snapshot.transactions,
              ...Object.fromEntries(
                result.transactions.map((tx) => [
                  tx.txid,
                  mergeTransactionObservations(
                    snapshot.transactions[tx.txid],
                    tx,
                    snapshot.network,
                  ),
                ]),
              ),
            },
          };
          partial = partial || result.truncated;
        }
      } catch (error) {
        pollFailed = true;
        pollFailure = error;
      }
      // Publish completed work as one immutable snapshot. If polling is cancelled,
      // preserve the addresses already checked before the abort as well.
      if (
        activeWorkspaceRef.current?.id === current.id &&
        activeWorkspaceRef.current.network === current.network
      ) {
        mergeTransactions(current.id, polledTransactions, [...polledObservedTransactionIds]);
        if (Object.keys(refreshedHistories).length)
          workspaces.getUnlocked(current.id)?.edit(
            (latest) => ({
              ...latest,
              addressHistories: {
                ...latest.addressHistories,
                ...refreshedHistories,
              },
            }),
            false,
          );
      }
      if (pollFailed) throw pollFailure;
      setNotice(
        `Activity check finished · ${added} new to workspace · ${refreshed} transactions refreshed.${partial ? ' Some history remains partial; review scan limits.' : ''}${checked.missing ? ' Previously observed transactions disappeared from checked histories; review wallet details.' : ''}`,
      );
    }).finally(() => {
      monitorOperationRef.current = undefined;
    });
  });
  // Poll from the client, only while this workspace is unlocked. Backend never owns scan state.
  useEffect(() => {
    if (!monitorActivity || !canLoadChainData || !workspaceId) return;
    const timer = setInterval(pollWalletActivity, 30000);
    return () => {
      clearInterval(timer);
      monitorOperationRef.current?.abort();
    };
  }, [monitorActivity, canLoadChainData, workspaceId, gapLimit, addressesPerBranch]);
  return {
    gapLimit,
    setGapLimit,
    addressesPerBranch,
    setAddressesPerBranch,
    monitorActivity,
    setMonitorActivity,
    run: scan,
  };
}
