import type { Annotation } from '../../Domain/Workspace/annotationTypes';
import type { Workspace } from '../../Domain/Workspace/workspaceTypes';

const fallback = 'Edit workspace';
import { emptyAnnotation } from './Annotations/emptyAnnotation';

function changedKeys<T extends object>(before: T, after: T): Set<keyof T> {
  return new Set(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (key) => before[key as keyof T] !== after[key as keyof T],
    ) as (keyof T)[],
  );
}

function difference(before: readonly string[], after: readonly string[]) {
  const oldIds = new Set(before);
  const newIds = new Set(after);
  return {
    added: [...newIds].filter((id) => !oldIds.has(id)),
    removed: [...oldIds].filter((id) => !newIds.has(id)),
  };
}

function counted(verb: string, count: number, noun: string) {
  return `${verb} ${count === 1 ? '' : `${count} `}${noun}${count === 1 ? '' : 's'}`;
}

function membershipDescription(before: readonly string[], after: readonly string[]) {
  const { added, removed } = difference(before, after);
  if ((!added.length && !removed.length) || (added.length && removed.length)) return;
  const ids = added.length ? added : removed;
  const noun = ids.every((id) => id.startsWith('out:'))
    ? 'output'
    : ids.every((id) => id.startsWith('tx:'))
      ? 'transaction'
      : ids.every((id) => id.startsWith('addr:'))
        ? 'address'
        : 'node';
  // Addresses have a different plural from the other graph entities.
  if (noun === 'address' && ids.length > 1)
    return `${added.length ? 'Add' : 'Remove'} ${ids.length} addresses`;
  return counted(added.length ? 'Add' : 'Remove', ids.length, noun);
}

function annotationDescription(before: Workspace['annotations'], after: Workspace['annotations']) {
  const fields = new Set<keyof Annotation>();
  const bookmarks = new Set<boolean>();
  let count = 0;
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[id] === after[id]) continue;
    const oldValue = before[id] ?? emptyAnnotation;
    const newValue = after[id] ?? emptyAnnotation;
    const changed = changedKeys(oldValue, newValue);
    if (changed.size) count++;
    for (const key of changed) {
      fields.add(key);
      if (key === 'bookmarked') bookmarks.add(newValue.bookmarked);
    }
  }
  if (!fields.size) return;
  if (fields.size > 1) return 'Edit annotations';
  if (fields.has('label')) return counted('Change', count, 'label');
  if (fields.has('icon')) return counted('Change', count, 'icon');
  if (fields.has('note')) return counted('Edit', count, 'note');
  if (bookmarks.size !== 1) return 'Edit annotations';
  return counted(bookmarks.has(true) ? 'Add' : 'Remove', count, 'bookmark');
}

/** Describe the action stored with an undo snapshot, without retaining its metadata.
 * Compare only changed collections and their shallow records. Unknown or mixed
 * changes deliberately use a broad label rather than claiming a narrower action.
 */
