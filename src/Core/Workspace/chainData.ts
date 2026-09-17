import { z } from 'zod';
import { transactionSchema } from '../ChainData/transactionValidation';
import type { Transaction } from '../ChainData/transaction';
import {
  addressHistorySchema,
  addressBalanceSchema,
  addressUtxoObservationSchema,
  type AddressBalanceObservation,
  type AddressHistoryObservation,
  type AddressUtxoObservation,
} from '../ChainData/observations';
const txid = z.string().regex(/^[0-9a-f]{64}$/);

/** Latest useful chain data. It is serializable and has no runtime methods. */
export interface ChainDataDocument {
  transactions: Record<string, Transaction>;
  /** Automatically acquired ancestry retained independently of graph presentation. */
  contextTransactionIds?: string[];
  watchedAddresses: string[];
  addressHistories?: Record<string, AddressHistoryObservation>;
  addressBalances?: Record<string, AddressBalanceObservation>;
  addressUtxos?: Record<string, AddressUtxoObservation>;
}

export const chainDataSchema = z.object({
  transactions: z.record(txid, transactionSchema),
  contextTransactionIds: z.array(txid).max(10000).optional(),
  watchedAddresses: z.array(z.string().max(150)).max(10000),
  addressHistories: z.record(z.string().min(1).max(150), addressHistorySchema).optional(),
  addressBalances: z
    .record(z.string().min(1).max(150), addressBalanceSchema)
    .refine((value) => Object.keys(value).length <= 10000, 'Too many address balance records.')
    .optional(),
  addressUtxos: z
    .record(z.string().min(1).max(150), addressUtxoObservationSchema)
    .refine((value) => Object.keys(value).length <= 10000, 'Too many address UTXO records.')
    .optional(),
});
