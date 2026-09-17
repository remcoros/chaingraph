import { mergeTransactionObservations } from '../../ChainData';
import type { TransactionFetchScope } from '../../ChainData/transactionScheduler';
import type { Workspace } from '../workspace';

/** Session acceptance, not request completion, determines which observation is retained. */
export function reconcileChainObservations(
  previous: Workspace,
  incoming: Workspace,
  scope: TransactionFetchScope,
): Workspace {
  if (previous.chainData.transactions === incoming.chainData.transactions) return incoming;
  let transactions = incoming.chainData.transactions;
  for (const [id, transaction] of Object.entries(transactions)) {
    const current = previous.chainData.transactions[id];
    if (!current || current === transaction || !scope.isOlderObservation(transaction, current))
      continue;
    if (transactions === incoming.chainData.transactions) transactions = { ...transactions };
    // Keep useful compatible previous-output enrichment from the older request.
    transactions[id] = {
      ...mergeTransactionObservations(current, transaction, incoming.network),
      status: current.status,
    };
  }
  return transactions === incoming.chainData.transactions
    ? incoming
    : { ...incoming, chainData: { ...incoming.chainData, transactions } };
}
