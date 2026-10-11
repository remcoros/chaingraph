import {
  applyBatchIcon as writeBatchIcon,
  applyBatchLabel as writeBatchLabel,
  applyBatchTag as writeBatchTag,
  createBatchTag as writeNewBatchTag,
} from './batchEdits';
import { canonicalAnnotationReference } from '../annotationReferences';
import {
  clampAnnotationText,
  MAX_ANNOTATION_NOTE_LENGTH,
  MAX_TAG_NAME_LENGTH,
  type Annotation,
} from './annotations';
import type { Workspace } from '../workspace';

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
      const reference = canonicalAnnotationReference(id, workspace.network);
      if (
        reference.startsWith('party:') &&
        !workspace.counterparties?.definitions.some((party) => party.id === reference.slice(6))
      )
        continue;
      unique.add(reference);
    } catch {
      // Malformed, wrong-network or unavailable metadata subjects are not edit targets.
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
  const targets = all.filter(
    (id) => replaceExisting || !workspace.annotations.entities[id]?.label?.trim(),
  );
  return { ids: all, targets, preserved: all.length - targets.length };
}

export function planBatchIcon(
  workspace: Workspace,
  ids: readonly string[],
  replaceExisting = false,
): BatchScope {
  const all = canonical(workspace, ids);
  const targets = all.filter((id) => replaceExisting || !workspace.annotations.entities[id]?.icon);
  return { ids: all, targets, preserved: all.length - targets.length };
}

export function planBatchTag(
  workspace: Workspace,
  ids: readonly string[],
  tagId: string,
  add: boolean,
): BatchScope {
  const all = canonical(workspace, ids);
  const members = new Set(
    (workspace.annotations.tags ?? []).find((tag) => tag.id === tagId)?.nodeIds ?? [],
  );
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
  return writeBatchLabel(workspace, canonical(workspace, ids), label, {
    onlyUnlabeled: !replaceExisting,
  });
}

export function applyBatchIcon(
  workspace: Workspace,
  ids: readonly string[],
  icon: string,
  replaceExisting = false,
): Workspace {
  const { targets } = planBatchIcon(workspace, ids, replaceExisting);
  return writeBatchIcon(workspace, targets, clampAnnotationText(icon, 20));
}

export function applyBatchTag(
  workspace: Workspace,
  ids: readonly string[],
  tagId: string,
  add: boolean,
): Workspace {
  const tag = (workspace.annotations.tags ?? []).find((item) => item.id === tagId);
  if (!tag) throw new Error('This tag no longer exists in the workspace.');
  return writeBatchTag(workspace, canonical(workspace, ids), tagId, add ? 'add' : 'remove');
}

/** Create a tag and assign the selected records in the same update. */
export function createBatchTag(
  workspace: Workspace,
  value: { name: string; color: string; description?: string },
  ids: readonly string[],
): Workspace {
  const name = clampAnnotationText(value.name.trim(), MAX_TAG_NAME_LENGTH);
  if (!name) throw new Error('Give the tag a name.');
  return writeNewBatchTag(workspace, canonical(workspace, ids), { ...value, name });
}

/** Single canonical entity only. Notes never overwrite a batch. */
export function applyEntityNote(workspace: Workspace, id: string, note: string): Workspace {
  const [target] = canonical(workspace, [id]);
  if (!target) return workspace;
  const value = clampAnnotationText(note, MAX_ANNOTATION_NOTE_LENGTH);
  if ((workspace.annotations.entities[target]?.note ?? '') === value) return workspace;
  return {
    ...workspace,
    annotations: {
      ...workspace.annotations,
      entities: {
        ...workspace.annotations.entities,
        [target]: { ...(workspace.annotations.entities[target] ?? EMPTY), note: value },
      },
    },
  };
}
