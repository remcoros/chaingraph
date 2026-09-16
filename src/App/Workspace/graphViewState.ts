import type { Workspace } from '../../Domain/Workspace/workspaceTypes';

export type GraphFilters = NonNullable<Workspace['view']['filters']>;

type StoredGraphPanelsState = NonNullable<Workspace['view']['panels']>;
type StoredLeftPanel = NonNullable<StoredGraphPanelsState['left']>;
type StoredRightPanel = NonNullable<StoredGraphPanelsState['right']>;

export type GraphLeftTab = NonNullable<StoredLeftPanel['tab']>;
export type GraphRightTab = NonNullable<StoredRightPanel['tab']>;
export type GraphMobilePanel = NonNullable<StoredGraphPanelsState['mobile']>;
export type TransactionFlowState = NonNullable<StoredGraphPanelsState['flow']>;
export type FlowPanelHeight = NonNullable<TransactionFlowState['height']>;
export type GraphPanelsState = StoredGraphPanelsState;

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
