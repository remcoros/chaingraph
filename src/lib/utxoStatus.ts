import { z } from 'zod';
import { sats, type Network, type TxOutput } from '../domain/types';
import { rpc } from './api';

const resultSchema = z.object({
  bestblock: z.string().regex(/^[0-9a-f]{64}$/i),
  confirmations: z.number().int().min(0).max(0x7fffffff),
  value: z
    .number()
    .min(0)
    .max(21_000_000)
    .refine((value) => Number(value.toFixed(8)) === value),
  scriptPubKey: z.object({
    hex: z
      .string()
      .max(20_000)
      .regex(/^(?:[0-9a-f]{2})*$/i),
  }),
  coinbase: z.boolean(),
});

export interface UtxoObservation {
  network: Network;
  txid: string;
  vout: number;
  checkedAt: string;
  includeMempool: true;
  status: 'unspent' | 'absent';
  bestblock?: string;
  confirmations?: number;
}

/** A point-in-time Core UTXO-set observation, not a claim about cached spender history. */
export async function fetchCurrentUtxo(
  network: Network,
  txid: string,
  vout: number,
  expected?: Pick<TxOutput, 'value' | 'scriptPubKey'>,
  signal?: AbortSignal,
): Promise<UtxoObservation> {
  if (!/^[0-9a-f]{64}$/i.test(txid) || !Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff)
    throw new Error('Select a valid transaction output.');
  signal?.throwIfAborted();
  const response = await rpc<unknown>(
    network,
    'core',
    'gettxout',
    [txid.toLowerCase(), vout, true],
    signal,
  );
  signal?.throwIfAborted();
  const base = {
    network,
    txid: txid.toLowerCase(),
    vout,
    checkedAt: new Date().toISOString(),
    includeMempool: true as const,
  };
  if (response === null) return { ...base, status: 'absent' };
  const parsed = resultSchema.safeParse(response);
  if (!parsed.success) throw new Error('The node returned an invalid UTXO response.');
  if (
    expected &&
    (sats(parsed.data.value) !== sats(expected.value) ||
      (expected.scriptPubKey.hex !== undefined &&
        parsed.data.scriptPubKey.hex.toLowerCase() !== expected.scriptPubKey.hex.toLowerCase()))
  )
    throw new Error('The UTXO response disagrees with the loaded output.');
  return {
    ...base,
    status: 'unspent',
    bestblock: parsed.data.bestblock.toLowerCase(),
    confirmations: parsed.data.confirmations,
  };
}
