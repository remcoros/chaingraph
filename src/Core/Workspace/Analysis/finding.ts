import { z } from 'zod';
const text = z.string().max(10000);
const timestamp = z.iso.datetime({ offset: true });
const txid = z.string().regex(/^[0-9a-f]{64}$/);
/** Review ordering rule recorded on a finding, never a confidence or ownership claim. */
type ReviewRule = 'fee-threshold' | 'repeated-address' | 'distinct-wallet-inputs';

export interface AnalysisFinding {
  id: string;
  algorithm: string;
  title: string;
  description: string;
  details?: string;
  guidance?: { kind: 'tip' | 'privacy' | 'next-step'; text: string };
  nodeIds: string[];
  txids: string[];
  /** Factual entities this finding concerns. Evidence may be broader than these subjects. */
  subjects?: string[];
  createdAt: string;
  excluded?: boolean;
  kind?: 'observation' | 'hypothesis' | 'incomplete';
  scopeTxids?: string[];
  stale?: boolean;
  reviewRule?: ReviewRule;
}

export const analysisSchema = z.object({
  findings: z
    .array(
      z.object({
        id: z.string().max(100),
        algorithm: z.string().max(100),
        title: z.string().max(200),
        description: text,
        details: text.optional(),
        guidance: z
          .object({
            kind: z.enum(['tip', 'privacy', 'next-step']),
            text,
          })
          .optional(),
        nodeIds: z.array(z.string().max(200)).max(30000),
        txids: z.array(txid).max(10000),
        subjects: z.array(z.string().max(200)).min(1).max(30000).optional(),
        createdAt: timestamp,
        excluded: z.boolean().optional(),
        kind: z.enum(['observation', 'hypothesis', 'incomplete']).optional(),
        scopeTxids: z.array(txid).max(10000).optional(),
        stale: z.boolean().optional(),
        reviewRule: z
          .enum(['fee-threshold', 'repeated-address', 'distinct-wallet-inputs'])
          .optional(),
      }),
    )
    .max(10000),
});
