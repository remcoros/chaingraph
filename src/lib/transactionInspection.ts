import type { Transaction } from '../domain/types';
import { decodeRawTransaction } from '../domain/transactionInspection';
import { rpc } from './api';

export async function fetchRawInspection(transaction: Transaction, signal: AbortSignal) {
  let raw: unknown;
  try {
    raw = await rpc('core', 'getrawtransaction', [transaction.txid, false], signal);
  } catch (error) {
    if (signal.aborted) throw error;
    raw = await rpc('electrum', 'blockchain.transaction.get', [transaction.txid, false], signal);
  }
  signal.throwIfAborted();
  return decodeRawTransaction(raw, transaction);
}
