import {
  SCAN_STATUS_ONLY_REASONS,
  type ScanFinding,
  type ScanResult,
  type ScanRun,
} from './connectionScan';

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

/** Keep dismissals across snapshots and put connections before branches, issues and endpoints. */
export function presentScanRun(run: ScanRun, dismissed: ReadonlySet<string>): ScanRun {
  const rank: Record<ScanResultCategory, number> = {
    connection: 0,
    branch: 1,
    issue: 2,
    endpoint: 3,
  };
  return {
    ...run,
    results: run.results
      .filter((result) => resultFinding(result) !== undefined)
      .map((result) => (dismissed.has(result.id) ? { ...result, dismissed: true } : result))
      .sort((a, b) => rank[resultCategory(a)] - rank[resultCategory(b)]),
  };
}

export interface ScanStatus {
  label: string;
  tone: 'running' | 'complete' | 'warning' | 'error';
}

/** Configured branch boundaries complete normally; whole-run stops stay explicit. */
export function scanStatus(run: ScanRun, running: boolean): ScanStatus {
  if (running) return { label: 'Scanning…', tone: 'running' };
  if (run.status === 'failed') return { label: 'Scan failed.', tone: 'error' };
  if (run.status === 'cancelled' || run.stopReasons.includes('cancelled'))
    return { label: 'Scan cancelled.', tone: 'warning' };
  if (run.status === 'interrupted' || run.status === 'running')
    return { label: 'Scan interrupted.', tone: 'warning' };
  if (run.stopReasons.includes('backend-unavailable'))
    return { label: 'Scan stopped: backend unavailable', tone: 'warning' };
  if (run.stopReasons.includes('rate-limited'))
    return { label: 'Scan stopped: request limit reached', tone: 'warning' };
  if (run.stopReasons.includes('time'))
    return { label: 'Scan stopped: time limit reached', tone: 'warning' };
  if (run.stopReasons.includes('transactions'))
    return { label: 'Scan stopped: transaction limit reached', tone: 'warning' };
  if (run.stopReasons.includes('results'))
    return { label: 'Scan stopped: result limit reached', tone: 'warning' };
  if (run.stopReasons.includes('offline'))
    return { label: 'Scan completed: offline coverage only', tone: 'warning' };
  if (run.stopReasons.includes('failure') || run.stopReasons.includes('unknown'))
    return { label: 'Scan completed: some paths unavailable', tone: 'warning' };
  return { label: 'Scan completed.', tone: 'complete' };
}

export function scanStatusLabel(run: ScanRun, running: boolean): string {
  return scanStatus(run, running).label;
}
