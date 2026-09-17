import type { ScanFinding, ScanResult, ScanStopReason } from './connectionScans';

export type ScanResultFinding =
  | ScanFinding
  | 'upstream-connection'
  | 'downstream-connection'
  | 'shared-ancestor'
  | 'shared-descendant';
export type ScanResultCategory = 'connection' | 'branch' | 'endpoint' | 'issue';

/** Normalize legacy path records without promoting run limits into node findings. */
export function resultFinding(result: ScanResult): ScanResultFinding | undefined {
  if (result.reason && SCAN_STATUS_ONLY_REASONS.includes(result.reason)) return undefined;
  if (result.kind === 'connection') {
    if (result.relationship === 'shared-ancestor' || result.relationship === 'shared-descendant')
      return result.relationship;
    const direction = result.scanDirection ?? result.directions[0];
    return direction ? `${direction}-connection` : undefined;
  }
  if (result.finding) return result.finding;
  const direction = result.scanDirection ?? result.directions[0];
  if (result.reason === 'fan-out')
    return direction === 'upstream'
      ? 'many-inputs'
      : direction === 'downstream'
        ? 'many-outputs'
        : undefined;
  if (result.reason === 'unknown')
    return result.endpoint.startsWith('out:') && direction === 'downstream'
      ? 'spend-unknown'
      : 'transaction-unavailable';
  if (result.reason === 'failure') return 'lookup-failed';
  return undefined;
}

export function resultCategory(result: ScanResult): ScanResultCategory {
  const finding = resultFinding(result);
  if (
    finding === 'upstream-connection' ||
    finding === 'downstream-connection' ||
    finding === 'shared-ancestor' ||
    finding === 'shared-descendant'
  )
    return 'connection';
  if (finding === 'many-inputs' || finding === 'many-outputs') return 'branch';
  if (finding === 'unspent' || finding === 'coinbase' || finding === 'unspendable')
    return 'endpoint';
  return 'issue';
}

export const SCAN_STATUS_ONLY_REASONS: readonly ScanStopReason[] = [
  'depth',
  'time',
  'transactions',
  'results',
  'cancelled',
  'backend-unavailable',
  'rate-limited',
  'offline',
];
