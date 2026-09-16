import type { AppState } from '../../../../useAppState';
import type { WorkspaceCore } from '../../../workspaceCore';
import type { WorkspaceSelection } from '../../../Selection/useWorkspaceSelection';
import type { TransactionEvidence } from '../../../Evidence/Transactions';
import type { WorkspaceOperation } from '../../../useWorkspaceOperation';
import {
  addressNodeId,
  outputNodeId,
  txNodeId,
} from '../../../../../Domain/Metadata/entityReferences';
import { fetchTransaction } from '../../../../../Infra/Bitcoin/api';
import {
  ancestryNotice,
  loadAncestors,
  traceSourceExists,
} from '../../../../../Infra/Bitcoin/tracing';
import type { useAddressEvidence } from '../Address/useAddressEvidence';
import type { GraphLookupState } from './useGraphLookupState';

interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  state: GraphLookupState;
  transactions: TransactionEvidence;
  operation: WorkspaceOperation;
  addressEvidence: ReturnType<typeof useAddressEvidence>;
  fetchScope: AppState['fetchScope'];
  canLoadChainData: boolean;
  prefetchDepth: 0 | 1 | 2;
  reveal: (id: string) => void;
}

/** Resolves toolbar text into Graph entities, then optionally loads ancestor context. */
export function useGraphLookup({
  core,
  selection,
  state,
  transactions,
  operation,
  addressEvidence,
  fetchScope,
  canLoadChainData,
  prefetchDepth,
  reveal,
}: Inputs) {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setError, setNotice } =
    core;
  const { getUnlocked } = workspaces;
  const { generation: selectionGeneration } = selection;
  const { getTransaction, recordTransactions } = transactions;
  const { run } = operation;

  async function submit(text: string) {
    if (!activeWorkspace || !text || operation.isActive()) return;
    text = text.trim();
    if (/^(bc1|tb1)/i.test(text)) text = text.toLowerCase();
    const existing = state.resolveLoaded(text);
    if (existing && !existing.startsWith('addr:')) {
      setError('');
      setNotice('');
      recordTransactions(activeWorkspace.id, [], { promotionIds: [existing.split(':')[1]] });
      reveal(existing);
      if (!canLoadChainData || !prefetchDepth) {
        state.clear();
        return;
      }
    }
    if (!/^[0-9a-f]{64}(:\d+)?$/i.test(text)) {
      if (!canLoadChainData && !existing) return;
      setError('');
      setNotice('');
      reveal(addressNodeId(text));
      state.clear();
      addressEvidence.startAddressHistoryLoad(text);
      return;
    }
    if (!canLoadChainData) return;
    const generation = selectionGeneration.current;
    await run(async (signal) => {
      const [id, index] = text.split(':');
      setOperation('Loading transaction…');
      const cached = activeWorkspace.transactions[id.toLowerCase()];
      const transaction =
        cached ??
        (await fetchTransaction(activeWorkspace.network, id, signal, undefined, {
          scope: fetchScope,
          priority: 'navigation',
        }));
      if (index !== undefined && !transaction.vout.some((output) => output.n === Number(index)))
        throw new Error('This output index does not exist in the transaction.');
      signal.throwIfAborted();
      if (
        selectionGeneration.current !== generation ||
        activeWorkspaceRef.current?.id !== activeWorkspace.id
      )
        return;
      recordTransactions(activeWorkspace.id, cached ? [] : [transaction], {
        promotionIds: [transaction.txid],
      });
      const requestedId =
        index === undefined
          ? txNodeId(transaction.txid)
          : outputNodeId(transaction.txid, Number(index));
      reveal(requestedId);
      if (prefetchDepth) {
        const before = getUnlocked(activeWorkspace.id)!.data;
        const result = await loadAncestors([transaction], before.transactions, prefetchDepth, {
          fetch: (transactionId, lookupSignal) =>
            getTransaction(transactionId, lookupSignal, 'background'),
          signal,
          onProgress: setOperation,
        });
        signal.throwIfAborted();
        if (
          recordTransactions(activeWorkspace.id, result.transactions, {
            promotionIds: result.resolvedTransactionIds,
            contextIds: result.transactions.map((item) => item.txid),
            accept: (current) => traceSourceExists(current, txNodeId(transaction.txid)),
          })
        )
          setNotice(ancestryNotice(result));
      }
      state.clear();
    });
  }

  return { submit };
}
