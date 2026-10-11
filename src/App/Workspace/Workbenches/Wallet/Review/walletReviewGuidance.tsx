import type { WalletRow } from '../walletRows';

export function walletSubjectTitle(row: WalletRow): string {
  if (row.relationshipDirection === 'source') return 'Source address';
  if (row.relationshipDirection === 'destination') return 'Destination address';
  if (row.kind === 'address') return row.ownership === 'wallet' ? 'Wallet address' : 'Address';
  if (row.kind === 'transaction') return 'Transaction';
  if (row.utxo || row.reviews.some((item) => item.reason === 'current-utxo')) return 'Wallet UTXO';
  return row.ownership === 'wallet' || row.reviews.some((item) => item.reason === 'source')
    ? 'Wallet output'
    : 'Previous output review';
}
