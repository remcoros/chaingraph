import type { ScanRun } from './connectionScan';

/** Keep user dismissals across worker snapshots; old depth/time rows are never shown again. */
export function presentScanRun(run: ScanRun, dismissed: ReadonlySet<string>): ScanRun {
  return {
    ...run,
    results: run.results
      .filter((result) => result.reason !== 'depth' && result.reason !== 'time')
      .map((result) => (dismissed.has(result.id) ? { ...result, dismissed: true } : result)),
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
  if (run.stopReasons.includes('time'))
    return { label: 'Scan stopped: time limit reached', tone: 'warning' };
  if (run.stopReasons.includes('transactions'))
    return { label: 'Scan stopped: transaction limit reached', tone: 'warning' };
  if (run.stopReasons.includes('results'))
    return { label: 'Scan stopped: result limit reached', tone: 'warning' };
  if (run.stopReasons.includes('failure') || run.stopReasons.includes('unknown'))
    return { label: 'Scan completed: some paths unavailable', tone: 'warning' };
  return { label: 'Scan completed.', tone: 'complete' };
}

export function scanStatusLabel(run: ScanRun, running: boolean): string {
  return scanStatus(run, running).label;
}
