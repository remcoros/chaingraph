import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ChainDataAcquisition } from '../../Core/Workspace/Session/chainDataAcquisition';
import type { Network } from '../../Core/Bitcoin';
import type { FetchPriority } from '../../Core/ChainData/transactionScheduler';

const TransactionFetchContext = createContext<ChainDataAcquisition | undefined>(undefined);

/** Capture the session token, so callbacks retained after lock cannot borrow a reopened session. */
export function useTransactionFetch(priority: FetchPriority) {
  const acquisition = useContext(TransactionFetchContext);
  return useMemo(
    () => (network: Network, id: string, signal?: AbortSignal, height?: number) => {
      if (!acquisition?.network)
        return Promise.reject(new Error('Open a workspace before loading transactions.'));
      if (network !== acquisition.network)
        return Promise.reject(new Error('Transaction request belongs to a different network.'));
      return acquisition.read.transaction(id, signal, priority, height);
    },
    [acquisition, priority],
  );
}

export function TransactionFetchProvider({
  acquisition,
  children,
}: {
  acquisition: ChainDataAcquisition;
  children: ReactNode;
}) {
  return <TransactionFetchContext value={acquisition}>{children}</TransactionFetchContext>;
}
