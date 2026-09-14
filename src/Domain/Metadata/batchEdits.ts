import { canonicalEntityNodeId } from './entityReferences';
import { MAX_TAG_MEMBERS, MAX_WORKSPACE_TAGS } from './tags';
import type { Annotation, Workspace } from '../types';

/** Explicit batch edits over supplied entity identifiers.
 * Nothing here reads the canvas, infers membership or touches chain observations.
 * Every function returns the same workspace object when it changes nothing, so a
 * no-op batch never consumes an undo step.
 */
export const MAX_BATCH_TARGETS = 50_000;

const blankAnnotation: Annotation = { label: '', note: '', icon: '', bookmarked: false };

function targets(workspace: Workspace, ids: Iterable<string>): string[] {
  const result = new Set<string>();
  let supplied = 0;
  for (const id of ids) {
    if (++supplied > MAX_BATCH_TARGETS)
      throw new Error('A batch edit supports at most 50,000 entity references.');
    result.add(canonicalEntityNodeId(id, workspace.network));
  }
  return [...result];
}

export interface LabelBatchPlan {
  /** Identifiers the batch would write, after the unlabeled restriction. */
  targetIds: string[];
  /** Selected entities that already carry a non-empty label. */
  labeledCount: number;
  unlabeledCount: number;
  /** Existing labels this batch would replace. */
  replacedCount: number;
  /** Distinct existing labels among the selection, for mixed-value feedback. */
  distinctLabels: string[];
}

export function labelBatchPlan(
  workspace: Workspace,
  ids: Iterable<string>,
  options: { onlyUnlabeled?: boolean } = {},
): LabelBatchPlan {
  const all = targets(workspace, ids);
  const labeled = all.filter((id) => Boolean(workspace.annotations[id]?.label.trim()));
  const labeledIds = new Set(labeled);
  const targetIds = options.onlyUnlabeled ? all.filter((id) => !labeledIds.has(id)) : all;
  return {
    targetIds,
    labeledCount: labeled.length,
    unlabeledCount: all.length - labeled.length,
    replacedCount: targetIds.filter((id) => labeledIds.has(id)).length,
    distinctLabels: [
      ...new Set(labeled.map((id) => workspace.annotations[id]!.label.trim())),
    ].slice(0, 5),
  };
}

/** Replace only the label field. Notes, icons and bookmarks stay untouched. */
export function applyBatchLabel(
  workspace: Workspace,
  ids: Iterable<string>,
  label: string,
  options: { onlyUnlabeled?: boolean } = {},
): Workspace {
  const value = label.slice(0, 200);
  const plan = labelBatchPlan(workspace, ids, options);
  const annotations = { ...workspace.annotations };
  let changed = false;
  for (const id of plan.targetIds) {
    const current = annotations[id] ?? blankAnnotation;
    if (current.label === value) continue;
    annotations[id] = { ...current, label: value };
    changed = true;
  }
  return changed ? { ...workspace, annotations } : workspace;
}

/** Replace only the icon field, including an explicit clear to no icon. */
export function applyBatchIcon(
  workspace: Workspace,
  ids: Iterable<string>,
  icon: string,
): Workspace {
  const annotations = { ...workspace.annotations };
  let changed = false;
  for (const id of targets(workspace, ids)) {
    const current = annotations[id] ?? blankAnnotation;
    if (current.icon === icon) continue;
    annotations[id] = { ...current, icon };
    changed = true;
  }
  return changed ? { ...workspace, annotations } : workspace;
}

export interface TagBatchPlan {
  /** Selected entities already listed by the tag itself. */
  memberCount: number;
  /** Selected entities the tag does not list directly. */
  missingCount: number;
  total: number;
}

/** Direct membership only. Address-level tags stay visible through the tag index. */
export function tagBatchPlan(
  workspace: Workspace,
  ids: Iterable<string>,
  tagId: string,
): TagBatchPlan {
  const all = targets(workspace, ids);
  const tag = (workspace.tags ?? []).find((entry) => entry.id === tagId);
  const members = new Set(tag?.nodeIds ?? []);
  const memberCount = all.filter((id) => members.has(id)).length;
  return { memberCount, missingCount: all.length - memberCount, total: all.length };
}

export function tagMemberCount(workspace: Workspace): number {
  return (workspace.tags ?? []).reduce((total, tag) => total + tag.nodeIds.length, 0);
}

export function applyBatchTag(
  workspace: Workspace,
  ids: Iterable<string>,
  tagId: string,
  action: 'add' | 'remove',
): Workspace {
  const all = targets(workspace, ids);
  const tag = (workspace.tags ?? []).find((entry) => entry.id === tagId);
  if (!tag) throw new Error('That tag is no longer part of this workspace.');
  const members = new Set(tag.nodeIds);
  const added = action === 'add' ? all.filter((id) => !members.has(id)) : [];
  if (action === 'add' && tagMemberCount(workspace) + added.length > MAX_TAG_MEMBERS)
    throw new Error('Workspace has reached the 50,000 tag membership limit.');
  const selected = new Set(all);
  const nodeIds =
    action === 'add' ? [...tag.nodeIds, ...added] : tag.nodeIds.filter((id) => !selected.has(id));
  if (nodeIds.length === tag.nodeIds.length) return workspace;
  return {
    ...workspace,
    tags: (workspace.tags ?? []).map((entry) =>
      entry.id === tagId ? { ...entry, nodeIds } : entry,
    ),
  };
}

/** Create a tag and assign it to the batch in one undoable step. */
export function createBatchTag(
  workspace: Workspace,
  ids: Iterable<string>,
  tag: { name: string; color: string; description?: string },
): Workspace {
  const name = tag.name.trim().slice(0, 100);
  if (!name) throw new Error('Enter a tag name.');
  const tags = workspace.tags ?? [];
  const existing = tags.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (existing) return applyBatchTag(workspace, ids, existing.id, 'add');
  if (tags.length >= MAX_WORKSPACE_TAGS) throw new Error('Workspace supports at most 200 tags.');
  const nodeIds = targets(workspace, ids);
  if (tagMemberCount(workspace) + nodeIds.length > MAX_TAG_MEMBERS)
    throw new Error('Workspace has reached the 50,000 tag membership limit.');
  return {
    ...workspace,
    tags: [
      ...tags,
      {
        id: crypto.randomUUID(),
        name,
        color: tag.color,
        nodeIds,
        ...(tag.description?.trim() ? { description: tag.description.trim() } : {}),
      },
    ],
  };
}
