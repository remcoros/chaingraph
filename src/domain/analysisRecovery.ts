import type { Network, Transaction, TxInput, Workspace } from './types';
import {
  indexPreviousOutputs,
  mergeTransactionObservations,
  previousOutputsConflict,
  outputScriptHex,
  resolvePreviousOutput,
} from './prevouts';
import { satoshiValue } from './analysis/shared';
import { analysisScriptType } from './analysis/scripts';

export const recoveryLimits = {
  transactions: 20,
  spendingTransactions: 10,
  concurrency: 3,
  timeoutMs: 30_000,
} as const;
export const automaticRecoveryLimits = {
  transactions: 8,
  spendingTransactions: 4,
  concurrency: 3,
  timeoutMs: 5_000,
} as const;
type FetchTransaction = (
  network: Network,
  txid: string,
  signal: AbortSignal,
) => Promise<Transaction>;
const validPoint = (input: TxInput) =>
  !!input.txid &&
  /^[0-9a-f]{64}$/i.test(input.txid) &&
  Number.isSafeInteger(input.vout) &&
  input.vout! >= 0 &&
  input.vout! <= 0xffffffff;

/** Same resolver as the analyses: attached evidence counts without loading parents. */
export function analysisDataGaps(workspace: Workspace, txids: readonly string[], scripts = true) {
  const index = indexPreviousOutputs(workspace);
  return [...new Set(txids)].sort().flatMap((txid) => {
    const tx = workspace.transactions[txid];
    if (!tx || tx.vin.some((input) => input.coinbase !== undefined)) return [];
    return tx.vin.flatMap((input, inputIndex) => {
      const result = resolvePreviousOutput(workspace, input, index);
      const output =
        result.status === 'loaded' || result.status === 'attached' ? result.output : undefined;
      const script = output && outputScriptHex(output, workspace.network);
      // Complete bytes can still be unsupported by the script comparison. Fetching
      // the same immutable output again cannot make this check understand them.
      const scriptAvailable =
        output &&
        (analysisScriptType(output) ||
          (script !== undefined && /^(?:[0-9a-f]{2})*$/i.test(script)));
      if (output && satoshiValue(output.value) !== undefined && (!scripts || scriptAvailable))
        return [];
      return [
        {
          txid,
          inputIndex,
          input,
          conflict: result.status === 'conflict',
          recoverable: result.status !== 'conflict' && validPoint(input),
        },
      ];
    });
  });
}

/** Isolated, bounded enrichment. No new creating transactions enter the workspace.
 * Partial success is returned for one atomic data + findings commit. Cancellation
 * discards this attempt so switching/locking can never publish a late response.
 * The automatic deadline returns completed enrichment so a slow node does not
 * prevent a local scan; user cancellation still discards the entire attempt.
 */
