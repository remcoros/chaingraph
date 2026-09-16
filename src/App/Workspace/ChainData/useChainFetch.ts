import { ensureGraphMembership } from '../GraphState/graphMembership';
import type { AppState } from '../../useAppState';
import type { WorkspaceCore } from '../workspaceCore';
import {
  clearContextProvenance,
  markContextTransactions,
  promoteInputContext,
} from './observationContext';
import { mergeTransactionObservations } from '../../../Domain/Chain/prevouts';
import type { Transaction } from '../../../Domain/Chain/transaction';
import { fetchTransaction } from '../../../Infra/Bitcoin/api';
import { traceSourceExists } from '../../../Infra/Bitcoin/tracing';
import type { RefObject } from 'react';

/** Fetching chain evidence and folding it into a workspace. */
export interface ChainFetch {
  getTransaction: (
    id: string,
    signal?: AbortSignal,
    priority?: 'navigation' | 'background',
  ) => Promise<Transaction>;
  /** Runs one cancellable operation at a time, reporting its progress and failure. */
  run: (task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  mergeTransactions: (
    id: string,
    transactions: Transaction[],
    promotionIds?: string[],
    contextIds?: string[],
    requiredSourceId?: string,
  ) => boolean;
}

interface Inputs {
  core: WorkspaceCore;
  fetchScope: AppState['fetchScope'];
  operationRef: RefObject<AbortController | undefined>;
}

export function useChainFetch({ core, fetchScope, operationRef }: Inputs): ChainFetch {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setError, setNotice } =
    core;
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
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operationRef.current) return;
    const controller = new AbortController();
    const workspaceId = activeWorkspaceRef.current?.id;
    operationRef.current = controller;
    setOperation('Working…');
    setError('');
    setNotice('');
    try {
      await task(controller.signal);
    } catch (e) {
      if (activeWorkspaceRef.current?.id !== workspaceId || operationRef.current !== controller)
        return;
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'Operation failed.');
      else setNotice('Operation cancelled. Completed data from earlier actions is preserved.');
    } finally {
      if (operationRef.current === controller) {
        operationRef.current = undefined;
        setOperation('');
      }
    }
  };
  const mergeTransactions = (
    id: string,
    transactions: Transaction[],
    promotionIds = transactions.map((transaction) => transaction.txid),
    contextIds?: string[],
    requiredSourceId?: string,
  ) => {
    if (!transactions.length && !promotionIds.length) {
      const current = getUnlocked(id)?.data;
      return !!current && (!requiredSourceId || traceSourceExists(current, requiredSourceId));
    }
    let accepted = false;
    getUnlocked(id)?.edit((current) => {
      if (requiredSourceId && !traceSourceExists(current, requiredSourceId)) return current;
      accepted = true;
      const initialized = ensureGraphMembership(current);
      const promoted = contextIds
        ? promoteInputContext(initialized, promotionIds)
        : clearContextProvenance(initialized, promotionIds);
      const merged = !transactions.length
        ? promoted
        : {
            ...promoted,
            transactions: {
              ...current.transactions,
              ...Object.fromEntries(
                transactions.map((transaction) => [
                  transaction.txid,
                  mergeTransactionObservations(
                    current.transactions[transaction.txid],
                    transaction,
                    current.network,
                  ),
                ]),
              ),
            },
          };
      return contextIds ? markContextTransactions(merged, contextIds) : merged;
    }, false);
    return accepted;
  };
  return { getTransaction, run, mergeTransactions };
}
