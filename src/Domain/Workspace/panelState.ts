import type { TransactionFlowState } from '../types';

type FlowPanelUpdate = Omit<Partial<TransactionFlowState>, 'height'>;

/** Open the flow panel without shrinking an already full-height panel. */
export function openFlowPanel(
  current: TransactionFlowState | undefined,
  update: FlowPanelUpdate = {},
): TransactionFlowState {
  return {
    ...current,
    ...update,
    height: current?.height === 'full' ? 'full' : 'expanded',
  };
}
