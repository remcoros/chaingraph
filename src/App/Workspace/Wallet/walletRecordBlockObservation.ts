import type { Transaction } from '../../../Domain/Chain/transaction';

/** Reconcile a Wallet record's observed height with its loaded transaction.
 * An attached UTXO/history height alone does not supply a timestamp. */
export function walletRecordBlockObservation(
  txid: string,
  transaction: Transaction | undefined,
  height: number | undefined,
  mempool: boolean,
): Transaction {
  return {
    txid,
    vin: [],
    vout: [],
    ...transaction,
    blockHeight: height !== undefined && height > 0 ? height : undefined,
    mempool,
    blocktime:
      !mempool && (!transaction?.blockHeight || transaction.blockHeight === height)
        ? transaction?.blocktime
        : undefined,
  };
}
