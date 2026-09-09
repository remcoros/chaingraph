import type { WalletRow } from './walletWorkbenchRows';

export function walletSubjectTitle(row: WalletRow): string {
  if (row.relationshipDirection === 'source') return 'Source address';
  if (row.relationshipDirection === 'destination') return 'Destination address';
  if (row.kind === 'address') return row.ownership === 'wallet' ? 'Wallet address' : 'Address';
  if (row.kind === 'transaction') return 'Transaction';
  if (row.utxo || row.reviews.some((item) => item.reason === 'current-utxo')) return 'Wallet UTXO';
  return row.ownership === 'wallet' || row.reviews.some((item) => item.reason === 'source')
    ? 'Wallet receipt'
    : 'Previous output review';
}

export function walletReviewGuidance(
  row: WalletRow,
  metadata: { label?: string; tagCount: number },
): string {
  const reason = row.reviews.find((item) => item.key === row.key)?.reason;
  if (reason === 'funding-source' || reason === 'counterparty')
    return 'Saved output decision. Use the source or destination address for new reviews.';
  if (row.changed)
    return 'Transaction details changed since your last decision; check the updated information before reviewing it again.';
  if (row.status === 'unknown')
    return 'Previously reviewed with the source unknown; reopen this decision only if you want to revisit it.';
  if (row.status === 'reviewed')
    return 'Already reviewed. Reopen it if the recorded context needs another look.';
  if (row.status === 'later')
    return 'Set aside for later. Add any context you now recognize, or return it to your review queue.';
  const missingContext = !metadata.label?.trim() && metadata.tagCount === 0;
  const finish = row.reviews.length
    ? 'Confirm the recorded context, then mark reviewed.'
    : 'Keep the label and tags up to date.';
  if (row.relationshipDirection === 'source')
    return missingContext
      ? 'No label or tags for this source address; add an exchange or sender you recognize.'
      : `Source address in incoming wallet activity. ${finish}`;
  if (row.relationshipDirection === 'destination')
    return missingContext
      ? 'No label or tags for this destination address; add the shop or recipient you recognize.'
      : `Destination address in outgoing wallet activity. ${finish}`;
  if (reason === 'current-utxo' || row.utxo)
    return missingContext
      ? 'This current UTXO has no label or tags; record its purpose or where you received it.'
      : `This UTXO already has recorded context. ${finish}`;
  if (reason === 'wallet-address' || row.kind === 'address')
    return missingContext
      ? 'This wallet address has no label or tags; record what you use it for.'
      : `This wallet address already has recorded context. ${finish}`;
  if (reason === 'source')
    return missingContext
      ? 'An earlier wallet receipt led to your current coins; add the source you recognize.'
      : `An earlier wallet receipt led to your current coins. ${finish}`;
  if (reason === 'new-activity')
    return 'Found during a wallet refresh; check the transaction and record any context you recognize.';
  if (reason === 'link')
    return 'A saved analysis finding touches your wallet; check its supporting transactions before reviewing it.';
  return missingContext
    ? 'Add a label or tag to record what this transaction was for.'
    : `Transaction with recorded context. ${finish}`;
}
