import type { ScanRun } from './connectionScan';

/** Keep user dismissals across worker snapshots; old depth rows are never shown again. */
export function presentScanRun(run: ScanRun, dismissed: ReadonlySet<string>): ScanRun {
  return {
    ...run,
    results: run.results
      .filter((result) => result.reason !== 'depth')
      .map((result) => (dismissed.has(result.id) ? { ...result, dismissed: true } : result)),
  };
}

/** One useful completion reason, with whole-run stops ahead of earlier branch limits. */
export function scanStatusLabel(run: ScanRun, running: boolean): string {
  if (running) return 'Scanning';
  if (run.status === 'cancelled') return 'Cancelled';
  if (run.status === 'interrupted' || run.status === 'running') return 'Interrupted';
  if (run.status === 'failed') return 'Scan failed';
  if (run.stopReasons.includes('time')) return 'Time limit reached';
  if (run.stopReasons.includes('transactions')) return 'Transaction limit reached';
  if (run.stopReasons.includes('results')) return 'Result limit reached';
  if (run.stopReasons.includes('failure')) return 'Some lookups failed';
  if (run.stopReasons.includes('unknown')) return 'Missing chain data';
  if (run.stopReasons.includes('fan-out')) return 'Large transaction reached';
  if (run.stopReasons.includes('depth')) return `${run.settings.maxHops}-hop limit reached`;
  return 'Finished';
}
