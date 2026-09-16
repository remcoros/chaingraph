import type { Transaction } from '../Chain/transaction';

type StoredScanDirection = 'upstream' | 'downstream';
interface StoredScanRoute {
  path: string[];
  directions: StoredScanDirection[];
}
export type StoredScanStopReason =
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
export type StoredScanFinding =
  | 'many-inputs'
  | 'many-outputs'
  | 'unspent'
  | 'coinbase'
  | 'unspendable'
  | 'transaction-unavailable'
  | 'spend-unknown'
  | 'lookup-failed'
  | 'conflicting-evidence';
export interface StoredScanSettings {
  direction: StoredScanDirection | 'both';
  targetScope: 'neighbours' | 'visible' | 'added' | 'custom';
  maxHops: number;
  maxTransactions: number;
  maxMilliseconds: number;
  fanOut: number;
}
export interface StoredScanResult {
  id: string;
  kind: 'connection' | 'boundary' | 'endpoint';
  relationship?: 'direct' | 'shared-ancestor' | 'shared-descendant';
  /** A bounded existing source-to-target route that explains the reconnection. */
  context?: StoredScanRoute;
  /** Connection between frozen targets in disconnected loaded components. */
  bridge?: true;
  endpoint: string;
  path: string[];
  /** Direction followed on each observed edge, in path order from the source. */
  directions: StoredScanDirection[];
  hops: number;
  reason?: StoredScanStopReason;
  dismissed?: boolean;
  finding?: StoredScanFinding;
  scanDirection?: StoredScanDirection;
  branchCount?: number;
  checkedAt?: string;
  bestBlock?: string;
  includesMempool?: boolean;
  issueCode?: 'timeout' | 'invalid-response' | 'lookup-failed';
  meetingNode?: string;
}
export type StoredScanObservation = Pick<
  StoredScanResult,
  'finding' | 'branchCount' | 'checkedAt' | 'bestBlock' | 'includesMempool' | 'issueCode'
> & { finding: StoredScanFinding };
export interface StoredScanRun {
  id: string;
  source: string;
  targetIds: string[];
  settings: StoredScanSettings;
  startedAt: string;
  status: 'running' | 'complete' | 'cancelled' | 'interrupted' | 'failed';
  examined: number;
  /** Deepest transaction-hop distance reached from a source or target root. */
  deepestHop?: number;
  stopReasons: StoredScanStopReason[];
  results: StoredScanResult[];
  omittedResults?: { endpoints: number; issues: number };
}
export interface ConnectionScanRecords {
  /** Bounded results from retained scans, ordered by when each scan started. */
  runs: StoredScanRun[];
  evidence: Record<string, Transaction>;
}
