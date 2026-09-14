import type { GraphNavigationOptions } from '../../../Domain/Graph/graphHandoff';
import type { GraphData, GraphFilters, Transaction, Workspace } from '../../../Domain/types';

/**
 * Graph capabilities that Wallet and Analysis use to hand a selection over.
 *
 * Graph satisfies this contract; the other workbenches depend on the contract
 * rather than on Graph's hooks, so a handoff stays a declared exchange instead
 * of a reach into another workbench's implementation.
 */
export interface GraphHandoff {
  /** Admits and centres the given nodes. False when they are not resolvable. */
  showOnGraph: (ids: readonly string[], options?: GraphNavigationOptions) => boolean;
  /** Admits nodes to the canvas without moving the camera. */
  revealGraphNodes: (ids: string[]) => void;
  updateFilters: (filters: GraphFilters) => void;
  /** Loads the transactions behind a handoff selection that are not cached yet. */
  loadGraphTransactions: (ids: readonly string[], signal: AbortSignal) => Promise<Transaction[]>;
  /** Loaded graph as currently projected. */
  graph: GraphData;
  /** Loaded graph including hidden nodes, used to resolve handoff targets. */
  recoveryGraph: GraphData;
  /** Opens the graph's inspector on what was just handed over. */
  showRecordTab: (tab: NonNullable<Workspace['view']['rightTab']>) => void;
  /** Opens the entity browser, where handed-over activity is listed. */
  revealEntities: () => void;
  /** Chooses which panel a narrow viewport shows after the handoff. */
  showPanel: (panel: 'graph' | 'left' | 'right') => void;
}
