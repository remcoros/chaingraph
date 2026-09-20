import type { TransactionFlowState } from '../../../Core/Workspace/view';
type FlowPanelUpdate = Omit<Partial<TransactionFlowState>, 'height'>;

/** Change the transaction shown by the flow without changing the user's chosen height. */
export function setFlowPanelTransaction(
  current: TransactionFlowState | undefined,
  transactionId: string,
): TransactionFlowState {
  return { ...current, transactionId };
}

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