export function describeWorkspaceChange(before: Workspace, after: Workspace): string {
  const keys = changedKeys(before, after);
  const labels: string[] = [];
  const consume = (key: keyof Workspace, description?: string) => {
    keys.delete(key);
    if (description) labels.push(description);
  };
  if (keys.has('name')) consume('name', 'Rename workspace');
  if (keys.has('description')) consume('description', 'Edit workspace description');
  if (keys.has('annotations'))
    consume('annotations', annotationDescription(before.annotations, after.annotations));

  if (keys.has('tags')) {
    const oldTags = new Map((before.tags ?? []).map((tag) => [tag.id, tag]));
    const newTags = new Map((after.tags ?? []).map((tag) => [tag.id, tag]));
    const { added, removed } = difference([...oldTags.keys()], [...newTags.keys()]);
    const edited = [...newTags].filter(([id, tag]) => {
      const oldTag = oldTags.get(id);
      if (!oldTag || oldTag === tag) return false;
      const fields = changedKeys(oldTag, tag);
      if (fields.has('nodeIds')) {
        const members = difference(oldTag.nodeIds, tag.nodeIds);
        if (!members.added.length && !members.removed.length) fields.delete('nodeIds');
      }
      return fields.size > 0;
    });
    let editLabel = 'Edit tag';
    if (edited.length === 1) {
      const [id, tag] = edited[0];
      const oldTag = oldTags.get(id)!;
      const fields = changedKeys(oldTag, tag);
      if (fields.size === 1 && fields.has('nodeIds')) {
        const members = difference(oldTag.nodeIds, tag.nodeIds);
        editLabel =
          members.added.length && members.removed.length
            ? 'Change tags'
            : members.added.length
              ? 'Assign tag'
              : 'Remove tag';
      }
    }
    consume(
      'tags',
      added.length && !removed.length && !edited.length
        ? counted('Add', added.length, 'tag')
        : removed.length && !added.length && !edited.length
          ? counted('Remove', removed.length, 'tag')
          : edited.length === 1 && !added.length && !removed.length
            ? editLabel
            : added.length || removed.length || edited.length
              ? 'Change tags'
              : undefined,
    );
  }

  if (keys.has('wallets')) {
    const oldWallets = new Map(before.wallets.map((wallet) => [wallet.id, wallet]));
    const newWallets = new Map(after.wallets.map((wallet) => [wallet.id, wallet]));
    const { added, removed } = difference([...oldWallets.keys()], [...newWallets.keys()]);
    const edits = [...newWallets]
      .flatMap(([id, wallet]) => {
        const oldWallet = oldWallets.get(id);
        return oldWallet && oldWallet !== wallet ? [changedKeys(oldWallet, wallet)] : [];
      })
      .filter((fields) => fields.size);
    consume(
      'wallets',
      added.length && !removed.length && !edits.length
        ? counted('Add', added.length, 'wallet')
        : removed.length && !added.length && !edits.length
          ? counted('Remove', removed.length, 'wallet')
          : !added.length &&
              !removed.length &&
              edits.length &&
              edits.every((fields) => fields.size === 1 && fields.has('name'))
            ? counted('Rename', edits.length, 'wallet')
            : edits.length || added.length || removed.length
              ? fallback
              : undefined,
    );
  }

  if (keys.has('findings')) {
    const oldFindings = new Map(before.findings.map((finding) => [finding.id, finding]));
    const sameIds =
      before.findings.length === after.findings.length &&
      after.findings.every((finding) => oldFindings.has(finding.id));
    const changed = after.findings.filter((finding) => {
      const oldFinding = oldFindings.get(finding.id);
      if (!oldFinding) return true;
      const fields = changedKeys(oldFinding, finding);
      fields.delete('stale');
      return fields.size > 0;
    });
    const exclusionOnly =
      sameIds &&
      changed.length &&
      changed.every((finding) => {
        const fields = changedKeys(oldFindings.get(finding.id)!, finding);
        fields.delete('stale');
        return fields.size === 1 && fields.has('excluded');
      });
    consume(
      'findings',
      exclusionOnly
        ? changed.every((finding) => finding.excluded)
          ? counted('Exclude', changed.length, 'finding')
          : changed.every((finding) => !finding.excluded)
            ? counted('Restore', changed.length, 'finding')
            : 'Edit findings'
        : changed.length || !sameIds
          ? 'Run analysis'
          : undefined,
    );
  }

  if (keys.has('transactions')) {
    const { added, removed } = difference(
      Object.keys(before.transactions),
      Object.keys(after.transactions),
    );
    const changedExisting = Object.keys(after.transactions).some(
      (id) => before.transactions[id] && before.transactions[id] !== after.transactions[id],
    );
    const label =
      !changedExisting && !(added.length && removed.length)
        ? added.length
          ? counted('Add', added.length, 'transaction')
          : removed.length
            ? counted('Remove', removed.length, 'transaction')
            : undefined
        : fallback;
    consume('transactions', label);
    if (label && label !== fallback) {
      // Loaded transaction membership also updates its context and graph projection.
      keys.delete('inputContext');
      keys.delete('contextTransactionIds');
    }
  }

  if (keys.has('view')) {
    const viewKeys = changedKeys(before.view, after.view);
    let viewLabel: string | undefined;
    if (viewKeys.has('graphNodeIds')) {
      // Undefined membership has legacy semantics; do not invent an empty graph.
      viewLabel =
        before.view.graphNodeIds && after.view.graphNodeIds
          ? membershipDescription(before.view.graphNodeIds, after.view.graphNodeIds)
          : 'Change view';
      viewKeys.delete('graphNodeIds');
    }
    if (viewKeys.has('hiddenNodeIds')) {
      const { added, removed } = difference(
        before.view.hiddenNodeIds ?? [],
        after.view.hiddenNodeIds ?? [],
      );
      if (added.length || removed.length) {
        const visibilityLabel =
          added.length && removed.length
            ? 'Change visibility'
            : counted(added.length ? 'Hide' : 'Show', added.length || removed.length, 'node');
        viewLabel = viewLabel ? 'Change view' : visibilityLabel;
      }
      viewKeys.delete('hiddenNodeIds');
    }
    // Selection and camera snapshots frequently accompany a content edit.
    viewKeys.delete('selectionId');
    viewKeys.delete('graphSnapshot');
    if (viewKeys.size) viewLabel = 'Change view';
    const transactionChange =
      labels.length === 1 && /^(Add|Remove) (\d+ )?transactions?$/.test(labels[0]);
    consume(
      'view',
      transactionChange && !viewKeys.size
        ? undefined
        : (viewLabel ?? (labels.length ? undefined : 'Change view')),
    );
  }
  return !keys.size && labels.length === 1 ? labels[0] : fallback;
}
