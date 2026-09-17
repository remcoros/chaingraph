import { TRANSACTION_BATCH_CONCURRENCY } from '../../../../../Core/ChainData/transactionScheduler';
import type { Network } from '../../../../../Core/Bitcoin';
import {
  type Transaction,
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
  parseTransaction,
  validateTransactionAddresses,
} from '../../../../../Core/ChainData';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import type { WalletReviewFlowEntry } from '../walletReviewContext';

import { mapLimit } from '../../../../../Core/ChainData/api';
import { mergeFlowInputs } from '../../../../../Core/Workspace/flowInputContext';

export const WALLET_FLOW_INPUT_WAVE_LIMIT = 20;
export const WALLET_FLOW_VISIBLE_INPUT_LIMIT = 100;

export interface WalletFlowInputReference {
  id: string;
  txid: string;
  vout: number;
}

function reference(entry: WalletReviewFlowEntry): WalletFlowInputReference | undefined {
  if (entry.coinbase) return;
  const match = /^out:([0-9a-f]{64}):(0|[1-9]\d*)$/.exec(entry.id);
  if (!match) return;
  const vout = Number(match[2]);
  if (
    !Number.isSafeInteger(vout) ||
    vout > 0xffffffff ||
    (entry.txid !== undefined && entry.txid !== match[1]) ||
    (entry.vout !== undefined && entry.vout !== vout)
  )
    return;
  return { id: entry.id, txid: match[1], vout };
}

export function walletFlowSourceKey(
  workspace: Workspace,
  walletId: string,
  transactionId?: string,
): string {
  if (!transactionId || !workspace.wallets.definitions.some((wallet) => wallet.id === walletId))
    return '';
  const source = workspace.chainData.transactions[transactionId];
  return source?.txid === transactionId ? JSON.stringify([transactionId, source.vin]) : '';
}

/** Only displayed canonical prevouts that still occur in the loaded source can request data. */
export function walletFlowInputPlan(
  workspace: Workspace,
  walletId: string,
  transactionId: string | undefined,
  inputs: readonly WalletReviewFlowEntry[],
  attempted: ReadonlySet<string> = new Set(),
  previousOutputs?: PreviousOutputIndex,
) {
  const refs: WalletFlowInputReference[] = [];
  const seen = new Set<string>();
  if (walletFlowSourceKey(workspace, walletId, transactionId)) {
    const source = workspace.chainData.transactions[transactionId!];
    for (const input of inputs.slice(0, WALLET_FLOW_VISIBLE_INPUT_LIMIT)) {
      const ref = reference(input);
      if (
        !ref ||
        ref.txid === transactionId ||
        seen.has(ref.id) ||
        !source.vin.some(
          (entry) =>
            entry.coinbase === undefined && entry.txid === ref.txid && entry.vout === ref.vout,
        )
      )
        continue;
      seen.add(ref.id);
      refs.push(ref);
    }
  }
  const missing = new Set<string>();
  let missingOutputCount = 0;
  const prevouts =
    previousOutputs ??
    (refs.length
      ? indexPreviousOutputs({
          network: workspace.network,
          transactions: workspace.chainData.transactions,
        })
      : undefined);
  for (const ref of refs) {
    const resolution = resolvePreviousOutput(
      { network: workspace.network, transactions: workspace.chainData.transactions },
      ref,
      prevouts,
    );
    if (resolution.status === 'loaded' || resolution.status === 'attached') continue;
    if (!workspace.chainData.transactions[ref.txid]) missing.add(ref.txid);
    else missingOutputCount++;
  }
  return {
    refs,
    missing: [...missing],
    pendingCount: missing.size,
    missingOutputCount,
    transactionIds: [...missing]
      .filter((id) => !attempted.has(id))
      .slice(0, WALLET_FLOW_INPUT_WAVE_LIMIT),
  };
}

/** Evidence additions only. Cached parents are neither replaced nor promoted. */
export function mergeWalletFlowInputs(
  workspace: Workspace,
  walletId: string,
  transactionId: string | undefined,
  visibleRefs: readonly WalletReviewFlowEntry[],
  loaded: readonly Transaction[],
): Workspace {
  if (!loaded.length) return workspace;
  const { refs } = walletFlowInputPlan(workspace, walletId, transactionId, visibleRefs);
  if (!refs.length) return workspace;
  let merged = workspace;
  for (const candidate of loaded.slice(0, WALLET_FLOW_INPUT_WAVE_LIMIT)) {
    if (merged.chainData.transactions[candidate.txid]) continue;
    const relevant = refs.filter((ref) => ref.txid === candidate.txid);
    if (!relevant.length) continue;
    try {
      const transaction = parseTransaction(candidate);
      validateTransactionAddresses(transaction, workspace.network);
      const valid = relevant.filter((ref) =>
        transaction.vout.some((output) => output.n === ref.vout),
      );
      // An unrelated output must not be substituted for a missing requested prevout.
      if (!valid.length) continue;
      for (const [index, ref] of valid.entries())
        merged = mergeFlowInputs(
          merged,
          transactionId,
          { txid: ref.txid, vout: ref.vout },
          index === 0 ? [transaction] : [],
        );
    } catch {
      // Network-mismatched or malformed observations never reach the workspace.
    }
  }
  return merged;
}

export async function loadWalletFlowInputWave(
  network: Network,
  ids: readonly string[],
  fetch: (network: Network, id: string, signal: AbortSignal) => Promise<Transaction>,
  signal: AbortSignal,
) {
  const loaded: Transaction[] = [];
  const failed: string[] = [];
  const unique = [...new Set(ids)]
    .filter((id) => /^[0-9a-f]{64}$/.test(id))
    .slice(0, WALLET_FLOW_INPUT_WAVE_LIMIT);
  await mapLimit(unique, TRANSACTION_BATCH_CONCURRENCY, async (id) => {
    signal.throwIfAborted();
    try {
      const result = await fetch(network, id, signal);
      signal.throwIfAborted();
      const transaction = parseTransaction(result);
      if (transaction.txid !== id) throw new Error('Unexpected transaction.');
      validateTransactionAddresses(transaction, network);
      loaded.push(transaction);
    } catch {
      signal.throwIfAborted();
      failed.push(id);
    }
  });
  signal.throwIfAborted();
  return { loaded, failed };
}
