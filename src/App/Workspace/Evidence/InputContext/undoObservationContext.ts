import type { Workspace } from '../../workspace';

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
    before.inputContext === after.inputContext &&
    before.contextTransactionIds === after.contextTransactionIds
  )
    return snapshot;

  let scopes = snapshot.inputContext;
  const scopedIds = new Set([
    ...Object.keys(before.inputContext ?? {}),
    ...Object.keys(after.inputContext ?? {}),
  ]);
  for (const id of scopedIds) {
    const previous = before.inputContext?.[id],
      next = after.inputContext?.[id];
    if (sameScope(previous, next) || !snapshot.transactions[id] || sameScope(scopes?.[id], next))
      continue;
    // Historical observations must support the new scope before adopting it.
    if (next) {
      const outputs = new Set(snapshot.transactions[id].vout.map((output) => output.n));
      if (next.some((index) => !outputs.has(index))) continue;
    }
    if (scopes === snapshot.inputContext) scopes = { ...scopes };
    if (next) scopes![id] = next;
    else delete scopes![id];
  }

  const previous = new Set(before.contextTransactionIds ?? []);
  const next = new Set(after.contextTransactionIds ?? []);
  let provenance: Set<string> | undefined;
  const original = new Set(snapshot.contextTransactionIds ?? []);
  for (const id of previous)
    if (!next.has(id) && original.has(id)) {
      provenance ??= new Set(original);
      provenance.delete(id);
    }
  for (const id of next)
    if (!previous.has(id) && !original.has(id) && snapshot.transactions[id]) {
      provenance ??= new Set(original);
      provenance.add(id);
    }
  if (scopes === snapshot.inputContext && !provenance) return snapshot;
  return {
    ...snapshot,
    inputContext: scopes && Object.keys(scopes).length ? scopes : undefined,
    contextTransactionIds: provenance
      ? provenance.size
        ? [...provenance]
        : undefined
      : snapshot.contextTransactionIds,
  };
}
