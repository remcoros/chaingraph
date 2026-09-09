import { canonicalTagNodeId, MAX_TAG_MEMBERS, MAX_WORKSPACE_TAGS } from './tags';
import type { Annotation, Workspace, WorkspaceTag } from './types';

const EMPTY: Annotation = { label: '', note: '', icon: '', bookmarked: false };

export interface BatchScope {
  /** Explicitly selected records. Filters never widen this set. */
  ids: string[];
  /** Records the edit would actually change. */
  targets: string[];
  /** Selected records left untouched because they already carry the field. */
  preserved: number;
}

function canonical(workspace: Workspace, ids: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    try {
      unique.add(canonicalTagNodeId(id, workspace.network));
    } catch {
      // A reference that is not a transaction, output or valid address for this
      // network cannot be an edit target.
    }
  }
  return [...unique];
}

/** Default behaviour preserves existing labels; replacement must be explicit. */
export function planBatchLabel(
  workspace: Workspace,
  ids: readonly string[],
  replaceExisting = false,
): BatchScope {
  const all = canonical(workspace, ids);
  const targets = all.filter((id) => replaceExisting || !workspace.annotations[id]?.label?.trim());
  return { ids: all, targets, preserved: all.length - targets.length };
}

export function planBatchIcon(
  workspace: Workspace,
  ids: readonly string[],
  replaceExisting = false,
): BatchScope {
  const all = canonical(workspace, ids);
  const targets = all.filter((id) => replaceExisting || !workspace.annotations[id]?.icon);
  return { ids: all, targets, preserved: all.length - targets.length };
}

export function planBatchTag(
  workspace: Workspace,
  ids: readonly string[],
  tagId: string,
  add: boolean,
): BatchScope {
  const all = canonical(workspace, ids);
  const members = new Set((workspace.tags ?? []).find((tag) => tag.id === tagId)?.nodeIds ?? []);
  const targets = all.filter((id) => members.has(id) !== add);
  return { ids: all, targets, preserved: all.length - targets.length };
}

/** One workspace result per batch, so autosave and Undo see a single step. */
export function applyBatchLabel(
  workspace: Workspace,
  ids: readonly string[],
  label: string,
  replaceExisting = false,
): Workspace {
  const value = label.slice(0, 200);
  const { targets } = planBatchLabel(workspace, ids, replaceExisting);
  const changed = targets.filter((id) => (workspace.annotations[id]?.label ?? '') !== value);
  if (!changed.length) return workspace;
  const annotations = { ...workspace.annotations };
  for (const id of changed) annotations[id] = { ...(annotations[id] ?? EMPTY), label: value };
  return { ...workspace, annotations };
}

export function applyBatchIcon(
  workspace: Workspace,
  ids: readonly string[],
  icon: string,
  replaceExisting = false,
): Workspace {
  const value = icon.slice(0, 20);
  const { targets } = planBatchIcon(workspace, ids, replaceExisting);
  const changed = targets.filter((id) => (workspace.annotations[id]?.icon ?? '') !== value);
  if (!changed.length) return workspace;
  const annotations = { ...workspace.annotations };
  for (const id of changed) annotations[id] = { ...(annotations[id] ?? EMPTY), icon: value };
  return { ...workspace, annotations };
}

export function applyBatchTag(
  workspace: Workspace,
  ids: readonly string[],
  tagId: string,
  add: boolean,
): Workspace {
  const tag = (workspace.tags ?? []).find((item) => item.id === tagId);
  if (!tag) throw new Error('This tag no longer exists in the workspace.');
  const { targets } = planBatchTag(workspace, ids, tagId, add);
  if (!targets.length) return workspace;
  const total = (workspace.tags ?? []).reduce((count, item) => count + item.nodeIds.length, 0);
  if (add && total + targets.length > MAX_TAG_MEMBERS)
    throw new Error('Workspace has reached the 50,000 tag membership limit.');
  const members = add
    ? [...new Set([...tag.nodeIds, ...targets])]
    : tag.nodeIds.filter((id) => !targets.includes(id));
  return {
    ...workspace,
    tags: (workspace.tags ?? []).map((item) =>
      item.id === tagId ? { ...item, nodeIds: members } : item,
    ),
  };
}

/** Create a tag and assign the selected records in the same update. */
export function createBatchTag(
  workspace: Workspace,
  value: { name: string; color: string; description?: string },
  ids: readonly string[],
): Workspace {
  const name = value.name.trim().slice(0, 100);
  if (!name) throw new Error('Give the tag a name.');
  const tags = workspace.tags ?? [];
  const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  if (existing) return applyBatchTag(workspace, ids, existing.id, true);
  if (tags.length >= MAX_WORKSPACE_TAGS) throw new Error('Workspace supports at most 200 tags.');
  const members = canonical(workspace, ids);
  const total = tags.reduce((count, item) => count + item.nodeIds.length, 0);
  if (total + members.length > MAX_TAG_MEMBERS)
    throw new Error('Workspace has reached the 50,000 tag membership limit.');
  const tag: WorkspaceTag = {
    id: crypto.randomUUID(),
    name,
    color: value.color,
    nodeIds: members,
    ...(value.description?.trim() ? { description: value.description.trim() } : {}),
  };
  return { ...workspace, tags: [...tags, tag] };
}
