import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type { ChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import {
  fetchWalletUtxos,
  type WalletUtxoBatch,
} from '../../../../Core/Workspace/Wallets/WalletUtxos/fetchWalletUtxos';
import {
  readWalletUtxoCheck,
  type WalletUtxoCheck,
} from '../../../../Core/Workspace/Wallets/WalletUtxos/walletUtxoCheck';

export interface WalletUtxoController {
  utxos?: WalletUtxoCheck;
  loading: boolean;
  error: string;
  check: (cursor?: number) => Promise<void>;
}

/** UI request state only. Successful observations belong to the encrypted workspace. */
export function useWalletUtxos({
  workspace,
  wallet,
  transactions,
  enabled,
  completedCheck,
}: {
  workspace?: Workspace;
  wallet?: Wallet;
  transactions: ChainDataAcquisition;
  enabled: boolean;
  completedCheck?: { wallet: Wallet; coins: WalletUtxoBatch };
}): WalletUtxoController {
  const scope = useMemo(
    () => ({
      workspaceId: workspace?.id,
      network: workspace?.network,
      walletId: wallet?.id,
      key: wallet?.key,
      scriptType: wallet?.scriptType,
      addresses: wallet?.addresses,
      scannedAt: wallet?.scannedAt,
      transactions,
    }),
    [
      workspace?.id,
      workspace?.network,
      wallet?.id,
      wallet?.key,
      wallet?.scriptType,
      wallet?.addresses,
      wallet?.scannedAt,
      transactions,
    ],
  );
  const network = workspace?.network;
  const observations = workspace?.chainData.addressUtxos;
  const addresses = wallet?.addresses;
  const retained = useMemo(
    () =>
      network && addresses
        ? readWalletUtxoCheck({ network, chainData: { addressUtxos: observations } }, { addresses })
        : undefined,
    [network, observations, addresses],
  );
  const activeScope = useRef({ scope, enabled });
  const [state, setState] = useState<{
    scope: object;
    loading: boolean;
    error: string;
    failed: number;
    nextCursor?: number;
    completed: boolean;
    refresh?: typeof completedCheck;
  }>({ scope, loading: false, error: '', failed: 0, completed: false });
  const current =
    state.scope === scope
      ? state
      : {
          scope,
          loading: false,
          error: '',
          failed: 0,
          completed: false,
          nextCursor: undefined,
          refresh: undefined,
        };
  const request = useRef<AbortController | undefined>(undefined);
  const refreshed =
    completedCheck?.wallet.id === wallet?.id &&
    completedCheck?.wallet.key === wallet?.key &&
    completedCheck?.wallet.scriptType === wallet?.scriptType &&
    completedCheck?.wallet.addresses === wallet?.addresses
      ? completedCheck
      : undefined;
  const checked = current.completed && current.refresh === refreshed;
  useLayoutEffect(() => {
    activeScope.current = { scope, enabled };
  }, [scope, enabled]);

  async function check(cursor = 0) {
    if (!workspace || !wallet || !enabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const failed = cursor ? (checked ? current.failed : (refreshed?.coins.errors.length ?? 0)) : 0;
    setState({ ...current, scope, refresh: refreshed, failed, loading: true, error: '' });
    const isCurrent = () =>
      !controller.signal.aborted &&
      activeScope.current.scope === scope &&
      activeScope.current.enabled &&
      request.current === controller;
    try {
      const batch = await fetchWalletUtxos(workspace.network, wallet, {
        cursor,
        signal: controller.signal,
        readAddressUtxos: transactions.read.addressUtxos,
      });
      if (isCurrent()) {
        const accepted = transactions.observe.addresses(
          { addressUtxos: batch.observations },
          (latest) =>
            latest.wallets.definitions.some(
              (item) =>
                item.id === wallet.id &&
                item.key === wallet.key &&
                item.scriptType === wallet.scriptType &&
                item.addresses === wallet.addresses,
            ),
        );
        if (accepted)
          setState({
            scope,
            loading: false,
            completed: true,
            refresh: refreshed,
            nextCursor: batch.nextCursor,
            failed: failed + batch.errors.length,
            error: batch.errors.length
              ? 'Some address checks failed. Previous observations were retained. Retry to check again.'
              : '',
          });
      }
    } catch (cause) {
      if (isCurrent())
        setState({
          ...current,
          scope,
          loading: false,
          error: cause instanceof Error ? cause.message : 'Could not check wallet UTXOs.',
        });
    }
    if (request.current === controller) {
      request.current = undefined;
      // Rejected publication must not leave the action looking busy.
      if (activeScope.current.scope === scope) setState((value) => ({ ...value, loading: false }));
    }
  }

  useEffect(() => {
    request.current?.abort();
    request.current = undefined;
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [scope]);
  useEffect(() => {
    return () => {
      if (request.current) {
        request.current.abort();
        request.current = undefined;
        setState((value) => ({ ...value, loading: false }));
      }
    };
  }, [enabled, scope]);

  const utxos = useMemo(
    () =>
      retained
        ? {
            ...retained,
            failed:
              retained.failed + (checked ? current.failed : (refreshed?.coins.errors.length ?? 0)),
            // Keep an in-progress refresh's bounded continuation even when older pages exist.
            nextCursor: checked
              ? current.nextCursor
              : refreshed
                ? refreshed.coins.nextCursor
                : retained.nextCursor,
          }
        : undefined,
    [retained, current.failed, current.nextCursor, checked, refreshed],
  );
  return {
    utxos,
    loading: current.loading,
    error:
      current.error ||
      (!checked && refreshed?.coins.errors.length
        ? 'Some address checks failed. Previous observations were retained. Retry to check again.'
        : ''),
    check,
  };
}
