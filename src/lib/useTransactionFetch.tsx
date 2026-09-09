import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fetchTransaction } from './api';
import type { Network } from '../domain/types';
import type { FetchKind, FetchPriority, TransactionFetchScope } from './transactionScheduler';

export const TransactionFetchContext = createContext<TransactionFetchScope | undefined>(undefined);

/** Capture the session token, so callbacks retained after lock cannot borrow a reopened session. */
export function useTransactionFetch(priority: FetchPriority, kind: FetchKind) {
  const scope = useContext(TransactionFetchContext);
  return useMemo(
    () => (network: Network, id: string, signal?: AbortSignal, height?: number) => {
      if (!scope) return Promise.reject(new Error('Open a workspace before loading transactions.'));
      return fetchTransaction(network, id, signal, height, { scope, priority, kind });
    },
    [scope, priority, kind],
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
