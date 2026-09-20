import { z } from 'zod';
const txid = z.string().regex(/^[0-9a-f]{64}$/);
const height = z.number().int().min(-1).max(0x7fffffff);
const timestamp = z.iso.datetime({ offset: true });
const derivationIndex = z.number().int().min(0).max(0x7fffffff);
import type { ScriptType } from '../../Bitcoin/index';
export interface DerivedAddress {
  address: string;
  scripthash: string;
  path: string;
  index: number;
  branch: 0 | 1;
}

export const MAX_WALLET_REVIEWS = 20_000;
export const MAX_WALLET_HISTORY_ENTRIES = 50_000;

export interface WalletReviewRecord {
  status: 'reviewed' | 'unknown' | 'later';
  at: string;
  evidence: string;
}

export type WalletReviewRecords = Record<string, WalletReviewRecord>;

export const walletReviewsSchema = z
  .record(
    z.string().max(200),
    z.object({
      status: z.enum(['reviewed', 'unknown', 'later']),
      at: z.iso.datetime({ offset: true }),
      evidence: z.string().max(80),
    }),
  )
  .refine(
    (value) => Object.keys(value).length <= MAX_WALLET_REVIEWS,
    `A workspace holds at most ${MAX_WALLET_REVIEWS.toLocaleString('en-US')} review decisions.`,
  );

export function assertWalletReviewBudget(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.keys(value as object).length > MAX_WALLET_REVIEWS)
    throw new Error(
      `A workspace holds at most ${MAX_WALLET_REVIEWS.toLocaleString('en-US')} review decisions.`,
    );
}

/** Reject aggregate address history before document schema parsing expands untrusted records. */
export function assertWalletHistoryBudget(value: unknown): void {
  if (!Array.isArray(value)) return;
  let entries = 0;
  for (const wallet of value) {
    if (!wallet || typeof wallet !== 'object' || Array.isArray(wallet)) continue;
    const addresses = (wallet as { addresses?: unknown }).addresses;
    if (!Array.isArray(addresses)) continue;
    for (const address of addresses) {
      if (!address || typeof address !== 'object' || Array.isArray(address)) continue;
      const history = (address as { history?: unknown }).history;
      if (!Array.isArray(history)) continue;
      entries += history.length;
      if (entries > MAX_WALLET_HISTORY_ENTRIES)
        throw new Error(
          `A workspace holds at most ${MAX_WALLET_HISTORY_ENTRIES.toLocaleString('en-US')} wallet address history entries.`,
        );
    }
  }
}

/** A wallet binds a derivation to shared chain subjects and owns discovery coverage. */
export interface WalletAddress extends DerivedAddress {
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
  lastActivity?: {
    addedTransactionCount: number;
    refreshedTransactionCount: number;
    missingTransactionCount: number;
  };
}

const walletSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  key: z.string().max(150),
  scriptType: z.enum(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr']),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  addresses: z
    .array(
      z.object({
        address: z.string().min(1).max(150),
        scripthash: txid,
        path: z.string().max(100),
        index: derivationIndex,
        branch: z.union([z.literal(0), z.literal(1)]),
        history: z
          .array(z.object({ tx_hash: txid, height }))
          .max(10000)
          .optional(),
      }),
    )
    .max(10000),
  scannedAt: timestamp.optional(),
  scanComplete: z.boolean().optional(),
  scanLimit: z.number().int().min(1).max(0x80000000).optional(),
  scanGap: z.number().int().min(1).max(100).optional(),
  pendingTransactionIds: z.array(txid).max(10000).optional(),
  lastActivity: z
    .object({
      addedTransactionCount: z.number().int().min(0).max(500),
      refreshedTransactionCount: z.number().int().min(0).max(500),
      missingTransactionCount: z.number().int().min(0).max(100_000_000),
    })
    .optional(),
});
export const walletsSchema = z.object({
  definitions: z.array(walletSchema).max(100),
  reviews: walletReviewsSchema.optional(),
});
