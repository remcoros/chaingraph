import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type Transaction,
} from '../../../Core/ChainData';
import { transactionStatus } from './transactionStatus';
import { sats } from '../../../Core/Bitcoin';

import type { Workspace } from '../../../Core/Workspace/workspace';

export interface TransactionFee {
  feeSats: number;
  feeRateSatVb: number;
}

type FeeWorkspace = Pick<Workspace, 'network'> & {
  chainData: Pick<Workspace['chainData'], 'transactions'>;
};

// TransactionBlockTime is used in dense lists. Reuse the previous-output index
// while the immutable transactions record stays the same.
const previousOutputIndexes = new WeakMap<object, ReturnType<typeof indexPreviousOutputs>>();

function previousOutputs(workspace: FeeWorkspace) {
  const key = workspace.chainData.transactions as object;
  const cached = previousOutputIndexes.get(key);
  if (cached) return cached;
  const index = indexPreviousOutputs({
    network: workspace.network,
    transactions: workspace.chainData.transactions,
  });
  previousOutputIndexes.set(key, index);
  return index;
}

/** Calculate a fee only from complete, non-conflicting local observations. */
export function transactionFee(
  workspace: FeeWorkspace,
  transaction?: Transaction,
): TransactionFee | undefined {
  if (!transaction) return undefined;
  const vsize = transaction.vsize;
  if (
    transactionStatus(transaction).kind !== 'confirmed' ||
    typeof vsize !== 'number' ||
    !Number.isSafeInteger(vsize) ||
    vsize <= 0 ||
    transaction.vin.some((input) => input.coinbase !== undefined)
  )
    return undefined;

  const prevouts = previousOutputs(workspace);
  let inputTotal = 0;
  for (const input of transaction.vin) {
    if (input.txid === undefined || input.vout === undefined) return undefined;
    const resolution = resolvePreviousOutput(
      { network: workspace.network, transactions: workspace.chainData.transactions },
      input,
      prevouts,
    );
    if (resolution.status !== 'loaded' && resolution.status !== 'attached') return undefined;
    inputTotal += sats(resolution.output.value);
    if (!Number.isSafeInteger(inputTotal)) return undefined;
  }
  const outputTotal = transaction.vout.reduce((total, output) => total + sats(output.value), 0);
  if (!Number.isSafeInteger(outputTotal)) return undefined;
  const feeSats = inputTotal - outputTotal;
  if (feeSats < 0 || !Number.isSafeInteger(feeSats)) return undefined;
  return {
    feeSats,
    feeRateSatVb: feeSats / vsize,
  };
}
