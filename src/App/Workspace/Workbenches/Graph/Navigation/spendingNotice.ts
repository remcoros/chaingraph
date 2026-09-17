import { isOpReturn, type Network } from '../../../../../Core/Bitcoin';
import { short } from '../../../../../Core/Formatting';

import type { Transaction } from '../../../../../Core/ChainData';
import type { ChainDataAcquisition } from '../../../../../Core/Workspace/Session/chainDataAcquisition';
import { fetchCurrentUtxo } from '../../../../../Core/ChainData/utxoStatus';

/** Successful graph additions are their own feedback. Report only status or a next step. */
export async function spendingNotice(
  result: Awaited<ReturnType<ChainDataAcquisition['read']['spending']>>,
  transaction: Transaction,
  network: Network,
  vout: number | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  const subject =
    vout === undefined
      ? `Transaction ${short(transaction.txid)}`
      : `Output ${short(transaction.txid)}:${vout}`;
  const incomplete = result.truncated
    ? result.nextOffset !== undefined
      ? 'Spending search incomplete. Run Find spending transactions again to check the next batch.'
      : 'Spending search incomplete. Some history or transaction data could not be checked. Try again.'
    : undefined;
  if (result.transactions.length) return incomplete ? `${subject}: ${incomplete}` : undefined;

  const output = vout === undefined ? undefined : transaction.vout.find((item) => item.n === vout);
  if (!output)
    return `${subject}: ${incomplete ?? 'No spending transactions found for these outputs.'}`;
  if (isOpReturn(output.scriptPubKey.hex)) return `${subject}: OP_RETURN output; unspendable.`;

  try {
    const observation = await fetchCurrentUtxo(
      network,
      transaction.txid,
      output.n,
      output,
      AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    );
    signal.throwIfAborted();
    if (observation.status === 'unspent')
      return `${subject}: Unspent at this check. No spend in your node's mempool.`;
    return `${subject}: ${incomplete ?? "Not in your node's current UTXO set. Spending transaction not found."}`;
  } catch {
    signal.throwIfAborted();
    return `${subject}: ${incomplete ?? 'No spending transaction found. Current UTXO status could not be checked. Try again.'}`;
  }
}
