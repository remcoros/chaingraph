import type {
  ConnectionScanOptions,
  ScanDirection,
  ScanNeighbors,
  ScanRun,
  ScanStopReason,
} from '../domain/connectionScan';
export type ConnectionScanRequest = Pick<
  ConnectionScanOptions,
  'id' | 'source' | 'targetIds' | 'displayedNodeIds' | 'knownNodeIds' | 'knownLinks' | 'settings'
>;
export type ScanWorkerInput =
  | { type: 'start'; request: ConnectionScanRequest }
  | { type: 'cancel' }
  | {
      type: 'neighbors';
      id: number;
      neighbors?: ScanNeighbors;
      examinedTxids: string[];
      error?: ScanStopReason;
    };
export type ScanWorkerOutput =
  | {
      type: 'resolve';
      id: number;
      nodeId: string;
      direction: ScanDirection;
      examinedTxids: string[];
    }
  | { type: 'progress'; run: ScanRun }
  | { type: 'complete'; run: ScanRun }
  | { type: 'error' };
