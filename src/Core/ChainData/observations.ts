import { z } from 'zod';
import type { Network } from '../Bitcoin/network';
import { MAX_MONEY_SATS } from '../Bitcoin/amount';

const txid = z.string().regex(/^[0-9a-f]{64}$/);
const height = z.number().int().min(-1).max(0x7fffffff);
const timestamp = z.iso.datetime({ offset: true });

export interface AddressHistoryObservation {
  history: { tx_hash: string; height: number }[];
  /** Transaction details were capped while the complete history was observed. */
  truncated: boolean;
  scannedAt?: string;
}

export interface AddressBalanceObservation {
  network: Network;
  confirmedSats: number;
  unconfirmedSats: number;
  checkedAt: string;
}

interface AddressUtxoRecord {
  txid: string;
  vout: number;
  valueSats: number;
  height: number;
}

export interface AddressUtxoObservation {
  network: Network;
  utxos: AddressUtxoRecord[];
  checkedAt: string;
}

/** A dated address observation can establish a zero balance. Loaded outputs
 * alone cannot. Pending balance changes may be negative; the total may not.
 */
export function addressBalanceSats(
  observation: AddressBalanceObservation | AddressUtxoObservation | undefined,
): number | undefined {
  if (!observation) return undefined;
  let total: number;
  if ('utxos' in observation) {
    const points = new Set<string>();
    total = 0;
    for (const output of observation.utxos) {
      const point = `${output.txid}:${output.vout}`;
      if (
        points.has(point) ||
        !Number.isSafeInteger(output.valueSats) ||
        output.valueSats < 0 ||
        output.valueSats > MAX_MONEY_SATS
      )
        return undefined;
      points.add(point);
      total += output.valueSats;
    }
  } else {
    if (
      !Number.isSafeInteger(observation.confirmedSats) ||
      observation.confirmedSats < 0 ||
      observation.confirmedSats > MAX_MONEY_SATS ||
      !Number.isSafeInteger(observation.unconfirmedSats) ||
      Math.abs(observation.unconfirmedSats) > MAX_MONEY_SATS
    )
      return undefined;
    total = observation.confirmedSats + observation.unconfirmedSats;
  }
  return Number.isSafeInteger(total) && total >= 0 && total <= MAX_MONEY_SATS ? total : undefined;
}

export const addressHistorySchema: z.ZodType<AddressHistoryObservation> = z.object({
  history: z.array(z.object({ tx_hash: txid, height })).max(10000),
  truncated: z.boolean(),
  scannedAt: timestamp.optional(),
});

export const addressBalanceSchema: z.ZodType<AddressBalanceObservation> = z.object({
  network: z.enum(['mainnet', 'testnet4']),
  confirmedSats: z.number().int().min(0).max(MAX_MONEY_SATS),
  unconfirmedSats: z.number().int().min(-MAX_MONEY_SATS).max(MAX_MONEY_SATS),
  checkedAt: timestamp,
});

const addressUtxoSchema = z.object({
  txid,
  vout: z.number().int().min(0).max(0xffffffff),
  valueSats: z.number().int().min(0).max(MAX_MONEY_SATS),
  height,
});

export const addressUtxoObservationSchema: z.ZodType<AddressUtxoObservation> = z.object({
  network: z.enum(['mainnet', 'testnet4']),
  utxos: z.array(addressUtxoSchema).max(10000),
  checkedAt: timestamp,
});
