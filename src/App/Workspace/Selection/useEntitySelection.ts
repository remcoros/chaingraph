import { useCallback, useMemo, useState } from 'react';

export interface EntitySelection {
  /** Explicit multiple-selection mode; single click still inspects when off. */
  mode: boolean;
  setMode: (mode: boolean) => void;
  ids: string[];
  count: number;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Replace the selection with an explicit, already scoped list of identifiers. */
  replace: (ids: readonly string[]) => void;
  remove: (ids: readonly string[]) => void;
  clear: () => void;
}

interface SelectionState {
  workspaceId: string | undefined;
  mode: boolean;
  ids: string[];
}

function emptySelection(workspaceId: string | undefined): SelectionState {
  return { workspaceId, mode: false, ids: [] };
}

function currentSelection(state: SelectionState, workspaceId: string | undefined): SelectionState {
  return state.workspaceId === workspaceId ? state : emptySelection(workspaceId);
}

/** Shared UI selection for the flow, canvas and entity lists.
 * It holds explicit identifiers only. It never grows from filter or query
 * results, and it is cleared when the active workspace changes so one
 * workspace's batch can never reach another's entities.
 */
export function useEntitySelection(workspaceId: string | undefined): EntitySelection {
  const [state, setState] = useState<SelectionState>(() => emptySelection(workspaceId));
  // Adjusting during render rather than in an effect: a different workspace owns
  // a different selection, so it starts empty in the same pass.
  if (state.workspaceId !== workspaceId) setState(emptySelection(workspaceId));
  const current = currentSelection(state, workspaceId);
  const { mode, ids } = current;
  const selected = useMemo(() => new Set(ids), [ids]);
  const setMode = useCallback(
    (mode: boolean) =>
      setState((value) => ({
        ...currentSelection(value, workspaceId),
        mode,
      })),
    [workspaceId],
  );
  const toggle = useCallback(
    (id: string) =>
      setState((value) => {
        const base = currentSelection(value, workspaceId);
        return {
          ...base,
          ids: base.ids.includes(id) ? base.ids.filter((entry) => entry !== id) : [...base.ids, id],
        };
      }),
    [workspaceId],
  );
  const replace = useCallback(
    (next: readonly string[]) =>
      setState((value) => ({
        ...currentSelection(value, workspaceId),
        ids: [...new Set(next)],
      })),
    [workspaceId],
  );
  const remove = useCallback(
    (next: readonly string[]) =>
      setState((value) => {
        const base = currentSelection(value, workspaceId);
        const dropped = new Set(next);
        const kept = base.ids.filter((id) => !dropped.has(id));
        return kept.length === base.ids.length ? base : { ...base, ids: kept };
      }),
    [workspaceId],
  );
  const clear = useCallback(
    () =>
      setState((value) =>
        currentSelection(value, workspaceId).ids.length
          ? { ...currentSelection(value, workspaceId), ids: [] }
          : currentSelection(value, workspaceId),
      ),
    [workspaceId],
  );
  return {
    mode,
    setMode,
    ids,
    count: ids.length,
    has: useCallback((id: string) => selected.has(id), [selected]),
    toggle,
    replace,
    remove,
    clear,
  };
}
