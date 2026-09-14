import { useEffect, useState } from 'react';
import type { Workspace } from '../../Domain/types';
import { loadTemplateWorkspace } from '../Examples/templateWorkspace';

/** A public example loaded for the tour, with the state its status strip shows. */
export interface WalletTourExample {
  snapshot: Workspace | undefined;
  loading: boolean;
  error: string;
  retry: () => void;
}

/** A tour-owned snapshot, loaded only while its topics are visible and never stored. */
export function useWalletTourExample(
  workspaceId: string | undefined,
  enabled: boolean,
): WalletTourExample {
  const [result, setResult] = useState<{
    owner: string;
    workspace?: Workspace;
    error?: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Loads a snapshot over the network and reports the outcome when it arrives.
    setResult(undefined);
    if (!workspaceId || !enabled) return;
    const controller = new AbortController();
    void loadTemplateWorkspace(
      'mainnet-public-wallet',
      'Public wallet tour example',
      'A temporary public example for this tour, using real mainnet data.',
      controller.signal,
    ).then(
      (workspace) => {
        if (!controller.signal.aborted) setResult({ owner: workspaceId, workspace });
      },
      () => {
        if (!controller.signal.aborted)
          setResult({
            owner: workspaceId,
            error: 'Couldn’t load the public example. Try again, or just continue with Next.',
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
