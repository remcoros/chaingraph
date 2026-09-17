import { parseTransaction } from './transactionValidation';
import { statusFromPlacement } from './transactionStatus';
import type { TransactionStatus } from './transaction';

/** RPC fields are not the application document. Upstreams cannot supply application status. */
export function parseVerboseTransaction(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return parseTransaction(value);
  const raw = value as Record<string, unknown>;
  const { confirmations, blockhash, blocktime, time } = raw;
  return parseTransaction({
    ...raw,
    status: statusFromPlacement({ confirmations, blockhash, blocktime, time } as Omit<
      TransactionStatus,
      'kind'
    >),
  });
}
