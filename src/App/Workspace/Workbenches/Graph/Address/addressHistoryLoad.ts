import type { Network } from '../../../../../Core/Bitcoin';
import type { Feedback } from '../../../../feedback';
export type AddressHistoryLoadPhase = 'history' | 'details' | 'balance';
export interface AddressHistoryLoadState {
  workspaceId: string;
  address: string;
  phase: AddressHistoryLoadPhase;
  done: number;
  total: number;
  error?: Feedback;
}
export const addressHistoryLoadKey = (workspaceId: string, network: Network, address: string) =>
  `${workspaceId}:${network}:${address}`;
