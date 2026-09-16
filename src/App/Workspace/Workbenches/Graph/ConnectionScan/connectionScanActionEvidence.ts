import { SCAN_LIMITS } from './connectionScan';
import type { Transaction } from '../../../../../Domain/Chain/transaction';
import type { Workspace } from '../../../../../Domain/Workspace/workspaceTypes';
import { fetchTransaction } from '../../../../../Infra/Bitcoin/api';
import { validateScanTransaction } from './connectionScanEvidence';
import type { TransactionFetchScope } from '../../../../../Infra/Bitcoin/transactionScheduler';

export interface ScanActionEvidenceOptions {
  workspace: Workspace;
  missingTxids: readonly string[];
  scope: TransactionFetchScope;
  canLoadChainData: boolean;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

/** Explicit path actions load only their requested proof, never explore neighbouring transactions. */
export async function loadScanActionEvidence(
  options: ScanActionEvidenceOptions,
  fetch: typeof fetchTransaction = fetchTransaction,
): Promise<Record<string, Transaction>> {
  const { workspace, scope } = options;
  if (workspace.network !== 'mainnet' && workspace.network !== 'testnet4')
    throw new Error('Choose mainnet or testnet4 before loading transactions.');
  if (scope.network && scope.network !== workspace.network)
    throw new Error('Transactions belong to a different Bitcoin network.');
  const ids = [...new Set(options.missingTxids)];
  if (ids.length > 2 * (SCAN_LIMITS.maxHops + 2))
    throw new Error('Too many transactions. Load a shorter path.');
  if (ids.some((id) => !/^[0-9a-f]{64}$/.test(id)))
    throw new Error('Invalid transaction ID. Run the scan again.');

  const deadline = new AbortController();
  const signal = AbortSignal.any([
    deadline.signal,
    scope.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  const checkpoint = () => {
    if (scope.closed || options.signal?.aborted || options.isCurrent?.() === false)
      throw new DOMException('Loading transactions cancelled.', 'AbortError');
    if (deadline.signal.aborted) throw new Error('Loading transactions timed out. Retry.');
    if (signal.aborted) throw new DOMException('Loading transactions cancelled.', 'AbortError');
  };
  checkpoint();
  const timer = setTimeout(() => deadline.abort(), 30_000);
  const evidence: Record<string, Transaction> = {};
  try {
    for (const id of ids) {
      checkpoint();
      let value: unknown = workspace.transactions[id] ?? workspace.connectionScans?.evidence[id];
      if (!value) {
        if (!options.canLoadChainData)
          throw new Error('Connect to the backend to load these transactions.');
        let stop: (() => void) | undefined;
        try {
          // Also settle when a cancelled transport ignores its signal.
          const interrupted = new Promise<never>((_resolve, reject) => {
            stop = () => {
              try {
                checkpoint();
              } catch (error) {
                reject(error);
              }
            };
            signal.addEventListener('abort', stop, { once: true });
          });
          checkpoint();
          value = await Promise.race([
            fetch(workspace.network, id, signal, undefined, { scope, priority: 'navigation' }),
            interrupted,
          ]);
          checkpoint();
        } catch {
          checkpoint();
          throw new Error('Could not load transactions. Retry when the backend is available.');
        } finally {
          if (stop) signal.removeEventListener('abort', stop);
        }
      }
      checkpoint();
      try {
        evidence[id] = validateScanTransaction(value, id, workspace.network);
      } catch {
        throw new Error('Transaction evidence could not be verified. Run the scan again.');
      }
    }
    checkpoint();
    return evidence;
  } finally {
    clearTimeout(timer);
  }
}
