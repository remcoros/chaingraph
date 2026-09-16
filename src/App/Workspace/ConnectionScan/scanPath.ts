import { isScanNodeId, MAX_CONNECTION_SCAN_TARGETS } from './scanNode';

export type ScanDirection = 'upstream' | 'downstream';

/** A bounded route between scan nodes, in path order from the source. */
export interface ScanRoute {
  path: string[];
  directions: ScanDirection[];
}

/** Limits shared by scan execution and validation of retained scan records. */
export const SCAN_LIMITS = {
  maxHops: 8,
  maxTransactions: 1000,
  maxMilliseconds: 60_000,
  fanOut: 1000,
  maxTargets: MAX_CONNECTION_SCAN_TARGETS,
  maxResults: 50,
  maxEndpointResults: 10,
  maxIssueResults: 10,
  maxRuns: 20,
} as const;

export { isScanNodeId };

/** A hop enters another transaction; its output edge does not add another hop. */
export function scanPathHops(path: readonly string[]): number {
  return path.slice(1).filter((node) => node.startsWith('tx:')).length;
}
