import { z } from 'zod';

export const MAX_WALLET_REVIEWS = 20_000;

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
