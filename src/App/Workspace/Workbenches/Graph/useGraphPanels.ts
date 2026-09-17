import { useCallback, useMemo } from 'react';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type {
  GraphLeftTab,
  GraphMobilePanel,
  GraphPanelsState,
  GraphRightTab,
  TransactionFlowState,
} from '../../../../Core/Workspace/view';
import { openFlowPanel } from '../../GraphState/panelState';

import type { WorkspaceOperations } from '../../../../Core/Workspace/Session/WorkspaceStore';

export type {
  GraphLeftTab,
  GraphMobilePanel,
  GraphRightTab,
} from '../../../../Core/Workspace/view';

/** A tour step's view of the graph, which previews panels without changing them. */
export interface GraphPanelPreview {
  panel?: GraphMobilePanel;
  leftTab?: GraphLeftTab;
  rightTab?: 'inspect';
  flowOpen?: boolean;
}

/** Fully resolved panel state used while a workspace is open. */
export interface GraphPanelState {
  left: { tab: GraphLeftTab; collapsed: boolean };
  right: { tab: GraphRightTab; collapsed: boolean };
  flow: TransactionFlowState;
  mobile: GraphMobilePanel;
}

type GraphPanelUpdate = (current: GraphPanelState) => GraphPanelState;

export interface GraphPanels extends GraphPanelState {
  /** Saved state before temporary tour and availability overrides. */
  saved: GraphPanelState;
  setPanels: (update: GraphPanelUpdate) => void;
  setLeftTab: (tab: GraphLeftTab) => void;
  setRightTab: (tab: GraphRightTab) => void;
  setMobilePanel: (panel: GraphMobilePanel) => void;
  setFlowPanel: (state: TransactionFlowState) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  toggleSidePanels: () => void;
  /** Shows a newly selected entity, without interrupting a scan in progress. */
  revealInspector: () => void;
  revealEntities: () => void;
  showPanel: (panel: GraphMobilePanel) => void;
}

export interface GraphPanelView {
  preview: GraphPanelPreview | undefined;
  previewing: boolean;
  /** False once the wallet behind a record tab is gone, so that tab cannot stay. */
  hasSelectedWallet: boolean;
}

interface GraphPanelControllerOptions {
  workspace: Workspace | undefined;
  workspaceId: string | undefined;
  getWorkspace: (id: string) => WorkspaceOperations | undefined;
}

const WALLET_RECORD_TABS = new Set<GraphRightTab>(['addresses', 'transactions', 'utxos']);

export function resolveGraphPanelState(panels: GraphPanelsState | undefined): GraphPanelState {
  return {
    left: {
      tab: panels?.left?.tab ?? 'wallets',
      collapsed: panels?.left?.collapsed ?? false,
    },
    right: {
      tab: panels?.right?.tab ?? 'inspect',
      collapsed: panels?.right?.collapsed ?? false,
    },
    flow: panels?.flow ?? {},
    mobile: panels?.mobile ?? 'graph',
  };
}

/** Returns the saved panel state with temporary presentation overrides applied. */
export function graphPanelsInView(
  saved: GraphPanelState,
  { preview, previewing, hasSelectedWallet }: GraphPanelView,
): GraphPanelState {
  return {
    left: {
      tab: preview?.leftTab ?? saved.left.tab,
      collapsed: previewing ? false : saved.left.collapsed,
    },
    right: {
      tab:
        preview?.rightTab ??
        (WALLET_RECORD_TABS.has(saved.right.tab) && !hasSelectedWallet
          ? 'inspect'
          : saved.right.tab),
      collapsed: previewing ? false : saved.right.collapsed,
    },
    flow: preview?.flowOpen ? openFlowPanel(saved.flow) : saved.flow,
    mobile: preview?.panel ?? saved.mobile,
  };
}

export function useGraphPanels({
  workspace,
  workspaceId,
  getWorkspace,
}: GraphPanelControllerOptions): GraphPanels {
  const saved = resolveGraphPanelState(workspace?.view.panels);
  const setPanels = useCallback(
    (update: GraphPanelUpdate) => {
      if (!workspaceId) return;
      getWorkspace(workspaceId)?.edit((current) => {
        const currentPanels = resolveGraphPanelState(current.view.panels);
        const nextPanels = update(currentPanels);
        return JSON.stringify(currentPanels) === JSON.stringify(nextPanels)
          ? current
          : {
              ...current,
              view: {
                ...current.view,
                panels: { ...current.view.panels, ...nextPanels },
              },
            };
      }, false);
    },
    [getWorkspace, workspaceId],
  );
  const actions = useMemo(
    () => ({
      setPanels,
      setLeftTab: (tab: GraphLeftTab) =>
        setPanels((current) => ({ ...current, left: { ...current.left, tab } })),
      setRightTab: (tab: GraphRightTab) =>
        setPanels((current) => ({ ...current, right: { ...current.right, tab } })),
      setMobilePanel: (mobile: GraphMobilePanel) =>
        setPanels((current) => ({ ...current, mobile })),
      setFlowPanel: (flow: TransactionFlowState) => setPanels((current) => ({ ...current, flow })),
      toggleLeftPanel: () =>
        setPanels((current) => ({
          ...current,
          left: { ...current.left, collapsed: !current.left.collapsed },
        })),
      toggleRightPanel: () =>
        setPanels((current) => ({
          ...current,
          right: { ...current.right, collapsed: !current.right.collapsed },
        })),
      toggleSidePanels: () =>
        setPanels((current) => {
          const collapsed = !(current.left.collapsed && current.right.collapsed);
          return {
            ...current,
            left: { ...current.left, collapsed },
            right: { ...current.right, collapsed },
          };
        }),
      revealInspector: () =>
        setPanels((current) => ({
          ...current,
          right: {
            tab: current.right.tab === 'scan' ? 'scan' : 'inspect',
            collapsed: false,
          },
        })),
      revealEntities: () =>
        setPanels((current) => ({
          ...current,
          left: { tab: 'entities', collapsed: false },
        })),
    }),
    [setPanels],
  );

  return {
    ...saved,
    saved,
    ...actions,
    showPanel: actions.setMobilePanel,
  };
}
