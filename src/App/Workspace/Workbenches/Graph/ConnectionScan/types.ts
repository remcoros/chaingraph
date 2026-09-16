import type {
  ConnectionScanRecords,
  StoredScanFinding,
  StoredScanObservation,
  StoredScanResult,
  StoredScanRun,
  StoredScanSettings,
  StoredScanStopReason,
} from '../../../../../Domain/Workspace/connectionScanTypes';

export type ScanStopReason = StoredScanStopReason;
export type ScanFinding = StoredScanFinding;
export type ScanSettings = StoredScanSettings;
export type ScanResult = StoredScanResult;
export type ScanObservation = StoredScanObservation;
export type ScanRun = StoredScanRun;
export type { ConnectionScanRecords };
