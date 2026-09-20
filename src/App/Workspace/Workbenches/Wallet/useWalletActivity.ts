import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { walletActivitySummary } from '../../../../Core/Workspace/Wallets/walletActivity';

import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../Core/Workspace/workspace';

import type { ChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../useWorkspaceOperation';
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
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  canLoadChainData: boolean;
  /** Fits the graph once a first scan brings a wallet's transactions in. */
  fitAll: () => void;
}
export function useWalletActivity({
  core,
  transactions,
  operation,
  canLoadChainData,
  fitAll,
}: Inputs): WalletDiscovery {
  const { activeWorkspace, activeWorkspaceRef, workspaceId, setOperation, setNotice } = core;
  const { run, cancel, isActive } = operation;

  const [gapLimit, setGapLimit] = useState(20);
  const [addressesPerBranch, setAddressesPerBranch] = useState(200);
  // Scoped to the workspace being monitored, so switching or locking one stops
  // the timer without a reset step that could outlive its workspace.
  const [monitoredWorkspaceId, setMonitoredWorkspaceId] = useState<string>();
  const monitorActivity = !!workspaceId && monitoredWorkspaceId === workspaceId;
  const setMonitorActivity = (value: boolean) =>
    setMonitoredWorkspaceId(value ? workspaceId : undefined);
  const monitorOperationSignal = useRef<AbortSignal | undefined>(undefined);
  async function refreshWallets(targets: Wallet[], initial: Workspace, signal: AbortSignal) {
    let snapshot = initial;
    let added = 0;
    let refreshed = 0;
    let partial = false;
    let missing = 0;
    for (const target of targets) {
      setOperation(`${target.scannedAt ? 'Refreshing' : 'Scanning'} ${target.name}…`);
      const result = await transactions.observe.walletScan(target, {
        gap: gapLimit,
        maxIndex: addressesPerBranch,
        signal,
        onProgress: (p) => setOperation(p.message),
      });
      snapshot = result.snapshot;
      added += result.wallet.lastActivity?.addedTransactionCount ?? 0;
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
        target ? [target] : activeWorkspace.wallets.definitions,
        activeWorkspace,
        signal,
      );
      const checkedWallets = result.snapshot.wallets.definitions.filter(
        (entry) => !target || entry.id === target.id,
      );
      const pendingTransactions = checkedWallets.reduce(
        (count, entry) => count + (entry.pendingTransactionIds?.length ?? 0),
        0,
      );
      setNotice(
        `${target ? walletActivitySummary(result.snapshot.wallets.definitions.find((item) => item.id === target.id)!) : `${result.added} new to workspace · ${result.refreshed} transactions refreshed`}.${pendingTransactions ? ` ${pendingTransactions} transactions waiting; Refresh again to continue.` : result.partial ? ` Address search reached its ${addressesPerBranch}/branch limit. Increase Addresses / branch in Graph wallet controls to search further.` : ''}${result.missing ? ` ${result.missing} previously observed transactions absent from checked histories; saved graph retained.` : ''}`,
      );
      // Only the first discovery frames an empty canvas. Returning checks leave
      // the user's camera, selection, filters and annotations alone.
      if (!Object.keys(activeWorkspace.chainData.transactions).length && result.added) fitAll();
    });
  }
  const pollWalletActivity = useEffectEvent(() => {
    if (isActive()) return;
    const current = activeWorkspaceRef.current;
    if (!current) return;
    void run(async (signal) => {
      monitorOperationSignal.current = signal;
      setOperation('Checking watched activity…');
      const checked = await refreshWallets(current.wallets.definitions, current, signal);
      const polled = await transactions.observe.watchedAddresses(
        current.chainData.watchedAddresses,
        {
          signal,
          accept: (workspace) => activeWorkspaceRef.current?.id === workspace.id,
        },
      );
      const added = checked.added + polled.added;
      const refreshed = checked.refreshed + polled.refreshed;
      const partial = checked.partial || polled.partial;
      setNotice(
        `Activity check finished · ${added} new to workspace · ${refreshed} transactions refreshed.${partial ? ' Some history remains partial; review scan limits.' : ''}${checked.missing ? ' Previously observed transactions disappeared from checked histories; review wallet details.' : ''}`,
      );
    }).finally(() => {
      monitorOperationSignal.current = undefined;
    });
  });
  // Poll from the client, only while this workspace is unlocked. Backend never owns scan state.
  useEffect(() => {
    if (!monitorActivity || !canLoadChainData || !workspaceId) return;
    const timer = setInterval(pollWalletActivity, 30000);
    return () => {
      clearInterval(timer);
      cancel(monitorOperationSignal.current);
    };
  }, [monitorActivity, canLoadChainData, workspaceId, gapLimit, addressesPerBranch, cancel]);
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
