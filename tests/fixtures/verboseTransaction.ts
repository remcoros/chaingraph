import type { Transaction } from '../../src/Core/ChainData';

/** Native test transactions cross the mock HTTP boundary in the actual verbose RPC shape. */
export function verboseTransaction(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('vin' in value) || !('status' in value))
    return value;
  const { status, ...transaction } = value as Transaction;
  if (!status) return transaction;
  const { kind: _kind, blockHeight: _height, ...coordinates } = status;
  return { ...transaction, ...coordinates };
}
