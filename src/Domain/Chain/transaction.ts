export interface TxOutputDetails {
  value: number;
  scriptPubKey: {
    hex?: string;
    address?: string;
    addresses?: string[];
    type?: string;
  };
}

export interface TxInput {
  txid?: string;
  vout?: number;
  coinbase?: string;
  sequence?: number;
  /** Historical output content observed with this spend, not current UTXO status. */
  prevout?: TxOutputDetails;
}

export interface TxOutput extends TxOutputDetails {
  n: number;
}

export interface Transaction {
  txid: string;
  vin: TxInput[];
  vout: TxOutput[];
  confirmations?: number;
  /** Actual containing-block height observed from Core or Electrum history. */
  blockHeight?: number;
  /** Present only when an upstream observed the transaction in its mempool. */
  mempool?: boolean;
  blocktime?: number;
  time?: number;
  size?: number;
  vsize?: number;
  blockhash?: string;
}

export const sats = (btc: number) => Math.round(btc * 100_000_000);