export async function recoverAnalysisData(
  workspace: Workspace,
  txids: readonly string[],
  fetchTransaction: FetchTransaction,
  signal: AbortSignal,
  scripts = true,
  mode: 'manual' | 'automatic' = 'manual',
) {
  const limits = mode === 'automatic' ? automaticRecoveryLimits : recoveryLimits;
  const deadline = mode === 'automatic' ? AbortSignal.timeout(limits.timeoutMs) : undefined;
  const requestSignal = deadline ? AbortSignal.any([signal, deadline]) : signal;
  const transactions = { ...workspace.transactions };
  const snapshot = () => ({ ...workspace, transactions });
  const requested = new Map<string, Promise<Transaction | undefined>>();
  let failed = 0,
    conflicts = 0;
  async function fetchOne(txid: string) {
    signal.throwIfAborted();
    const id = txid.toLowerCase();
    if (requested.has(id)) return requested.get(id)!;
    if (deadline?.aborted || requested.size >= limits.transactions) return undefined;
    const request = fetchTransaction(workspace.network, id, requestSignal)
      .then((tx) => {
        requestSignal.throwIfAborted();
        if (tx.txid !== id) throw new Error('Unexpected transaction.');
        return tx;
      })
      .catch(() => {
        signal.throwIfAborted();
        failed++;
        return undefined;
      });
    requested.set(id, request);
    return request;
  }
  async function pool<T>(items: T[], fn: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limits.concurrency, items.length) }, async () => {
        while (next < items.length) {
          signal.throwIfAborted();
          if (deadline?.aborted) return;
          await fn(items[next++]);
        }
      }),
    );
  }
  function attach(txid: string, incoming: Transaction) {
    const before = transactions[txid];
    try {
      // A txid fixes its inputs and outputs. Reject incompatible observations.
      if (
        before.vin.length !== incoming.vin.length ||
        before.vout.length !== incoming.vout.length ||
        before.vin.some(
          (input, i) =>
            input.txid !== incoming.vin[i].txid ||
            input.vout !== incoming.vin[i].vout ||
            input.coinbase !== incoming.vin[i].coinbase,
        ) ||
        before.vout.some(
          (output, i) =>
            output.n !== incoming.vout[i].n ||
            previousOutputsConflict(output, incoming.vout[i], workspace.network),
        )
      )
        throw new Error('Conflicting transaction.');
      const merged = mergeTransactionObservations(before, incoming, workspace.network);
      const index = indexPreviousOutputs(snapshot());
      for (const input of merged.vin) {
        if (!input.prevout) continue;
        const known = resolvePreviousOutput(workspace, input, index);
        if (
          known.status === 'conflict' ||
          ((known.status === 'loaded' || known.status === 'attached') &&
            previousOutputsConflict(
              known.output,
              { n: input.vout!, ...input.prevout },
              workspace.network,
            ))
        )
          throw new Error('Conflicting evidence.');
      }
      // This action enriches input evidence only; status, view and graph topology stay stable.
      transactions[txid] = {
        ...before,
        vin: before.vin.map((input, i) => ({
          ...input,
          ...(merged.vin[i].prevout ? { prevout: merged.vin[i].prevout } : {}),
        })),
      };
    } catch {
      conflicts++;
    }
  }
  const initial = analysisDataGaps(workspace, txids, scripts);
  const consideredSpends = new Set<string>();
  do {
    const spendingIds = [
      ...new Set(
        analysisDataGaps(snapshot(), txids, scripts)
          .filter(
            (gap) => gap.recoverable && !consideredSpends.has(gap.txid) && !requested.has(gap.txid),
          )
          .map((gap) => gap.txid),
      ),
    ].slice(0, limits.spendingTransactions);
    if (!spendingIds.length) break;
    for (const txid of spendingIds) consideredSpends.add(txid);
    await pool(spendingIds, async (txid) => {
      const incoming = await fetchOne(txid);
      if (incoming) attach(txid, incoming);
    });
    const unresolved = analysisDataGaps(snapshot(), spendingIds, scripts).filter(
      (gap) => gap.recoverable,
    );
    await pool(
      [...new Set(unresolved.map((gap) => gap.input.txid!.toLowerCase()))].sort(),
      async (parentId) => {
        const parent = await fetchOne(parentId);
        if (!parent) return;
        for (const gap of unresolved.filter((gap) => gap.input.txid!.toLowerCase() === parentId)) {
          const output = parent.vout.find((output) => output.n === gap.input.vout);
          const hex = output && outputScriptHex(output, workspace.network);
          if (!output || satoshiValue(output.value) === undefined) {
            failed++;
            continue;
          }
          const before = transactions[gap.txid];
          attach(gap.txid, {
            ...before,
            vin: before.vin.map((input, i) =>
              i === gap.inputIndex
                ? {
                    ...input,
                    prevout: {
                      value: output.value,
                      scriptPubKey: {
                        ...output.scriptPubKey,
                        ...(hex === undefined ? {} : { hex }),
                      },
                    },
                  }
                : input,
            ),
          });
        }
      },
    );
  } while (mode === 'automatic' && requested.size < limits.transactions && !deadline?.aborted);
  signal.throwIfAborted();
  const remaining = analysisDataGaps(snapshot(), txids, scripts);
  const changed = Object.keys(transactions).some(
    (id) => JSON.stringify(transactions[id]) !== JSON.stringify(workspace.transactions[id]),
  );
  return {
    workspace: changed ? snapshot() : workspace,
    requested: requested.size,
    failed,
    conflicts: conflicts + initial.filter((gap) => gap.conflict).length,
    remaining: remaining.length,
    resolved: Math.max(0, initial.length - remaining.length),
    timedOut: deadline?.aborted ?? false,
    budgetReached:
      remaining.length > 0 &&
      (requested.size >= limits.transactions ||
        remaining.some((gap) => gap.recoverable && !consideredSpends.has(gap.txid))),
  };
}
