import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';

export function walletDiscoveryStatus(
  wallet: Wallet,
): { text: string; hint?: string; recovery: 'refresh' | 'settings' | 'none' } | undefined {
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
      text:
        limit < 1000
          ? `Address search limit reached (${limit} per branch)`
          : 'Supported address limit reached (1,000 per branch)',
      hint:
        limit < 1000
          ? 'Increase Addresses per branch in Refresh settings, then refresh.'
          : 'Refresh can still update the addresses already discovered.',
      recovery: limit < 1000 ? 'settings' : 'none',
    };
  if (wallet.pendingTransactionIds?.length) return;
  return { text: 'Address search incomplete', recovery: 'refresh' };
}
