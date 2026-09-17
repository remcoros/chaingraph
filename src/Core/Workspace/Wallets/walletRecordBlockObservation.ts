import type { Transaction } from '../../ChainData';

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
    status:
      transaction?.status?.kind === 'inactive'
        ? transaction.status
        : mempool
          ? { kind: 'mempool', confirmations: 0 }
          : height !== undefined && height > 0
            ? {
                kind: 'confirmed',
                blockHeight: height,
                blocktime:
                  !transaction?.status?.blockHeight || transaction.status.blockHeight === height
                    ? transaction?.status?.blocktime
                    : undefined,
              }
            : transaction?.status,
  };
}
