import { z } from 'zod';
import { canonicalEntityReference } from '../entityReferences';
import type { Network } from '../../Bitcoin/index';
const text = z.string().max(10000);
export interface Annotation {
  label: string;
  note: string;
  icon: string;
  bookmarked: boolean;
}

/** A manual grouping, independent of labels and heuristic findings. */
export interface WorkspaceTag {
  id: string;
  name: string;
  color: string;
  description?: string;
  nodeIds: string[];
}

export const MAX_WORKSPACE_TAGS = 200;
export const MAX_TAG_MEMBERS = 50_000;
const tagSchema = z.object({
  id: z
    .string()
    .uuid()
    .transform((id) => id.toLowerCase()),
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  description: z.string().max(2000).optional(),
  nodeIds: z.array(z.string().max(200)).max(MAX_TAG_MEMBERS),
});
export const workspaceTagsSchema = z.array(tagSchema).max(MAX_WORKSPACE_TAGS);

/** Count the supplied records before allocating or normalizing their contents. */
export function assertTagBudget(tags: unknown): void {
  if (!Array.isArray(tags)) return;
  if (tags.length > MAX_WORKSPACE_TAGS) throw new Error('Workspace supports at most 200 tags.');
  let members = 0;
  for (const tag of tags) {
    if (tag && typeof tag === 'object' && Array.isArray(tag.nodeIds)) members += tag.nodeIds.length;
    if (members > MAX_TAG_MEMBERS)
      throw new Error('Workspace exceeds the 50,000 tag membership limit.');
  }
}

export function parseWorkspaceTags(tags: unknown, network: Network): WorkspaceTag[] {
  assertTagBudget(tags);
  const parsed = workspaceTagsSchema.parse(tags);
  const ids = new Set<string>();
  const names = new Set<string>();
  return parsed.map((tag) => {
    if (ids.has(tag.id)) throw new Error('Workspace contains duplicate tag IDs.');
    const nameKey = tag.name.toLowerCase();
    if (names.has(nameKey)) throw new Error('Workspace contains duplicate tag names.');
    ids.add(tag.id);
    names.add(nameKey);
    return {
      ...tag,
      nodeIds: [...new Set(tag.nodeIds.map((id) => canonicalEntityReference(id, network)))],
    };
  });
}

export const annotationsSchema = z.object({
  entities: z.record(
    z.string().max(200),
    z.object({
      label: z.string().max(200),
      note: text,
      icon: z.string().max(20),
      bookmarked: z.boolean(),
    }),
  ),
  tags: workspaceTagsSchema.optional(),
});
