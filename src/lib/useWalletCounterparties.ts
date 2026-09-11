import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  createWalletCounterpartyLoader,
  type WalletCounterpartyOptions,
} from './walletCounterparties';

export type { WalletCounterpartyOptions, WalletCounterpartyState } from './walletCounterparties';

export function useWalletCounterparties(options: WalletCounterpartyOptions) {
  const [current] = useState(() => createWalletCounterpartyLoader());
  const state = useSyncExternalStore(current.subscribe, current.getSnapshot, current.getSnapshot);
  useEffect(() => {
    current.configure(options);
  }, [
    current,
    options.workspace.id,
    options.workspace.network,
    options.workspace.transactions,
    options.wallet.id,
    options.wallet.addresses,
    options.groups,
    options.active,
    options.enabled,
    options.fetch,
    options.update,
  ]);
  useEffect(() => () => current.stop(), [current]);
  return { ...state, loadMore: current.loadMore, retry: current.retry };
}
