/**
 * What a connection scan walks over: which nodes it may visit, which way an
 * edge was followed, how a route is measured, and the ceilings that bound it.
 *
 * The search and the context index it builds both speak this vocabulary, so it
 * lives below each of them rather than in either one.
 */
import { isScanNodeId, MAX_CONNECTION_SCAN_TARGETS } from '../../../ConnectionScan/scanNode';

export type ScanDirection = 'upstream' | 'downstream';

/** A bounded route between scan nodes, in path order from the source. */
export interface ScanRoute {
  path: string[];
  directions: ScanDirection[];
}

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
