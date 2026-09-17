import {
  scanResultGroupKey,
  deduplicateScanRuns,
} from '../../../../../Core/Workspace/ConnectionScan/results';
import type {
  ScanResult,
  ScanRun,
} from '../../../../../Core/Workspace/ConnectionScan/connectionScans';
import {
  resultCategory,
  resultFinding,
} from '../../../../../Core/Workspace/ConnectionScan/connectionScanClassification';

/** Alternative paths reuse bounded flat records, never a saved search frontier. */
export function groupScanResults(results: readonly ScanResult[]) {
  const groups = new Map<
    string,
    { id: string; category: ReturnType<typeof resultCategory>; results: ScanResult[] }
  >();
  for (const result of results) {
    if (result.dismissed || !resultFinding(result)) continue;
    const id = scanResultGroupKey(result);
    const group = groups.get(id) ?? { id, category: resultCategory(result), results: [] };
    group.results.push(result);
    groups.set(id, group);
  }
  const rank = { connection: 0, branch: 1, issue: 2, endpoint: 3 };
  return [...groups.values()].sort((a, b) => rank[a.category!] - rank[b.category!]);
}

/** Keep each card's original scan context for dismissals and bounded rechecks. */
export function groupScanRuns(runs: readonly ScanRun[]) {
  const rank = { connection: 0, branch: 1, issue: 2, endpoint: 3 };
  return deduplicateScanRuns(runs)
    .reverse()
    .flatMap((run) =>
      groupScanResults(run.results).map((group) => ({
        ...group,
        id: `${run.id}:${group.id}`,
        run,
      })),
    )
    .sort((a, b) => rank[a.category] - rank[b.category]);
}
