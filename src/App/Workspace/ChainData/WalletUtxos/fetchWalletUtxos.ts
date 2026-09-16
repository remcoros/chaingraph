import { z } from 'zod';
import type { Network } from '../../../../Domain/Chain/network';
import type { Wallet } from '../../../../Domain/Wallet/walletTypes';
import type { WalletUtxoRecord } from '../../Wallet/walletRecords';
import { rpc } from '../../../../Infra/Bitcoin/api';
import { addressToScriptHash } from '../../../../Domain/Wallet/wallet';

export const WALLET_UTXO_ADDRESS_BATCH = 100;
export const MAX_WALLET_UTXOS_PER_ADDRESS = 10_000;
const MAX_BATCH_RECORDS = 50_000;
const responseSchema = z
  .array(
    z.object({
      tx_hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/i)
        .transform((id) => id.toLowerCase()),
      tx_pos: z.number().int().min(0).max(0xffffffff),
      height: z.number().int().min(0).max(0x7fffffff),
      value: z.number().int().min(0).max(2_100_000_000_000_000),
    }),
  )
  .max(MAX_WALLET_UTXOS_PER_ADDRESS);

export interface WalletUtxoBatch {
  network: Network;
  walletId: string;
  records: WalletUtxoRecord[];
  checkedAt: string;
  totalAddresses: number;
  /** Absolute processed address count, including this batch and earlier cursors. */
  checkedAddresses: number;
  successfulAddresses: number;
  nextCursor?: number;
  errors: { address: string; message: string }[];
}

/** Bounded, mempool-aware observations for already discovered addresses only.
 * No derivation, persistent cache, or inference from loaded spending history.
 * Keep the same address snapshot between cursor calls; restart after discovery.
 * A completed cursor does not imply a complete wallet scan or an atomic chain tip.
 */
export async function fetchWalletUtxos(
  network: Network,
  wallet: Wallet,
  options: {
    cursor?: number;
    signal?: AbortSignal;
    onProgress?: (checked: number, total: number) => void;
  } = {},
): Promise<WalletUtxoBatch> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (network !== 'mainnet' && network !== 'testnet4')
    throw new Error('Choose mainnet or testnet4 for this request.');
  if (wallet.addresses.length > 10_000) throw new Error('Wallet address limit exceeded.');
  // Validate all claims before any request. Never route another network's scripts
  // using a caller's incorrect network, including on continuation batches.
  const unique = new Map<string, Wallet['addresses'][number]>();
  for (const address of wallet.addresses) {
    if (addressToScriptHash(address.address, network) !== address.scripthash)
      throw new Error('Wallet address does not match its script hash.');
    if (!unique.has(address.scripthash)) unique.set(address.scripthash, address);
  }
  const addresses = [...unique.values()];
  const cursor = options.cursor ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > addresses.length)
    throw new Error('Invalid wallet UTXO continuation.');
  const slice = addresses.slice(cursor, cursor + WALLET_UTXO_ADDRESS_BATCH);
  const result: WalletUtxoBatch = {
    network,
    walletId: wallet.id,
    records: [],
    checkedAt: '',
    totalAddresses: addresses.length,
    checkedAddresses: cursor,
    successfulAddresses: 0,
    nextCursor: cursor + slice.length < addresses.length ? cursor + slice.length : undefined,
    errors: [],
  };
  const records = new Map<string, WalletUtxoRecord>();
  const conflicts = new Set<string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, slice.length) }, async () => {
      while (next < slice.length) {
        signal?.throwIfAborted();
        const address = slice[next++];
        try {
          const response = await rpc<unknown>(
            network,
            'electrum',
            'blockchain.scripthash.listunspent',
            [address.scripthash],
            signal,
          );
          signal?.throwIfAborted();
          // Bound before schema traversal to avoid work on oversized responses.
          if (!Array.isArray(response) || response.length > MAX_WALLET_UTXOS_PER_ADDRESS)
            throw new Error('Invalid response.');
          const parsed = responseSchema.safeParse(response);
          if (!parsed.success) throw new Error('Invalid response.');
          const additions = new Map<string, WalletUtxoRecord>();
          for (const item of parsed.data) {
            const key = `${item.tx_hash}:${item.tx_pos}`;
            const record = {
              txid: item.tx_hash,
              vout: item.tx_pos,
              height: item.height,
              valueSats: item.value,
              address: address.address,
              scripthash: address.scripthash,
            };
            const previous = additions.get(key) ?? records.get(key);
            if (
              conflicts.has(key) ||
              (previous &&
                (previous.scripthash !== record.scripthash ||
                  previous.valueSats !== record.valueSats ||
                  previous.height !== record.height))
            ) {
              conflicts.add(key);
              records.delete(key);
              throw new Error('Conflicting output.');
            }
            additions.set(key, record);
          }
          if (records.size + additions.size > MAX_BATCH_RECORDS)
            throw new Error('Batch output limit reached.');
          for (const [id, record] of additions) records.set(id, record);
          result.successfulAddresses++;
        } catch (error) {
          if (signal?.aborted) throw error;
          result.errors.push({
            address: address.address,
            message: 'Could not verify the UTXO response for this address. Retry the check.',
          });
        }
        result.checkedAddresses++;
        options.onProgress?.(result.checkedAddresses, addresses.length);
      }
    }),
  );
  signal?.throwIfAborted();
  result.records = [...records.values()].sort(
    (a, b) =>
      Number(b.height === 0) - Number(a.height === 0) ||
      b.height - a.height ||
      a.txid.localeCompare(b.txid) ||
      a.vout - b.vout,
  );
  result.checkedAt = new Date().toISOString();
  return result;
}
