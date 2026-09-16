import type { AppState } from '../../../useAppState';
import type { WorkspaceCore } from '../../workspaceCore';
import {
  clearContextProvenance,
  markContextTransactions,
  promoteInputContext,
} from '../InputContext';
import { mergeTransactionObservations } from '../../../../Domain/Chain/prevouts';
import type { Transaction } from '../../../../Domain/Chain/transaction';
import { fetchTransaction } from '../../../../Infra/Bitcoin/api';
import type { Workspace } from '../../workspace';

export interface RecordTransactionOptions {
  promotionIds?: string[];
  contextIds?: string[];
  /** Reject a late result when the action's source no longer exists. */
  accept?: (workspace: Workspace) => boolean;
}

/** Loading transaction observations and folding accepted evidence into a workspace. */
export interface TransactionEvidence {
  getTransaction: (
    id: string,
    signal?: AbortSignal,
    priority?: 'navigation' | 'background',
  ) => Promise<Transaction>;
  recordTransactions: (
    id: string,
    transactions: Transaction[],
    options?: RecordTransactionOptions,
  ) => boolean;
}

interface Inputs {
  core: WorkspaceCore;
  fetchScope: AppState['fetchScope'];
}

export function useTransactionEvidence({ core, fetchScope }: Inputs): TransactionEvidence {
  const { activeWorkspace, workspaces } = core;
  const { getUnlocked } = workspaces;
  const getTransaction = async (
    id: string,
    signal?: AbortSignal,
    priority: 'navigation' | 'background' = 'navigation',
  ) => {
    signal?.throwIfAborted();
    if (!activeWorkspace) throw new Error('Open a workspace first.');
    if (activeWorkspace.demo)
      throw new Error('Live lookups are disabled for legacy synthetic workspaces.');
    return (
      activeWorkspace.transactions[id] ??
      fetchTransaction(activeWorkspace.network, id, signal, undefined, {
        scope: fetchScope,
        priority,
      })
    );
  };
  const recordTransactions = (
    id: string,
    transactions: Transaction[],
    options: RecordTransactionOptions = {},
  ) => {
    const promotionIds =
      options.promotionIds ?? transactions.map((transaction) => transaction.txid);
    if (!transactions.length && !promotionIds.length) {
      const current = getUnlocked(id)?.data;
      return !!current && (!options.accept || options.accept(current));
    }
    let accepted = false;
    getUnlocked(id)?.edit((current) => {
      if (options.accept && !options.accept(current)) return current;
      accepted = true;
      const promoted = options.contextIds
        ? promoteInputContext(current, promotionIds)
        : clearContextProvenance(current, promotionIds);
      const merged = !transactions.length
        ? promoted
        : {
            ...promoted,
            transactions: {
              ...promoted.transactions,
              ...Object.fromEntries(
                transactions.map((transaction) => [
                  transaction.txid,
                  mergeTransactionObservations(
                    promoted.transactions[transaction.txid],
                    transaction,
                    current.network,
                  ),
                ]),
              ),
            },
          };
      return options.contextIds ? markContextTransactions(merged, options.contextIds) : merged;
    }, false);
    return accepted;
  };
  return { getTransaction, recordTransactions };
}
