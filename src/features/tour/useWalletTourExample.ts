import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '../../domain/types';
import { loadTemplateWorkspace } from '../../lib/templateWorkspace';

/** A tour-owned snapshot, never handed to workspace storage or navigation. */
export function useWalletTourExample(workspaceId: string | undefined, stepId: string | undefined) {
  const [example, setExample] = useState<{ owner: string; workspace: Workspace }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | undefined>(undefined);
  const open = stepId !== undefined;
  useEffect(() => {
    setExample(undefined);
  }, [workspaceId, open]);
  // Leaving a topic, closing the tour or switching workspaces cancels a pending choice.
  useEffect(() => {
    setLoading(false);
    setError('');
    return () => {
      pending.current?.abort();
      pending.current = undefined;
    };
  }, [workspaceId, stepId]);

  const snapshot = open && example?.owner === workspaceId ? example?.workspace : undefined;
  async function preview(onReady: () => void) {
    if (!workspaceId || !open || pending.current) return;
    if (snapshot) {
      onReady();
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError('');
    try {
      const workspace = await loadTemplateWorkspace(
        'mainnet-public-wallet',
        'Public wallet tour example',
        'Temporary public mainnet snapshot for the guided tour.',
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setExample({ owner: workspaceId, workspace });
      onReady();
    } catch {
      if (!controller.signal.aborted)
        setError('The public example could not load. Try again or continue the tour.');
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setLoading(false);
      }
    }
  }
  return { snapshot, loading, error, preview };
}
