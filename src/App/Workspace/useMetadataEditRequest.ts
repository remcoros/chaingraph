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

export function useMetadataEditRequest(): MetadataEditRequest {
  const [token, setToken] = useState(0);
  const [target, setTarget] = useState<MetadataEditTarget>('label');
  return {
    token,
    target,
    request: (next) => {
      setTarget(next);
      setToken((current) => current + 1);
    },
    acknowledge: () => setToken(0),
  };
}
