import { useState, type Dispatch, type SetStateAction } from 'react';
import { valueFilterError } from '../../../../../Domain/Graph/graphFilters';
import type { GraphFilters, Workspace } from '../../../../../Domain/types';
import { entityPanelFiltersFromGraph } from './entityPanelFilters';

const EMPTY_GRAPH_FILTERS: GraphFilters = {};

/**
 * The canvas filters and the entity browser's own filters, which follow the
 * canvas until the reader unlinks them.
 */
export interface WorkspaceFilters {
  graph: GraphFilters;
  setGraph: Dispatch<SetStateAction<GraphFilters>>;
  entityPanel: GraphFilters;
  setEntityPanel: Dispatch<SetStateAction<GraphFilters>>;
  /** Whether the entity browser mirrors the canvas filters. */
  entityLinked: boolean;
  setEntityLinked: Dispatch<SetStateAction<boolean>>;
  /**
   * Filters safe to persist. An in-progress value error keeps the saved filters
   * rather than writing a state the workspace cannot reload.
   */
  persistable: (saved: GraphFilters | undefined) => GraphFilters;
  /** Restores both filter sets from a workspace view, relinking the entity browser. */
  hydrate: (saved: Workspace['view']['filters']) => void;
}

export function useWorkspaceFilters(): WorkspaceFilters {
  const [graph, setGraph] = useState<GraphFilters>({});
  const [entityPanel, setEntityPanel] = useState<GraphFilters>({});
  const [entityLinked, setEntityLinked] = useState(true);
  return {
    graph,
    setGraph,
    entityPanel,
    setEntityPanel,
    entityLinked,
    setEntityLinked,
    persistable: (saved) => (valueFilterError(graph) ? (saved ?? EMPTY_GRAPH_FILTERS) : graph),
    hydrate: (saved) => {
      const filters = saved ?? {};
      setGraph(filters);
      setEntityPanel(entityPanelFiltersFromGraph(filters));
      setEntityLinked(true);
    },
  };
}
