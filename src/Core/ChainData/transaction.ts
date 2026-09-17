import type { TxInput, TxOutput } from '../Bitcoin';
/** One placement observation. Missing coordinates are not inferred from a chain tip. */
export interface TransactionStatus {
  kind: 'confirmed' | 'mempool' | 'inactive' | 'unknown';
  confirmations?: number;
  /** Actual containing-block height observed from Core or Electrum history. */
  blockHeight?: number;
  blocktime?: number;
  time?: number;
  blockhash?: string;
  /** Present only for a real acquisition, never inferred from import or workspace time. */
  observation?: { source: 'core' | 'electrum'; observedAt: string };
}

export interface Transaction {
  txid: string;
  vin: TxInput[];
  vout: TxOutput[];
  status?: TransactionStatus;
  size?: number;
  vsize?: number;
}
