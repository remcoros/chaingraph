import { useCallback, useMemo, useRef } from 'react';
import type { WorkspaceCore } from './workspaceCore';

/** One user-visible, cancellable workspace operation at a time. */
export interface WorkspaceOperation {
  run: (task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
  /** Cancel the active operation, or only the operation owning the supplied signal. */
  cancel: (expectedSignal?: AbortSignal) => void;
  isActive: () => boolean;
}

export function useWorkspaceOperation(core: WorkspaceCore): WorkspaceOperation {
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const { activeWorkspaceRef, setError, setNotice, setOperation } = core;
  const cancel = useCallback((expectedSignal?: AbortSignal) => {
    const controller = controllerRef.current;
    if (controller && (!expectedSignal || controller.signal === expectedSignal)) controller.abort();
  }, []);
  const run = useCallback(
    async (task: (signal: AbortSignal) => Promise<void>) => {
      if (controllerRef.current) return;
      const controller = new AbortController();
      const workspaceId = activeWorkspaceRef.current?.id;
      controllerRef.current = controller;
      setOperation('Working…');
      setError('');
      setNotice('');
      try {
        await task(controller.signal);
      } catch (cause) {
        if (
          activeWorkspaceRef.current?.id === workspaceId &&
          controllerRef.current === controller
        ) {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : 'Operation failed.');
          else setNotice('Operation cancelled. Completed data from earlier actions is preserved.');
        }
      }
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setOperation('');
      }
    },
    [activeWorkspaceRef, setError, setNotice, setOperation],
  );
  const isActive = useCallback(() => controllerRef.current !== undefined, []);
  return useMemo(() => ({ run, cancel, isActive }), [run, cancel, isActive]);
}
