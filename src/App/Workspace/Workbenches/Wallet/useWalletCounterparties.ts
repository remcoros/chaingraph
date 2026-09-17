import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  createWalletCounterpartyLoader,
  type WalletCounterpartyConfiguration,
  type WalletCounterpartyOptions,
  type WalletCounterpartyWorkspace,
} from './walletCounterparties';

export type { WalletCounterpartyOptions, WalletCounterpartyState } from './walletCounterparties';

export function useWalletCounterparties({
  workspace,
  wallet,
  groups,
  active,
  enabled,
  fetch,
  update,
}: WalletCounterpartyOptions) {
  const [current] = useState(() => createWalletCounterpartyLoader());
  const state = useSyncExternalStore(current.subscribe, current.getSnapshot, current.getSnapshot);
  const evidence = useMemo<WalletCounterpartyWorkspace>(
    () => ({
      id: workspace.id,
      network: workspace.network,
      wallets: { definitions: workspace.wallets.definitions },
      chainData: { transactions: workspace.chainData.transactions },
    }),
    [
      workspace.id,
      workspace.network,
      workspace.wallets.definitions,
      workspace.chainData.transactions,
    ],
  );
  const options = useMemo<WalletCounterpartyConfiguration>(
    () => ({
      workspace: evidence,
      wallet: { id: wallet.id },
      groups,
      active,
      enabled,
      fetch,
      update,
    }),
    [evidence, wallet.id, groups, active, enabled, fetch, update],
  );
  useEffect(() => {
    current.configure(options);
  }, [current, options]);
  useEffect(() => () => current.stop(), [current]);
  return { ...state, loadMore: current.loadMore, retry: current.retry };
}
