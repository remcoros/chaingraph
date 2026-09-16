export type GraphLeftTab = 'wallets' | 'entities' | 'bookmarks' | 'tags';
export type GraphRightTab = 'scan' | 'inspect' | 'addresses' | 'transactions' | 'utxos';
export type GraphMobilePanel = 'graph' | 'left' | 'right';
export type FlowPanelHeight = 'collapsed' | 'expanded' | 'full';

export interface TransactionFlowState {
  transactionId?: string;
  expandedInputs?: boolean;
  expandedOutputs?: boolean;
  height?: FlowPanelHeight;
}

export interface GraphPanelsState {
  left?: { tab?: GraphLeftTab; collapsed?: boolean };
  right?: { tab?: GraphRightTab; collapsed?: boolean };
  flow?: TransactionFlowState;
  mobile?: GraphMobilePanel;
}

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
