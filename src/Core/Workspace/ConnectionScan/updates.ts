import type { Workspace } from '../workspace';
import { type ScanRun, validateScanRun } from './connectionScans';
import { compactConnectionScanRecords, validateConnectionScanRecords } from './records';
import type { Transaction } from '../../ChainData';

export function replaceScanRun(
  workspace: Workspace,
  run: ScanRun,
  evidence: Record<string, Transaction> = {},
): Workspace {
  validateScanRun(run);
  const runs = workspace.connectionScans?.runs ?? [];
  const records = compactConnectionScanRecords(
    workspace,
    runs.some((retained) => retained.id === run.id)
      ? runs.map((retained) => (retained.id === run.id ? run : retained))
      : [...runs, run],
    evidence,
  );
  validateConnectionScanRecords(records, workspace, false);
  return { ...workspace, connectionScans: records };
}

export function clearScanRuns(workspace: Workspace): Workspace {
  return workspace.connectionScans ? { ...workspace, connectionScans: undefined } : workspace;
}
