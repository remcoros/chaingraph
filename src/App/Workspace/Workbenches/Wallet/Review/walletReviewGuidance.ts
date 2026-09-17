import type { AnalysisFinding } from '../../../../../Core/Workspace/Analysis/finding';
import type { WalletRow } from '../walletRows';

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
  finding?: AnalysisFinding,
  canSelectRelated = false,
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
  if (reason === 'link') {
    const organize = canSelectRelated
      ? 'Use “Select related” to select matching results, then “Tags” to record a shared purpose, such as “Donations”.'
      : 'Use “Tags” to record a purpose you recognize, such as “Donations”.';
    const acknowledge = 'Choose “Mark reviewed” when you are done.';
    if (finding?.algorithm.replace(/-v\d+$/, '') === 'address-reuse') {
      const repeated = new Set(finding.txids).size > 1;
      return repeated
        ? `This address was used in multiple transactions, making those payments easy to connect. Use a fresh receiving address for future payments. ${organize} ${acknowledge}`
        : `Several outputs in one transaction use the same address. This does not necessarily mean it was reused for separate payments. ${organize} ${acknowledge}`;
    }
    const explanation = finding?.description ?? row.description;
    return `${explanation} ${finding?.guidance?.text ?? 'Open “Transaction flow” and add any labels or tags that help explain the activity.'} ${acknowledge}`;
  }
  const missingContext = !metadata.label?.trim() && metadata.tagCount === 0;
  const finish = row.reviews.length
    ? 'Confirm the recorded context, then choose “Mark reviewed”.'
    : 'Keep the label and tags up to date.';
  if (row.relationshipDirection === 'source')
    return missingContext
      ? 'This source address has no label or tags. Add a label for the sender or source you recognize.'
      : `Source address in incoming wallet activity. ${finish}`;
  if (row.relationshipDirection === 'destination')
    return missingContext
      ? 'This destination address has no label or tags. Add a label for the recipient or purpose you recognize.'
      : `Destination address in outgoing wallet activity. ${finish}`;
  if (reason === 'current-utxo' || row.utxo)
    return missingContext
      ? 'This coin has no label or tags. Add a label to remember where you received it or what you are keeping it for.'
      : `This UTXO already has recorded context. ${finish}`;
  if (reason === 'wallet-address' || row.kind === 'address')
    return missingContext
      ? `This ${row.ownership === 'wallet' ? 'wallet address' : 'address'} has no label or tags. Add a label to record what you use it for.`
      : `This address already has a label or tags. ${finish}`;
  if (reason === 'source')
    return missingContext
      ? 'An earlier wallet receipt led to your current coins; add the source you recognize.'
      : `An earlier wallet receipt led to your current coins. ${finish}`;
  if (reason === 'new-activity')
    return 'Found during a wallet refresh; check the transaction and record any context you recognize.';
  return missingContext
    ? 'Add a label or tag to record what this transaction was for.'
    : `Transaction with recorded context. ${finish}`;
}
