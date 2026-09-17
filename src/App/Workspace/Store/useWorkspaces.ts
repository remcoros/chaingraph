import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WorkspaceStore } from '../../../Core/Workspace/Session/WorkspaceStore';

export function useWorkspaces(store: WorkspaceStore) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const ids = state.unlocked.filter((session) => session.revision !== session.savedRevision);
    if (!ids.length) return;
    const timer = setTimeout(() => {
      for (const session of ids) void store.persist(session.data.id, true).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [state.unlocked, store]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        store.getSnapshot().unlocked.some((session) => session.revision !== session.savedRevision)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [store]);
  return useMemo(
    () => ({
      ...state,
      active: state.unlocked.find((session) => session.data.id === state.activeId),
      getUnlocked: store.getUnlocked,
      getSaved: store.getSaved,
      setActiveId: store.setActiveId,
      open: store.open,
      unlock: store.unlock,
      exportEncrypted: store.exportEncrypted,
      removeSaved: store.removeSaved,
    }),
    [state, store],
  );
}
