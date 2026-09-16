import type { Wallet } from '../../../../Domain/Wallet/walletTypes';

export function walletDiscoveryStatus(wallet: Wallet): { text: string; hint?: string } | undefined {
  if (!wallet.scannedAt || wallet.scanComplete === true) return;
  const limit = wallet.scanLimit;
  const gap = wallet.scanGap;
  const hitLimit =
    limit !== undefined &&
    gap !== undefined &&
    ([0, 1] as const).some((branch) => {
      const addresses = wallet.addresses
        .filter((entry) => entry.branch === branch)
        .sort((a, b) => b.index - a.index);
      if (addresses.some((entry) => entry.index >= limit && entry.history?.length)) return true;
      const checked = addresses.filter((entry) => entry.index < limit);
      if ((checked[0]?.index ?? -1) < limit - 1) return false;
      let unused = 0;
      for (const address of checked) {
        if (!address.history || address.history.length) break;
        unused++;
      }
      return unused < gap;
    });
  if (hitLimit && limit !== undefined)
    return {
      text: `Address limit: ${limit}/branch`,
      hint:
        limit < 1000
          ? 'Increase Addresses / branch in Graph wallet controls, then Refresh.'
          : 'The supported address search ends at 1,000 per branch. Repeating the same scan cannot search further.',
    };
  if (wallet.pendingTransactionIds?.length) return;
  return { text: 'Refresh to finish address discovery' };
}
