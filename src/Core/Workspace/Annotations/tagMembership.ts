import { canonicalAddress } from '../entityReferences';
import type { Workspace } from '../workspace';
import type { WorkspaceTag } from './annotations';

export interface TagSubject {
  id: string;
  kind: 'transaction' | 'output' | 'address';
  address?: string;
}

/** Address membership extends to its outputs, never implicitly to transactions. */
export function listTagsForNode(
  workspace: { annotations: Pick<Workspace['annotations'], 'tags'> },
  node: TagSubject,
): WorkspaceTag[] {
  const address = node.address ? `addr:${canonicalAddress(node.address)}` : undefined;
  return (workspace.annotations.tags ?? []).filter((tag) =>
    tag.nodeIds.some(
      (id) =>
        id === node.id || (node.kind !== 'transaction' && address !== undefined && id === address),
    ),
  );
}
