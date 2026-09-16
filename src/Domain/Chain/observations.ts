import type { Network } from './network';

export interface AddressHistoryObservation {
  history: { tx_hash: string; height: number }[];
  /** Transaction details were capped while the complete history was observed. */
  truncated: boolean;
  scannedAt?: string;
}

export interface AddressBalanceObservation {
  network: Network;
  confirmedSats: number;
  unconfirmedSats: number;
  checkedAt: string;
}

interface AddressUtxoRecord {
  txid: string;
  vout: number;
  valueSats: number;
  height: number;
}

export interface AddressUtxoObservation {
  network: Network;
  utxos: AddressUtxoRecord[];
  checkedAt: string;
}
