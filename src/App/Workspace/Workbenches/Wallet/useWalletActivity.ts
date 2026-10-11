import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { walletActivitySummary } from '../../../../Core/Workspace/Wallets/walletActivity';
import type { TransactionFetchScope } from '../../../../Core/ChainData/transactionScheduler';
import type { WalletUtxoBatch } from '../../../../Core/Workspace/Wallets/WalletUtxos/fetchWalletUtxos';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { ChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../useWorkspaceOperation';
import type { WorkspaceCore } from '../../workspaceCore';

export interface WalletDiscovery {
  gapLimit: number;
  setGapLimit: (value: number) => void;
  addressesPerBranch: number;
  setAddressesPerBranch: (value: number) => void;
  monitorActivity: boolean;
  setMonitorActivity: (value: boolean) => void;
  refreshIntervalSeconds: number;
  setRefreshIntervalSeconds: (value: number) => void;
  run: (wallet?: Wallet) => Promise<void>;
  coinChecks: Record<string, { wallet: Wallet; coins: WalletUtxoBatch }>;
  refresh: { walletId?: string; loading: boolean; message: string; error: string };
}
interface Inputs {
  core: WorkspaceCore;
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  canLoadChainData: boolean;
  fitAll: () => void;
  automatic: { walletId?: string; ready: boolean; busy: boolean };
}
const DEFAULT_INTERVAL_SECONDS = 60;

/** One UI refresh intention. Session owns all stages and accepted checkpoints. */
export function useWalletActivity({
  core,
  transactions,
  operation,
  canLoadChainData,
  fitAll,
  automatic,
}: Inputs): WalletDiscovery {
  const { workspaceId, workspaces, activeWorkspaceRef, setOperation, setNotice } = core;
  const [gapLimit, setGapLimit] = useState(20);
  const [addressesPerBranch, setAddressesPerBranch] = useState(200);
  const monitorActivity = core.activeWorkspace?.view.automaticWalletRefresh !== false;
  const refreshIntervalSeconds =
    core.activeWorkspace?.view.walletRefreshIntervalSeconds ?? DEFAULT_INTERVAL_SECONDS;
  const interval = refreshIntervalSeconds * 1000;
  const setRefreshIntervalSeconds = (value: number) => {
    if (!Number.isInteger(value) || value < 10 || value > 86400) return;
    core.edit(
      (current) => ({ ...current, view: { ...current.view, walletRefreshIntervalSeconds: value } }),
      false,
    );
  };
  const setMonitorActivity = (value: boolean) =>
    core.edit(
      (current) => ({
        ...current,
        view: { ...current.view, automaticWalletRefresh: value },
      }),
      false,
    );
  const { cancel } = operation;
  const sessionScope = workspaceId ? workspaces.getUnlocked(workspaceId)?.fetchScope : undefined;
  const attempts = useRef(new WeakMap<TransactionFetchScope, Map<string, number>>());
  const ownedSignal = useRef<AbortSignal | undefined>(undefined);
  const [state, setState] = useState<{
    scope?: TransactionFetchScope;
    checks: WalletDiscovery['coinChecks'];
    refresh: WalletDiscovery['refresh'];
  }>({ checks: {}, refresh: { loading: false, message: '', error: '' } });

  async function refreshWallets(targetIds: string[], background: boolean) {
    const session = workspaceId ? workspaces.getUnlocked(workspaceId) : undefined;
    if (!session || !canLoadChainData) return;
    const scope = session.fetchScope;
    await operation.run(
      async (signal) => {
        ownedSignal.current = signal;
        const attempted = attempts.current.get(scope) ?? new Map<string, number>();
        attempts.current.set(scope, attempted);
        const stillCurrent = () =>
          workspaces.getUnlocked(session.data.id)?.fetchScope === scope &&
          activeWorkspaceRef.current?.id === session.data.id &&
          !scope.closed;
        const assertCurrent = () => {
          if (!stillCurrent()) throw new DOMException('Workspace session ended.', 'AbortError');
        };
        let lastProgress = -Infinity;
        let progressWallet = '';
        const progress = (walletId: string, message: string) => {
          if (!stillCurrent()) return;
          const now = Date.now();
          if (progressWallet === walletId && now - lastProgress < 250) return;
          lastProgress = now;
          progressWallet = walletId;
          setState((previous) => ({
            scope,
            checks: previous.scope === scope ? previous.checks : {},
            refresh: { walletId, loading: true, message, error: '' },
          }));
          if (!background) setOperation(message);
        };
        try {
          for (const id of targetIds) {
            signal.throwIfAborted();
            assertCurrent();
            const current = workspaces.getUnlocked(session.data.id)!;
            const wallet = current.data.wallets.definitions.find((entry) => entry.id === id);
            if (!wallet) continue;
            attempted.set(id, Date.now());
            const initiallyEmpty = !Object.keys(current.data.chainData.transactions).length;
            progress(id, `Refreshing ${wallet.name}`);
            const result = await transactions.observe.walletRefresh(wallet, {
              gap: gapLimit,
              maxIndex: addressesPerBranch,
              signal,
              onProgress: (value) => progress(id, value.message),
            });
            assertCurrent();
            const failedTools =
              result.analysis?.reports.filter((report) => report.status === 'error').length ?? 0;
            const partial = !result.wallet.scanComplete || result.coins.errors.length > 0;
            const message = `${walletActivitySummary(result.wallet)}${partial ? ' · Partial refresh' : ''}${result.coins.errors.length ? ` · ${result.coins.errors.length} address checks failed` : ''}${failedTools ? ` · ${failedTools} analysis tools failed` : ''}`;
            setState((previous) => ({
              scope,
              checks: {
                ...(previous.scope === scope ? previous.checks : {}),
                [id]: { wallet: result.wallet, coins: result.coins },
              },
              refresh: {
                walletId: id,
                loading: false,
                message,
                error: partial || failedTools ? message : '',
              },
            }));
            if (!background) setNotice(message);
            if (initiallyEmpty && result.wallet.lastActivity?.addedTransactionCount) fitAll();
          }
          if (background && monitorActivity) {
            const current = workspaces.getUnlocked(session.data.id)?.data;
            if (current && stillCurrent() && current.chainData.watchedAddresses.length) {
              attempted.set('watched-addresses', Date.now());
              await transactions.observe.watchedAddresses(current.chainData.watchedAddresses, {
                signal,
              });
            }
          }
        } catch (cause) {
          if (stillCurrent())
            setState((previous) => ({
              ...previous,
              refresh: {
                ...previous.refresh,
                loading: false,
                message: signal.aborted
                  ? 'Refresh interrupted · completed observations retained'
                  : 'Refresh failed',
                error: signal.aborted
                  ? ''
                  : cause instanceof Error
                    ? cause.message
                    : 'Refresh failed. Retry to continue.',
              },
            }));
          if (ownedSignal.current === signal) ownedSignal.current = undefined;
          await Promise.reject(cause);
        }
        if (ownedSignal.current === signal) ownedSignal.current = undefined;
      },
      { background },
    );
  }
  async function run(wallet?: Wallet) {
    const current = workspaceId ? workspaces.getUnlocked(workspaceId)?.data : undefined;
    if (!current) return;
    await refreshWallets(
      wallet ? [wallet.id] : current.wallets.definitions.map((entry) => entry.id),
      false,
    );
  }
  const poll = useEffectEvent(() => {
    if (
      !automatic.ready ||
      automatic.busy ||
      operation.isActive() ||
      !sessionScope ||
      document.visibilityState === 'hidden'
    )
      return;
    const current = workspaceId ? workspaces.getUnlocked(workspaceId)?.data : undefined;
    if (!current || sessionScope.closed) return;
    const last = attempts.current.get(sessionScope);
    const targets = current.wallets.definitions
      .filter((wallet) =>
        monitorActivity
          ? Date.now() - (last?.get(wallet.id) ?? -Infinity) >= interval
          : !wallet.scannedAt && !last?.has(wallet.id),
      )
      .sort((a, b) => Number(b.id === automatic.walletId) - Number(a.id === automatic.walletId));
    const watchesDue =
      monitorActivity &&
      current.chainData.watchedAddresses.length > 0 &&
      Date.now() - (last?.get('watched-addresses') ?? -Infinity) >= interval;
    if (targets.length || watchesDue)
      void refreshWallets(
        targets.map((wallet) => wallet.id),
        true,
      );
  });
  const walletIds = core.activeWorkspace?.wallets.definitions.map((wallet) => wallet.id).join(',');
  useEffect(() => {
    poll();
    const timer = setInterval(poll, interval);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [
    sessionScope,
    walletIds,
    automatic.walletId,
    automatic.ready,
    automatic.busy,
    monitorActivity,
    interval,
  ]);
  useEffect(
    () => () => {
      if (ownedSignal.current) cancel(ownedSignal.current);
    },
    [sessionScope, cancel],
  );
  return {
    gapLimit,
    setGapLimit,
    addressesPerBranch,
    setAddressesPerBranch,
    monitorActivity,
    setMonitorActivity,
    refreshIntervalSeconds,
    setRefreshIntervalSeconds,
    run,
    coinChecks: state.scope === sessionScope ? state.checks : {},
    refresh:
      state.scope === sessionScope ? state.refresh : { loading: false, message: '', error: '' },
  };
}
