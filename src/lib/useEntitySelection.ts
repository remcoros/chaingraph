import { useCallback, useMemo, useRef, useState } from 'react';

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

/** Shared UI selection for the flow, canvas and entity lists.
 * It holds explicit identifiers only. It never grows from filter or query
 * results, and it is cleared when the active workspace changes so one
 * workspace's batch can never reach another's entities.
 */
export function useEntitySelection(workspaceId: string | undefined): EntitySelection {
  const [mode, setMode] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const owner = useRef(workspaceId);
  if (owner.current !== workspaceId) {
    owner.current = workspaceId;
    if (ids.length) setIds([]);
    if (mode) setMode(false);
  }
  const selected = useMemo(() => new Set(ids), [ids]);
  const toggle = useCallback(
    (id: string) =>
      setIds((current) =>
        current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
      ),
    [],
  );
  const replace = useCallback((next: readonly string[]) => setIds([...new Set(next)]), []);
  const remove = useCallback(
    (next: readonly string[]) =>
      setIds((current) => {
        const dropped = new Set(next);
        const kept = current.filter((id) => !dropped.has(id));
        return kept.length === current.length ? current : kept;
      }),
    [],
  );
  const clear = useCallback(() => setIds([]), []);
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
