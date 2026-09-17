import type { ScanResult, ScanRun, ScanRoute } from './connectionScans';
import { resultFinding } from './connectionScanClassification';

export function scanMeetingNode(result: ScanResult): string | undefined {
  if (result.meetingNode) return result.meetingNode;
  const turn = result.directions.findIndex(
    (direction, index) => index > 0 && direction !== result.directions[index - 1],
  );
  return turn > 0 ? result.path[turn] : undefined;
}

export function scanResultGroupKey(result: ScanResult): string {
  return [
    resultFinding(result),
    result.endpoint,
    scanMeetingNode(result) ?? '',
    result.scanDirection ?? result.directions[0] ?? '',
  ].join('|');
}

/** Stable identity of one finding path, independent of run IDs and observation time. */
export function scanResultIdentity(source: string, result: ScanResult): string {
  const reconnection = scanReconnectionKey(result);
  if (reconnection) return JSON.stringify([source, 'reconnection', reconnection]);
  return JSON.stringify([
    source,
    result.kind,
    scanResultGroupKey(result),
    result.path,
    result.directions,
  ]);
}

/** Keep the newest observation of each exact path, preserving explicit dismissals. */
export function deduplicateScanRuns(
  runs: readonly ScanRun[],
  previous: readonly ScanRun[] = [],
): ScanRun[] {
  const dismissed = new Set<string>();
  for (const run of [...previous, ...runs])
    for (const result of run.results)
      if (result.dismissed) dismissed.add(scanResultIdentity(run.source, result));
  const seen = new Set<string>();
  const retained: ScanRun[] = [];
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    const results: ScanResult[] = [];
    for (let i = run.results.length - 1; i >= 0; i--) {
      const result = run.results[i];
      const key = scanResultIdentity(run.source, result);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(
        dismissed.has(key) && !result.dismissed ? { ...result, dismissed: true } : result,
      );
    }
    results.reverse();
    if (results.length || index === runs.length - 1)
      retained.push(
        results.length === run.results.length &&
          results.every((result, i) => result === run.results[i])
          ? run
          : { ...run, results },
      );
  }
  return retained.reverse();
}

/** Streaming snapshots replace their own run without hiding earlier findings. */
export function mergeScanRunSnapshots(saved: readonly ScanRun[], live: readonly ScanRun[]) {
  const runs = new Map(saved.map((run) => [run.id, run]));
  for (const run of live) runs.set(run.id, run);
  const merged = [...runs.values()];
  return deduplicateScanRuns(merged, [...saved, ...live]);
}

export const scanEdgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
/** Opposite presentations of the same closed route are one relationship. */
export function scanReconnectionKey(result: {
  path: string[];
  context?: ScanRoute;
}): string | undefined {
  if (!result.context) return;
  const edges = new Set<string>();
  for (const path of [result.path, result.context.path])
    path.slice(1).forEach((node, i) => edges.add(scanEdgeKey(path[i], node)));
  return JSON.stringify([result.path[0], [...edges].sort()]);
}
