import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type { ChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import { fetchWalletUtxos } from '../../../../Core/Workspace/Wallets/WalletUtxos/fetchWalletUtxos';
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
}: {
  workspace?: Workspace;
  wallet?: Wallet;
  transactions: ChainDataAcquisition;
  enabled: boolean;
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
  const activeScope = useRef(scope);
  const [state, setState] = useState<{
    scope: object;
    loading: boolean;
    error: string;
    failed: number;
    nextCursor?: number;
    completed: boolean;
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
        };
  const request = useRef<AbortController | undefined>(undefined);
  const attempted = useRef(false);
  useEffect(() => {
    activeScope.current = scope;
  }, [scope]);

  async function check(cursor = 0) {
    if (!workspace || !wallet || !enabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    attempted.current = true;
    const failed = cursor ? current.failed : 0;
    setState({ ...current, scope, failed, loading: true, error: '' });
    const isCurrent = () =>
      !controller.signal.aborted && activeScope.current === scope && request.current === controller;
    try {
      const batch = await fetchWalletUtxos(workspace.network, wallet, {
        cursor,
        signal: controller.signal,
        readAddressUtxos: transactions.read.addressUtxos,
      });
      if (!isCurrent()) return;
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
          nextCursor: batch.nextCursor,
          failed: failed + batch.errors.length,
          error: batch.errors.length
            ? 'Some address checks failed. Previous observations were retained. Retry to check again.'
            : '',
        });
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
      if (activeScope.current === scope) setState((value) => ({ ...value, loading: false }));
    }
  }

  const startAutomaticCheck = useEffectEvent(() => {
    // A retained check remains explicitly dated. Reopening does not silently renew it.
    if (enabled && !attempted.current && !retained) void check();
  });
  useEffect(() => {
    request.current?.abort();
    request.current = undefined;
    attempted.current = false;
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [scope]);
  useEffect(() => {
    startAutomaticCheck();
    return () => {
      if (request.current) {
        request.current.abort();
        request.current = undefined;
        attempted.current = false;
        setState((value) => ({ ...value, loading: false }));
      }
    };
  }, [enabled, scope]);

  const utxos = useMemo(
    () =>
      retained
        ? {
            ...retained,
            failed: retained.failed + current.failed,
            // Keep an in-progress refresh's bounded continuation even when older pages exist.
            nextCursor: current.completed ? current.nextCursor : retained.nextCursor,
          }
        : undefined,
    [retained, current.failed, current.completed, current.nextCursor],
  );
  return { utxos, loading: current.loading, error: current.error, check };
}
