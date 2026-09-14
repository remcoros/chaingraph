import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { addGraphNodes } from '../../../Domain/Graph/graphMembership';
import type { GraphFilters, Workspace } from '../../../Domain/types';
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
  /** Keeps a selection that is still loading, so pruning does not drop it. */
  markPending: (id: string | undefined) => void;
  /** Drops selections and history entries whose entity no longer exists. */
  prune: (available: ReadonlySet<string> | ReadonlyMap<string, unknown>) => void;
  /**
   * Installs a mode that consumes selections instead of selecting, such as
   * picking connection-scan targets. Pass undefined to restore normal selection.
   */
  setPickHandler: (handler: ((id: string) => void) | undefined) => void;
}

interface Inputs {
  workspaceId: string | undefined;
  currentRef: AppState['activeWorkspaceRef'];
  sessions: AppState['workspaces'];
  setGraphFilters: Dispatch<SetStateAction<GraphFilters>>;
  setRightTab: Dispatch<SetStateAction<NonNullable<Workspace['view']['rightTab']>>>;
}

export function useWorkspaceSelection({
  workspaceId,
  currentRef,
  sessions,
  setGraphFilters,
  setRightTab,
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
  const markPending = useCallback((id: string | undefined) => {
    pending.current = id;
  }, []);
  const { getUnlocked, update } = sessions;
  const select = useCallback(
    (id: string, options?: SelectOptions) => {
      if (pickHandler.current && options?.pickTarget !== false) {
        pickHandler.current(id);
        return;
      }
      if (pending.current && pending.current !== id) pending.current = undefined;
      generation.current++;
      cameraPreserved.current = options?.preserveCamera ? id : undefined;
      const active = getUnlocked(currentRef.current?.id ?? '')?.data;
      // A click admits exactly one entity, never its transaction's other branches.
      if (active) update(active.id, (workspace) => addGraphNodes(workspace, [id]), false);
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
      setRightTab((current) => (current === 'scan' ? 'scan' : 'inspect'));
    },
    [getUnlocked, update, currentRef, setGraphFilters, setRightTab],
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
      setSelectedId((current) => {
        if (current && !available.has(current)) {
          if (pending.current !== current) return undefined;
        } else if (pending.current === current) {
          pending.current = undefined;
        }
        return current;
      });
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
    markPending,
    prune,
    setPickHandler,
  };
}
