import { TAG_COLORS } from '../../Controls/Metadata/tagColors';
import {
  canonicalAddress,
  canonicalEntityReference,
} from '../../../Core/Workspace/entityReferences';
import type { Workspace } from '../../../Core/Workspace/workspace';
import {
  type WorkspaceTag,
  assertTagBudget,
} from '../../../Core/Workspace/Annotations/annotations';
import type { GraphData } from '../GraphState/types';

/** Build once per workspace/graph update, then use constant-time node lookups. */
export function buildTagIndex(
  workspace: { annotations: Pick<Workspace['annotations'], 'tags'> },
  graph: GraphData,
): Map<string, WorkspaceTag[]> {
  const loaded = new Set<string>();
  const addressNodes = new Map<string, string[]>();
  for (const node of graph.nodes) {
    loaded.add(node.id);
    if (node.kind === 'transaction' || node.address === undefined) continue;
    const addressId = `addr:${canonicalAddress(node.address)}`;
    const nodes = addressNodes.get(addressId);
    if (nodes) nodes.push(node.id);
    else addressNodes.set(addressId, [node.id]);
  }
  const result = new Map<string, WorkspaceTag[]>();
  const add = (id: string, tag: WorkspaceTag) => {
    const tags = result.get(id);
    if (!tags) result.set(id, [tag]);
    else if (tags[tags.length - 1] !== tag) tags.push(tag);
  };
  for (const tag of workspace.annotations.tags ?? []) {
    for (const id of tag.nodeIds) {
      if (loaded.has(id)) add(id, tag);
      for (const nodeId of addressNodes.get(id) ?? []) add(nodeId, tag);
    }
  }
  return result;
}

/** Resolve only loaded graph nodes; stored off-graph members remain in the tag. */
export function tagNodeIds(tag: WorkspaceTag, graph: GraphData): string[] {
  const members = new Set(tag.nodeIds);
  return graph.nodes
    .filter(
      (node) =>
        members.has(node.id) ||
        (node.kind !== 'transaction' &&
          node.address !== undefined &&
          members.has(`addr:${canonicalAddress(node.address)}`)),
    )
    .map((node) => node.id);
}

/** Proposals only. Calling this never edits annotations or existing tags.
 * Labels longer than the tag name limit and unsupported references are omitted.
 * Existing tag names are left alone so repeated imports do not alter membership.
 */
export function tagsFromLabels(workspace: Workspace): WorkspaceTag[] {
  const existing = new Set((workspace.annotations.tags ?? []).map((tag) => tag.name.toLowerCase()));
  const grouped = new Map<string, { name: string; nodeIds: Set<string> }>();
  for (const [id, annotation] of Object.entries(workspace.annotations.entities)) {
    const name = annotation.label.trim();
    const key = name.toLowerCase();
    if (!name || name.length > 100 || existing.has(key)) continue;
    let canonical: string;
    try {
      canonical = canonicalEntityReference(id, workspace.network);
    } catch {
      continue;
    }
    const group = grouped.get(key) ?? { name, nodeIds: new Set<string>() };
    group.nodeIds.add(canonical);
    grouped.set(key, group);
  }
  const proposals = [...grouped.values()].map((group, index) => ({
    id: crypto.randomUUID(),
    name: group.name,
    color: TAG_COLORS[index % TAG_COLORS.length],
    nodeIds: [...group.nodeIds],
  }));
  assertTagBudget([...(workspace.annotations.tags ?? []), ...proposals]);
  return proposals;
}
