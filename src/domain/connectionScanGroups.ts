import type { ScanResult } from './connectionScan';
import { resultCategory, resultFinding } from './connectionScanPresentation';

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
