import { useState } from 'react';

export type MetadataEditTarget = 'label' | 'tags' | 'icon';

/**
 * A request to open one metadata editor on the selected entity.
 *
 * The token is what opens the editor, so asking twice for the same target still
 * reopens it. Editors acknowledge the request once they have handled it.
 */
export interface MetadataEditRequest {
  /** Non-zero while an editor has been asked to open. */
  token: number;
  target: MetadataEditTarget;
  request: (target: MetadataEditTarget) => void;
  acknowledge: () => void;
}

export function useMetadataEditRequest(workspaceId: string | undefined): MetadataEditRequest {
  // Scoped to its workspace, so switching or locking one drops a pending request.
  const [request, setRequest] = useState<{ workspaceId: string; token: number }>();
  const [target, setTarget] = useState<MetadataEditTarget>('label');
  const token = workspaceId && request?.workspaceId === workspaceId ? request.token : 0;
  return {
    token,
    target,
    request: (next) => {
      if (!workspaceId) return;
      setTarget(next);
      setRequest((current) => ({ workspaceId, token: (current?.token ?? 0) + 1 }));
    },
    acknowledge: () => setRequest(undefined),
  };
}
