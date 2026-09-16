export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';

export interface WalletAddress {
  address: string;
  scripthash: string;
  path: string;
  index: number;
  branch: 0 | 1;
  history?: { tx_hash: string; height: number }[];
}

export interface Wallet {
  id: string;
  name: string;
  key: string;
  scriptType: ScriptType;
  color: string;
  addresses: WalletAddress[];
  scannedAt?: string;
  scanComplete?: boolean;
  scanLimit?: number;
  scanGap?: number;
  pendingTransactionIds?: string[];
  unreviewedTransactionIds?: string[];
  activityOverflow?: boolean;
  lastActivity?: {
    newTransactionIds: string[];
    refreshedTransactionCount: number;
    missingTransactionCount: number;
  };
}
