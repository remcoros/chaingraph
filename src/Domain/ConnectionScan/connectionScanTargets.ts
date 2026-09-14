import { isScanNodeId, SCAN_LIMITS } from './connectionScan';

/** Freeze only explicit picks, without inspecting or expanding their evidence. */
export function prepareCustomScanTargets({
  pickedNodeIds,
  source,
}: {
  pickedNodeIds: readonly string[];
  source: string;
}): string[] {
  if (!isScanNodeId(source)) throw new Error('Choose a transaction or output as the scan source.');
  const targets = new Set<string>();
  for (const id of pickedNodeIds) {
    if (!isScanNodeId(id)) throw new Error('Scan targets must be valid transactions or outputs.');
    if (id === source) continue;
    targets.add(id);
    if (targets.size > SCAN_LIMITS.maxTargets)
      throw new Error('Pick at most 1,000 targets. Remove a pick.');
  }
  return [...targets].sort();
}
