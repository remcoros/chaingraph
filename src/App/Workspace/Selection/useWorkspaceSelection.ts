import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { addGraphNodes } from '../../../Domain/Graph/graphMembership';
import type { GraphFilters } from '../../../Domain/types';
import type { AppState } from '../../useAppState';
import { useEntitySelection, type EntitySelection } from './useEntitySelection';

export interface SelectOptions {
  preserveCamera?: boolean;
  /** False for programmatic selection, which never feeds a picking mode. */
  pickTarget?: boolean;
}

/** Where a selection can be steered from, and what is selected right now. */
export interface WorkspaceSelection {
  /** Multi-entity batch selection and its mode. */
  batch: EntitySelection;
  selectedId: string | undefined;
  setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  selectedWallet: string | undefined;
  setSelectedWallet: Dispatch<SetStateAction<string | undefined>>;
  /** Selects one entity, admitting it to the graph. Honours an installed picking mode. */
  select: (id: string, options?: SelectOptions) => void;
  /** Invalidates in-flight work that selected evidence, so late results are dropped. */
  invalidate: () => void;
  generation: React.RefObject<number>;
  /** Suppresses camera follow for this selection until a normal select or Center. */
  preserveCamera: (id: string | undefined) => void;
  cameraPreserved: React.RefObject<string | undefined>;
  /** Back and forward history of visited entities. */
  navigation: { ids: string[]; index: number };
  setNavigation: Dispatch<SetStateAction<{ ids: string[]; index: number }>>;
  /** Drops selections and history entries whose entity no longer exists. */
  prune: (available: ReadonlySet<string> | ReadonlyMap<string, unknown>) => void;
  /**
   * Installs a mode that consumes selections instead of selecting, such as
   * picking connection-scan targets. Pass undefined to restore normal selection.
   */
  setPickHandler: (handler: ((id: string) => void) | undefined) => void;
}

/**
 * What one prune pass leaves selected.
 *
 * A selection is made together with the edit that admits its entity, but the
 * graph projection is deferred, so the first pass after a selection can run
 * against a graph that does not list it yet. `held` carries that selection
 * through exactly one such pass. A second pass without it means the entity is
 * genuinely gone, not merely not projected yet.
 */
export function prunedSelection(
  selectedId: string | undefined,
  available: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  held: string | undefined,
): string | undefined {
  if (!selectedId || available.has(selectedId)) return selectedId;
  return held === selectedId ? selectedId : undefined;
}

interface Inputs {
  workspaceId: string | undefined;
  currentRef: AppState['activeWorkspaceRef'];
  sessions: AppState['workspaces'];
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  /** Shows a newly selected entity, supplied by the workbench that displays it. */
  revealSelected: () => void;
}

export function useWorkspaceSelection({
  workspaceId,
  currentRef,
  sessions,
  setGraphFilters,
  revealSelected,
}: Inputs): WorkspaceSelection {
  const batch = useEntitySelection(workspaceId);
  const [selectedId, setSelectedId] = useState<string>();
  const [selectedWallet, setSelectedWallet] = useState<string>();
  const [navigation, setNavigation] = useState<{ ids: string[]; index: number }>({
    ids: [],
    index: -1,
  });
  const generation = useRef(0);
  // Toolbar expansion can change selection without engaging Lock to selection.
  // A normal selection, explicit Center, or Lock toggle resumes camera following.
  const cameraPreserved = useRef<string | undefined>(undefined);
  const pending = useRef<string | undefined>(undefined);
  const pickHandler = useRef<((id: string) => void) | undefined>(undefined);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const preserveCamera = useCallback((id: string | undefined) => {
    cameraPreserved.current = id;
  }, []);
  const setPickHandler = useCallback((handler: ((id: string) => void) | undefined) => {
    pickHandler.current = handler;
  }, []);
  const { getUnlocked } = sessions;
  const select = useCallback(
    (id: string, options?: SelectOptions) => {
      if (pickHandler.current && options?.pickTarget !== false) {
        pickHandler.current(id);
        return;
      }
      // This admits the node, so the projection has not caught up with it yet.
      // Hold it against one prune pass until the graph reports it, which the
      // deferred projection can only do a render later.
      pending.current = id;
      generation.current++;
      cameraPreserved.current = options?.preserveCamera ? id : undefined;
      // A click admits exactly one entity, never its transaction's other branches.
      getUnlocked(currentRef.current?.id ?? '')?.edit(
        (workspace) => addGraphNodes(workspace, [id]),
        false,
      );
      setSelectedId(id);
      setGraphFilters((filters) =>
        filters.focus ? { ...filters, focus: { ...filters.focus, id } } : filters,
      );
      setNavigation((current) =>
        current.ids[current.index] === id
          ? current
          : {
              ids: [...current.ids.slice(0, current.index + 1), id].slice(-100),
              index: Math.min(99, current.index + 1),
            },
      );
      revealSelected();
    },
    [getUnlocked, currentRef, setGraphFilters, revealSelected],
  );
  const batchIds = batch.ids;
  const removeBatchIds = batch.remove;
  const prune = useCallback(
    (available: ReadonlySet<string> | ReadonlyMap<string, unknown>) => {
      setNavigation((current) => {
        const ids = current.ids.filter((id) => available.has(id));
        if (ids.length === current.ids.length) return current;
        const index =
          current.ids.slice(0, current.index + 1).filter((id) => available.has(id)).length - 1;
        return { ids, index };
      });
      // Only entities that no longer exist leave the batch selection. Filtering or
      // hiding an entity keeps it selected, with its scope reported in the toolbar.
      const removed = batchIds.filter((id) => !available.has(id));
      if (removed.length) removeBatchIds(removed);
      // Read and spend the hold here rather than inside the updater, which React
      // may run more than once.
      const held = pending.current;
      pending.current = undefined;
      setSelectedId((current) => prunedSelection(current, available, held));
    },
    [batchIds, removeBatchIds],
  );
  return {
    batch,
    selectedId,
    setSelectedId,
    selectedWallet,
    setSelectedWallet,
    select,
    invalidate,
    generation,
    preserveCamera,
    cameraPreserved,
    navigation,
    setNavigation,
    prune,
    setPickHandler,
  };
}
