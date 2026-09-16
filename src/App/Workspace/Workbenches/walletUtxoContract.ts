import type { WalletUtxoRecord } from '../../../Domain/Wallet/walletRecords';

/**
 * Transient UTXO observations shared by the Wallet workbench and Graph Inspector.
 * They are scoped to one unlocked wallet and never enter workspace storage.
 */
export interface WalletUtxoView {
  records: WalletUtxoRecord[];
  checkedAt: string;
  checkedAddresses: number;
  totalAddresses: number;
  nextCursor?: number;
  failed: number;
}

export interface WalletUtxoController {
  utxos?: WalletUtxoView;
  loading: boolean;
  error: string;
  check: (cursor?: number) => Promise<void>;
}
