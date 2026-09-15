import type { Network, Transaction } from '../../../../../Domain/types';
import { decodeRawTransaction } from '../../../../../Domain/Chain/transactionInspection';
import { rpc } from '../../../../../Infra/Bitcoin/api';

export async function fetchRawInspection(
  network: Network,
  transaction: Transaction,
  signal: AbortSignal,
) {
  let raw: unknown;
  try {
    raw = await rpc(network, 'core', 'getrawtransaction', [transaction.txid, false], signal);
  } catch (error) {
    if (signal.aborted) throw error;
    raw = await rpc(
      network,
      'electrum',
      'blockchain.transaction.get',
      [transaction.txid, false],
      signal,
    );
  }
  signal.throwIfAborted();
  return decodeRawTransaction(raw, transaction);
}
