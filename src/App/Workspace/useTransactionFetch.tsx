import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fetchTransaction } from '../../Infra/Bitcoin/api';
import type { Network } from '../../Domain/types';
import type {
  FetchPriority,
  TransactionFetchScope,
} from '../../Infra/Bitcoin/transactionScheduler';

export const TransactionFetchContext = createContext<TransactionFetchScope | undefined>(undefined);

/** Capture the session token, so callbacks retained after lock cannot borrow a reopened session. */
export function useTransactionFetch(priority: FetchPriority) {
  const scope = useContext(TransactionFetchContext);
  return useMemo(
    () => (network: Network, id: string, signal?: AbortSignal, height?: number) => {
      if (!scope) return Promise.reject(new Error('Open a workspace before loading transactions.'));
      return fetchTransaction(network, id, signal, height, { scope, priority });
    },
    [scope, priority],
  );
}

export function TransactionFetchShell({
  scope,
  children,
}: {
  scope?: TransactionFetchScope;
  children: ReactNode;
}) {
  return (
    <TransactionFetchContext value={scope}>
      <div className="app-shell">{children}</div>
    </TransactionFetchContext>
  );
}
