import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Workspace } from '../../../../Domain/types';

export type GraphLeftTab = 'wallets' | 'entities' | 'bookmarks' | 'tags';
export type GraphRightTab = NonNullable<Workspace['view']['rightTab']>;
export type GraphMobilePanel = 'graph' | 'left' | 'right';

/** A tour step's view of the graph, which previews panels without changing them. */
export interface GraphPanelPreview {
  panel?: GraphMobilePanel;
  leftTab?: GraphLeftTab;
  rightTab?: 'inspect' | 'analysis';
}

/**
 * Which panels the graph workbench shows.
 *
 * Each tab has a chosen value, which is what the workspace saves, and a shown
 * value, which is what the reader sees now. They differ while a tour previews a
 * step, and when a wallet-record tab outlives the wallet it belonged to.
 */
export interface GraphPanelChoice {
  leftTab: GraphLeftTab;
  rightTab: GraphRightTab;
  mobilePanel: GraphMobilePanel;
  focusGraph: boolean;
}

export interface GraphPanels extends GraphPanelChoice {
  /** The reader's own choices, saved with the workspace. */
  chosen: GraphPanelChoice;
  setLeftTab: Dispatch<SetStateAction<GraphLeftTab>>;
  setRightTab: Dispatch<SetStateAction<GraphRightTab>>;
  setMobilePanel: Dispatch<SetStateAction<GraphMobilePanel>>;
  setFocusGraph: Dispatch<SetStateAction<boolean>>;
  /** Shows a newly selected entity, without interrupting a scan in progress. */
  revealInspector: () => void;
  revealEntities: () => void;
  showPanel: (panel: GraphMobilePanel) => void;
  hydrate: (view: Workspace['view'] | undefined) => void;
}

export interface GraphPanelView {
  /** The step being previewed, when a tour is running. */
  preview: GraphPanelPreview | undefined;
  previewing: boolean;
  /** False once the wallet behind a record tab is gone, so that tab cannot stay. */
  hasSelectedWallet: boolean;
}

const WALLET_RECORD_TABS = new Set<GraphRightTab>(['addresses', 'transactions', 'utxos']);

/**
 * What the reader sees, given their choices and anything overriding them.
 *
 * Kept separate from the state so the panels can exist before a tour step does:
 * the tour depends on the selection, which in turn reveals panels.
 */
export function graphPanelsInView(
  chosen: GraphPanelChoice,
  { preview, previewing, hasSelectedWallet }: GraphPanelView,
): GraphPanelChoice {
  return {
    leftTab: preview?.leftTab ?? chosen.leftTab,
    rightTab:
      preview?.rightTab ??
      (WALLET_RECORD_TABS.has(chosen.rightTab) && !hasSelectedWallet ? 'inspect' : chosen.rightTab),
    mobilePanel: preview?.panel ?? chosen.mobilePanel,
    // A tour previews the panels, so the canvas never takes the whole workbench.
    focusGraph: previewing ? false : chosen.focusGraph,
  };
}

export function useGraphPanels(): GraphPanels {
  const [leftTab, setLeftTab] = useState<GraphLeftTab>('wallets');
  const [rightTab, setRightTab] = useState<GraphRightTab>('inspect');
  const [mobilePanel, setMobilePanel] = useState<GraphMobilePanel>('graph');
  const [focusGraph, setFocusGraph] = useState(false);
  const chosen = { leftTab, rightTab, mobilePanel, focusGraph };
  return {
    ...chosen,
    chosen,
    setLeftTab,
    setRightTab,
    setMobilePanel,
    setFocusGraph,
    revealInspector: () => setRightTab((current) => (current === 'scan' ? 'scan' : 'inspect')),
    revealEntities: () => setLeftTab('entities'),
    showPanel: setMobilePanel,
    hydrate: (view) => {
      setLeftTab(view?.leftTab ?? 'wallets');
      // A saved 'analysis' right tab predates the analysis workbench and is not
      // one of this panel's tabs; the workbench choice carries that instead.
      setRightTab(view?.rightTab === 'analysis' ? 'inspect' : (view?.rightTab ?? 'inspect'));
      setMobilePanel(view?.mobilePanel ?? 'graph');
      setFocusGraph(view?.focusGraph ?? false);
    },
  };
}
