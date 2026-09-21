import { z } from 'zod';
import { statusFromPlacement } from '../../../ChainData';

const placement = z
  .object({
    confirmations: z.number().int().min(-0x7fffffff).max(0x7fffffff).optional(),
    blockHeight: z.number().int().min(0).max(0x7fffffff).optional(),
    mempool: z.boolean().optional(),
    blockhash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    blocktime: z.number().int().min(0).max(0xffffffff).optional(),
    time: z.number().int().min(0).max(0xffffffff).optional(),
  })
  .refine(
    (value) =>
      !value.mempool ||
      (value.blockHeight === undefined &&
        value.blockhash === undefined &&
        (value.confirmations ?? 0) === 0),
    'Mempool observations cannot include a block or nonzero confirmations.',
  );

/** Old documents use RPC-style placement fields, including partial knowledge. */
export function migrateTransactionPlacement(records: unknown): unknown {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return records;
  return Object.fromEntries(
    Object.entries(records).map(([id, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [id, value];
      const { confirmations, blockHeight, mempool, blockhash, blocktime, time, ...transaction } =
        value;
      const parsed = placement.safeParse({
        confirmations,
        blockHeight,
        mempool,
        blockhash,
        blocktime,
        time,
      });
      const status = parsed.success ? statusFromPlacement(parsed.data) : undefined;
      return [id, { ...transaction, ...(status ? { status } : {}) }];
    }),
  );
}
