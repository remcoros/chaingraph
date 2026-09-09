import { useEffect, useState } from 'react';
import type { Workspace } from '../../domain/types';
import { loadTemplateWorkspace } from '../../lib/templateWorkspace';

/** A tour-owned snapshot, loaded only while its topics are visible and never stored. */
export function useWalletTourExample(workspaceId: string | undefined, enabled: boolean) {
  const [result, setResult] = useState<{
    owner: string;
    workspace?: Workspace;
    error?: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setResult(undefined);
    if (!workspaceId || !enabled) return;
    const controller = new AbortController();
    void loadTemplateWorkspace(
      'mainnet-public-wallet',
      'Public wallet tour example',
      'Temporary public mainnet snapshot for the guided tour.',
      controller.signal,
    ).then(
      (workspace) => {
        if (!controller.signal.aborted) setResult({ owner: workspaceId, workspace });
      },
      () => {
        if (!controller.signal.aborted)
          setResult({
            owner: workspaceId,
            error: 'The public example could not load. Try again or continue with Next.',
          });
      },
    );
    // Consecutive Wallet topics share the snapshot. Leaving them unloads it and
    // cancels pending work, including when closing or switching workspaces.
    return () => controller.abort();
  }, [workspaceId, enabled, attempt]);

  const current = enabled && result?.owner === workspaceId ? result : undefined;
  return {
    snapshot: current?.workspace,
    loading: enabled && !current,
    error: current?.error ?? '',
    retry: () => setAttempt((value) => value + 1),
  };
}
