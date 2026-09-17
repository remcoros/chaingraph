import type { Workspace } from '../workspace';

const sameScope = (left?: readonly number[], right?: readonly number[]) =>
  left === right ||
  (!!left &&
    !!right &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]));

/** Carry only a quiet observation update's scope/provenance changes into Undo.
 * Copying the complete current context would erase ancestry from snapshots that
 * can still restore a removed transaction. Camera-only writes are an identity fast path. */
export function carryObservationContext(
  snapshot: Workspace,
  before: Workspace,
  after: Workspace,
): Workspace {
  if (
    before.view.inputContext === after.view.inputContext &&
    before.chainData.contextTransactionIds === after.chainData.contextTransactionIds
  )
    return snapshot;

  let scopes = snapshot.view.inputContext;
  const scopedIds = new Set([
    ...Object.keys(before.view.inputContext ?? {}),
    ...Object.keys(after.view.inputContext ?? {}),
  ]);
  for (const id of scopedIds) {
    const previous = before.view.inputContext?.[id],
      next = after.view.inputContext?.[id];
    if (
      sameScope(previous, next) ||
      !snapshot.chainData.transactions[id] ||
      sameScope(scopes?.[id], next)
    )
      continue;
    // Historical observations must support the new scope before adopting it.
    if (next) {
      const outputs = new Set(snapshot.chainData.transactions[id].vout.map((output) => output.n));
      if (next.some((index) => !outputs.has(index))) continue;
    }
    if (scopes === snapshot.view.inputContext) scopes = { ...scopes };
    if (next) scopes![id] = next;
    else delete scopes![id];
  }

  const previous = new Set(before.chainData.contextTransactionIds ?? []);
  const next = new Set(after.chainData.contextTransactionIds ?? []);
  let provenance: Set<string> | undefined;
  const original = new Set(snapshot.chainData.contextTransactionIds ?? []);
  for (const id of previous)
    if (!next.has(id) && original.has(id)) {
      provenance ??= new Set(original);
      provenance.delete(id);
    }
  for (const id of next)
    if (!previous.has(id) && !original.has(id) && snapshot.chainData.transactions[id]) {
      provenance ??= new Set(original);
      provenance.add(id);
    }
  if (scopes === snapshot.view.inputContext && !provenance) return snapshot;
  return {
    ...snapshot,
    chainData: {
      ...snapshot.chainData,
      contextTransactionIds: provenance
        ? provenance.size
          ? [...provenance]
          : undefined
        : snapshot.chainData.contextTransactionIds,
    },
    view: {
      ...snapshot.view,
      inputContext: scopes && Object.keys(scopes).length ? scopes : undefined,
    },
  };
}
