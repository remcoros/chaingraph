import { addressToScriptHash } from './wallet';
import type { Network, Transaction, Wallet, WalletAddress, Workspace } from '../types';
import { outputNodeId, sats } from '../types';
import { indexPreviousOutputs, outputScriptHash } from '../Chain/prevouts';

export interface WalletTransactionRecord {
  txid: string;
  transaction?: Transaction;
  height?: number;
  mempool: boolean;
  time?: number;
}

export interface WalletUtxoRecord {
  txid: string;
  vout: number;
  valueSats: number;
  height: number;
  address: string;
  scripthash: string;
}

export interface WalletAddressRecord extends WalletAddress {
  loadedOutputCount: number;
}

/** An address claim must agree with its network and recorded Electrum hash. */
export function verifiedWalletAddresses(
  wallet: Pick<Wallet, 'addresses'>,
  network: Network,
): WalletAddress[] {
  const unique = new Map<string, WalletAddress>();
  for (const address of wallet.addresses) {
    try {
      if (addressToScriptHash(address.address, network) === address.scripthash)
        unique.set(address.scripthash, address);
    } catch {
      // Invalid imported claims cannot participate in wallet association.
    }
  }
  return [...unique.values()];
}

/** Count received outputs in the local transaction snapshot, including spent
 * outputs. This is neither a complete history count nor an unspent balance.
 */
export function listWalletAddresses(
  workspace: Pick<Workspace, 'network' | 'transactions'>,
  wallet: Pick<Wallet, 'addresses'>,
): WalletAddressRecord[] {
  const records = verifiedWalletAddresses(wallet, workspace.network).map((address) => ({
    ...address,
    loadedOutputCount: 0,
  }));
  const byScript = new Map(records.map((record) => [record.scripthash, record]));
  for (const tx of Object.values(workspace.transactions)) {
    for (const output of tx.vout) {
      const record = byScript.get(outputScriptHash(output, workspace.network) ?? '');
      if (record) record.loadedOutputCount++;
    }
  }
  return records.sort(
    (a, b) => a.branch - b.branch || a.index - b.index || a.address.localeCompare(b.address),
  );
}

/** Historical association is separate from ownership and current unspent status.
 * Include unloaded history entries so partial scans remain navigable. Script
 * matches add directly received/spent outputs, never unrelated co-inputs.
 */
export function listWalletTransactions(
  workspace: Pick<Workspace, 'network' | 'transactions'>,
  wallet: Pick<Wallet, 'addresses'>,
): WalletTransactionRecord[] {
  const addresses = verifiedWalletAddresses(wallet, workspace.network);
  const hashes = new Set(addresses.map((address) => address.scripthash));
  const histories = new Map<string, Set<number>>();
  for (const address of addresses) {
    for (const entry of address.history ?? []) {
      if (
        !/^[0-9a-f]{64}$/i.test(entry.tx_hash) ||
        !Number.isSafeInteger(entry.height) ||
        entry.height < -1 ||
        entry.height > 0x7fffffff
      )
        continue;
      const id = entry.tx_hash.toLowerCase();
      const heights = histories.get(id) ?? new Set<number>();
      heights.add(entry.height);
      histories.set(id, heights);
    }
  }
  const ids = new Set(histories.keys());
  const ownedOutputs = new Set<string>();
  for (const [nodeId, resolution] of indexPreviousOutputs(workspace)) {
    if (resolution.status !== 'loaded' && resolution.status !== 'attached') continue;
    if (hashes.has(outputScriptHash(resolution.output, workspace.network) ?? '')) {
      ownedOutputs.add(nodeId);
      ids.add(nodeId.slice(4, 68));
    }
  }
  for (const tx of Object.values(workspace.transactions)) {
    if (
      tx.vin.some(
        (input) =>
          input.txid !== undefined &&
          input.vout !== undefined &&
          ownedOutputs.has(outputNodeId(input.txid, input.vout)),
      )
    )
      ids.add(tx.txid);
  }
  return [...ids]
    .map((txid): WalletTransactionRecord => {
      const transaction = workspace.transactions[txid];
      const heights = histories.get(txid);
      // Multiple address observations can straddle a block or reorganization.
      // Preserve the record but avoid inventing a definitive conflicting height.
      const observed = heights?.size === 1 ? [...heights][0] : undefined;
      const mempool =
        transaction?.mempool === true ||
        (transaction?.blockHeight === undefined &&
          (transaction?.confirmations ?? 0) <= 0 &&
          observed !== undefined &&
          observed <= 0);
      return {
        txid,
        transaction,
        height: mempool
          ? undefined
          : (transaction?.blockHeight ?? (observed && observed > 0 ? observed : undefined)),
        mempool,
        time: transaction?.blocktime ?? transaction?.time,
      };
    })
    .sort(
      (a, b) =>
        Number(b.mempool) - Number(a.mempool) ||
        (b.height ?? -1) - (a.height ?? -1) ||
        (b.time ?? -1) - (a.time ?? -1) ||
        a.txid.localeCompare(b.txid),
    );
}

/** Bind an Electrum observation to the loaded funding output before navigation.
 * The raw script wins over decoded address text. This verifies output facts, not
 * the server's current claim that the output remains unspent.
 */
export function verifyWalletUtxo(
  record: WalletUtxoRecord,
  transaction: Transaction,
  network: Network,
): boolean {
  try {
    const output = transaction.vout.find((item) => item.n === record.vout);
    return (
      transaction.txid === record.txid &&
      output !== undefined &&
      Number.isSafeInteger(record.vout) &&
      record.vout >= 0 &&
      record.vout <= 0xffffffff &&
      Number.isSafeInteger(record.valueSats) &&
      record.valueSats >= 0 &&
      record.valueSats <= 2_100_000_000_000_000 &&
      sats(output.value) === record.valueSats &&
      addressToScriptHash(record.address, network) === record.scripthash &&
      outputScriptHash(output, network) === record.scripthash
    );
  } catch {
    return false;
  }
}
