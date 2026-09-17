import { verifiedWalletAddresses, type WalletUtxoRecord } from '../walletRecords';
import type { Wallet } from '../wallets';
import type { Workspace } from '../../workspace';

/** A projection of retained address observations, never a second UTXO collection. */
export interface WalletUtxoCheck {
  records: WalletUtxoRecord[];
  /** Oldest contributing address observation; partial refresh never renews earlier pages. */
  checkedAt: string;
  checkedAddresses: number;
  totalAddresses: number;
  nextCursor?: number;
  failed: number;
}

export function readWalletUtxoCheck(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'addressUtxos'>;
  },
  wallet: Pick<Wallet, 'addresses'>,
): WalletUtxoCheck | undefined {
  const addresses = verifiedWalletAddresses(wallet, workspace.network);
  const records = new Map<string, WalletUtxoRecord>();
  const conflicts = new Set<string>();
  let checkedAt: string | undefined;
  let checkedAddresses = 0;
  let nextCursor: number | undefined;
  for (const [cursor, address] of addresses.entries()) {
    const observation = workspace.chainData.addressUtxos?.[address.address];
    if (
      !observation ||
      observation.network !== workspace.network ||
      !Number.isFinite(Date.parse(observation.checkedAt))
    ) {
      nextCursor ??= cursor;
      continue;
    }
    checkedAddresses++;
    if (!checkedAt || Date.parse(observation.checkedAt) < Date.parse(checkedAt))
      checkedAt = observation.checkedAt;
    for (const item of observation.utxos) {
      const key = `${item.txid}:${item.vout}`;
      const previous = records.get(key);
      if (conflicts.has(key)) continue;
      if (
        previous &&
        (previous.scripthash !== address.scripthash ||
          previous.valueSats !== item.valueSats ||
          previous.height !== item.height)
      ) {
        records.delete(key);
        conflicts.add(key);
        continue;
      }
      records.set(key, { ...item, address: address.address, scripthash: address.scripthash });
    }
  }
  if (!checkedAt) return undefined;
  return {
    records: [...records.values()].sort(
      (a, b) =>
        Number(b.height === 0) - Number(a.height === 0) ||
        b.height - a.height ||
        a.txid.localeCompare(b.txid) ||
        a.vout - b.vout,
    ),
    checkedAt,
    checkedAddresses,
    totalAddresses: addresses.length,
    nextCursor,
    failed: conflicts.size,
  };
}
