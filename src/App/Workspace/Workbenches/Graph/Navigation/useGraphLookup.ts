import type { WorkspaceCore } from '../../../workspaceCore';
import type { WorkspaceSelection } from '../../../Selection/useWorkspaceSelection';
import type { ChainDataAcquisition } from '../../../../../Core/Workspace/Session/chainDataAcquisition';
import type { WorkspaceOperation } from '../../../useWorkspaceOperation';
import {
  addressReference,
  outpointReference,
  transactionReference,
} from '../../../../../Core/Workspace/entityReferences';
import { ancestryNotice } from './ancestryNotice';
import { loadAncestors } from './ancestry';
import { traceSourceExists } from '../../../GraphState/traceSource';
import type { useAddressEvidence } from '../Address/useAddressEvidence';
import type { GraphLookupState } from './useGraphLookupState';

interface Inputs {
  core: WorkspaceCore;
  selection: WorkspaceSelection;
  state: GraphLookupState;
  transactions: ChainDataAcquisition;
  operation: WorkspaceOperation;
  addressEvidence: ReturnType<typeof useAddressEvidence>;
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
  canLoadChainData,
  prefetchDepth,
  reveal,
}: Inputs) {
  const { activeWorkspace, activeWorkspaceRef, workspaces, setOperation, setError, setNotice } =
    core;
  const { getUnlocked } = workspaces;
  const { generation: selectionGeneration } = selection;
  const { transaction: getTransaction } = transactions.read;
  const { transactions: recordTransactions } = transactions.observe;
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
      reveal(addressReference(text));
      state.clear();
      addressEvidence.startAddressHistoryLoad(text);
      return;
    }
    if (!canLoadChainData) return;
    const generation = selectionGeneration.current;
    await run(async (signal) => {
      const [id, index] = text.split(':');
      setOperation('Loading transaction…');
      const cached = activeWorkspace.chainData.transactions[id.toLowerCase()];
      const transaction = cached ?? (await getTransaction(id, signal));
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
          ? transactionReference(transaction.txid)
          : outpointReference(transaction.txid, Number(index));
      reveal(requestedId);
      if (prefetchDepth) {
        const before = getUnlocked(activeWorkspace.id)!.data;
        const result = await loadAncestors(
          [transaction],
          before.chainData.transactions,
          prefetchDepth,
          {
            fetch: (transactionId, lookupSignal) =>
              getTransaction(transactionId, lookupSignal, 'background'),
            signal,
            onProgress: setOperation,
          },
        );
        signal.throwIfAborted();
        if (
          recordTransactions(activeWorkspace.id, result.transactions, {
            promotionIds: result.resolvedTransactionIds,
            contextIds: result.transactions.map((item) => item.txid),
            accept: (current) =>
              traceSourceExists(current.chainData, transactionReference(transaction.txid)),
          })
        )
          setNotice(ancestryNotice(result));
      }
      state.clear();
    });
  }

  return { submit };
}
