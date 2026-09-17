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
