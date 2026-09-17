import {
  outpointKey,
  previousOutputsConflict,
  type Network,
  type TxInput,
  type TxOutput,
} from '../Bitcoin';
import type { Transaction } from './transaction';
export interface TransactionObservations {
  network: Network;
  transactions: Record<string, Transaction>;
}

export type PreviousOutputResolution =
  { status: 'loaded' | 'attached'; output: TxOutput } | { status: 'missing' | 'conflict' };

export type PreviousOutputIndex = ReadonlyMap<string, PreviousOutputResolution>;

function canonicalTxid(value: string | undefined): string | undefined {
  return value && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : undefined;
}

function validVout(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= 0xffffffff;
}

/** Index output facts without inventing their creating transactions. */
export function indexPreviousOutputs(data: TransactionObservations) {
  const result = new Map<string, PreviousOutputResolution>();
  const transactions = Object.entries(data.transactions).flatMap(([key, transaction]) => {
    const txid = canonicalTxid(transaction.txid);
    return txid && canonicalTxid(key) === txid ? [{ txid, transaction }] : [];
  });
  const loadedTxids = new Set(transactions.map(({ txid }) => txid));
  for (const { txid, transaction } of transactions)
    for (const output of transaction.vout) {
      if (!validVout(output.n)) continue;
      result.set(outpointKey(txid, output.n), { status: 'loaded', output });
    }

  for (const { transaction } of transactions)
    for (const input of transaction.vin) {
      const txid = canonicalTxid(input.txid);
      if (!txid || !validVout(input.vout)) continue;
      const id = outpointKey(txid, input.vout);
      const current = result.get(id);
      if (loadedTxids.has(txid) && !current) {
        result.set(id, { status: 'conflict' });
        continue;
      }
      if (!input.prevout) continue;
      const output: TxOutput = { n: input.vout, ...input.prevout };
      if (current?.status === 'conflict') continue;
      if (
        current &&
        (current.status === 'loaded' || current.status === 'attached') &&
        previousOutputsConflict(current.output, output, data.network)
      ) {
        result.set(id, { status: 'conflict' });
      } else if (current && (current.status === 'loaded' || current.status === 'attached')) {
        result.set(id, {
          ...current,
          output: {
            ...current.output,
            scriptPubKey: {
              ...output.scriptPubKey,
              ...current.output.scriptPubKey,
              type:
                current.output.scriptPubKey.type &&
                current.output.scriptPubKey.type !== 'nonstandard'
                  ? current.output.scriptPubKey.type
                  : output.scriptPubKey.type,
            },
          },
        });
      } else if (!current) {
        result.set(id, { status: 'attached', output });
      }
    }
  return result;
}

export function resolvePreviousOutput(
  data: TransactionObservations,
  point: Pick<TxInput, 'txid' | 'vout'>,
  index: PreviousOutputIndex = indexPreviousOutputs(data),
): PreviousOutputResolution {
  const txid = canonicalTxid(point.txid);
  if (!txid || !validVout(point.vout)) return { status: 'missing' };
  return index.get(outpointKey(txid, point.vout)) ?? { status: 'missing' };
}
