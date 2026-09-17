import { z } from 'zod';
import { transactionSchema, type Transaction } from '../../ChainData/index';
import { SCAN_LIMITS } from './scanPath';

export type ScanDirection = 'upstream' | 'downstream';
export interface ScanRoute {
  path: string[];
  directions: ScanDirection[];
}
export type ScanStopReason =
  | 'depth'
  | 'fan-out'
  | 'time'
  | 'transactions'
  | 'unknown'
  | 'failure'
  | 'results'
  | 'cancelled'
  | 'backend-unavailable'
  | 'rate-limited'
  | 'offline';
export type ScanFinding =
  | 'many-inputs'
  | 'many-outputs'
  | 'unspent'
  | 'coinbase'
  | 'unspendable'
  | 'transaction-unavailable'
  | 'spend-unknown'
  | 'lookup-failed'
  | 'conflicting-evidence';
export interface ScanSettings {
  direction: ScanDirection | 'both';
  targetScope: 'neighbours' | 'visible' | 'added' | 'custom';
  maxHops: number;
  maxTransactions: number;
  maxMilliseconds: number;
  fanOut: number;
}
export interface ScanResult {
  id: string;
  kind: 'connection' | 'boundary' | 'endpoint';
  relationship?: 'direct' | 'shared-ancestor' | 'shared-descendant';
  /** A bounded existing source-to-target route that explains the reconnection. */
  context?: ScanRoute;
  /** Connection between frozen targets in disconnected loaded components. */
  bridge?: true;
  endpoint: string;
  path: string[];
  /** Direction followed on each observed edge, in path order from the source. */
  directions: ScanDirection[];
  hops: number;
  reason?: ScanStopReason;
  dismissed?: boolean;
  finding?: ScanFinding;
  scanDirection?: ScanDirection;
  branchCount?: number;
  checkedAt?: string;
  bestBlock?: string;
  includesMempool?: boolean;
  issueCode?: 'timeout' | 'invalid-response' | 'lookup-failed';
  meetingNode?: string;
}
export type ScanObservation = Pick<
  ScanResult,
  'finding' | 'branchCount' | 'checkedAt' | 'bestBlock' | 'includesMempool' | 'issueCode'
> & { finding: ScanFinding };
export interface ScanRun {
  id: string;
  source: string;
  targetIds: string[];
  settings: ScanSettings;
  startedAt: string;
  status: 'running' | 'complete' | 'cancelled' | 'interrupted' | 'failed';
  examined: number;
  /** Deepest transaction-hop distance reached from a source or target root. */
  deepestHop?: number;
  stopReasons: ScanStopReason[];
  results: ScanResult[];
  omittedResults?: { endpoints: number; issues: number };
}
export interface ConnectionScanRecords {
  /** Bounded results from retained scans, ordered by when each scan started. */
  runs: ScanRun[];
  evidence: Record<string, Transaction>;
}

const txid = z.string().regex(/^[0-9a-f]{64}$/);
const nodeId = z
  .string()
  .regex(/^(?:tx:[0-9a-f]{64}|out:[0-9a-f]{64}:(?:0|[1-9]\d{0,9}))$/)
  .refine((id) => !id.startsWith('out:') || Number(id.split(':')[2]) <= 0xffffffff);
const direction = z.enum(['upstream', 'downstream']);
const reason = z.enum([
  'depth',
  'fan-out',
  'time',
  'transactions',
  'unknown',
  'failure',
  'results',
  'cancelled',
  'backend-unavailable',
  'rate-limited',
  'offline',
]);
const settingsSchema = z
  .object({
    direction: z.enum(['upstream', 'downstream', 'both']),
    targetScope: z.enum(['neighbours', 'visible', 'added', 'custom']),
    maxHops: z.number().int().min(1).max(SCAN_LIMITS.maxHops),
    maxTransactions: z.number().int().min(1).max(SCAN_LIMITS.maxTransactions),
    maxMilliseconds: z.number().int().min(1).max(SCAN_LIMITS.maxMilliseconds),
    fanOut: z.number().int().min(1).max(SCAN_LIMITS.fanOut),
  })
  .strict();
const resultSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(['connection', 'boundary', 'endpoint']),
    relationship: z.enum(['direct', 'shared-ancestor', 'shared-descendant']).optional(),
    endpoint: nodeId,
    path: z
      .array(nodeId)
      .min(1)
      .max(2 * SCAN_LIMITS.maxHops + 3),
    directions: z.array(direction).max(2 * SCAN_LIMITS.maxHops + 2),
    hops: z.number().int().min(0).max(SCAN_LIMITS.maxHops),
    reason: reason.optional(),
    dismissed: z.boolean().optional(),
    finding: z
      .enum([
        'many-inputs',
        'many-outputs',
        'unspent',
        'coinbase',
        'unspendable',
        'transaction-unavailable',
        'spend-unknown',
        'lookup-failed',
        'conflicting-evidence',
      ])
      .optional(),
    scanDirection: direction.optional(),
    branchCount: z.number().int().min(1).max(10000).optional(),
    checkedAt: z.iso.datetime({ offset: true }).optional(),
    bestBlock: txid.optional(),
    includesMempool: z.boolean().optional(),
    issueCode: z.enum(['timeout', 'invalid-response', 'lookup-failed']).optional(),
    meetingNode: nodeId.optional(),
    bridge: z.literal(true).optional(),
    context: z
      .object({
        path: z
          .array(nodeId)
          .min(2)
          .max(2 * SCAN_LIMITS.maxHops + 3),
        directions: z
          .array(direction)
          .min(1)
          .max(2 * SCAN_LIMITS.maxHops + 2),
      })
      .strict()
      .optional(),
  })
  .strict();
export const scanRunSchema = z
  .object({
    id: z.string().min(1).max(100),
    source: nodeId,
    targetIds: z.array(nodeId).max(SCAN_LIMITS.maxTargets),
    settings: settingsSchema,
    startedAt: z.iso.datetime({ offset: true }),
    status: z.enum(['running', 'complete', 'cancelled', 'interrupted', 'failed']),
    examined: z.number().int().min(0).max(SCAN_LIMITS.maxTransactions),
    deepestHop: z.number().int().min(0).max(SCAN_LIMITS.maxHops).optional(),
    stopReasons: z
      .array(reason)
      .max(11)
      .refine((items) => new Set(items).size === items.length, 'Duplicate scan stopping reasons.'),
    results: z.array(resultSchema).max(SCAN_LIMITS.maxResults),
    omittedResults: z
      .object({
        endpoints: z.number().int().min(0).max(1_000_000),
        issues: z.number().int().min(0).max(1_000_000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((run) => run.deepestHop === undefined || run.deepestHop <= run.settings.maxHops, {
    path: ['deepestHop'],
    message: 'Scan depth exceeds its hop limit.',
  });

export const connectionScansSchema = z
  .object({
    runs: z.array(scanRunSchema).max(SCAN_LIMITS.maxRuns),
    evidence: z.record(txid, transactionSchema),
  })
  .strict();

export function validateScanRun(value: unknown): ScanRun {
  return scanRunSchema.parse(value);
}
