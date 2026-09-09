import type { WalletReviewFlowEntry } from './walletReviewContext';

export function isWalletFlowEditTarget(entry: WalletReviewFlowEntry, editingId?: string) {
  return (
    !entry.coinbase &&
    entry.id.startsWith('out:') &&
    (entry.id === editingId ||
      (editingId?.startsWith('addr:') === true && entry.address === editingId.slice(5)))
  );
}

/** Reserve space for both annotation context and verified wallet relationships.
 * Recompute from current evidence so late prevouts need no separate selection state.
 * Canonical IDs deduplicate entries; returned rows retain transaction order. */
export function walletFlowVisibility(
  entries: readonly WalletReviewFlowEntry[],
  editingId?: string,
  limit = 2,
) {
  const byId = new Map<string, WalletReviewFlowEntry>();
  for (const [index, entry] of entries.entries()) {
    // Unresolved inputs can share a placeholder transaction ID without being
    // the same edge. Only real outpoint references can be deduplicated.
    const key = entry.id.startsWith('out:') ? entry.id : `placeholder:${index}`;
    const previous = byId.get(key);
    if (!previous) byId.set(key, entry);
    else if (entry.selected && !previous.selected) byId.set(key, { ...previous, selected: true });
  }
  const unique = [...byId.values()];
  const editing = unique.filter((entry) => isWalletFlowEditTarget(entry, editingId));
  const selected = unique.filter((entry) => entry.selected);
  const owned = unique.filter((entry) => entry.ownership === 'wallet');
  const relevant = new Set([...editing, ...selected, ...owned.slice(0, 1)]);
  const capacity = limit === 2 ? Math.max(2, Math.min(4, relevant.size)) : limit;
  const chosen = new Set<WalletReviewFlowEntry>();
  // Round-robin gives each relationship a representative even in very large flows.
  for (let i = 0; chosen.size < capacity && i < unique.length; i++) {
    for (const group of [editing, selected, owned]) {
      if (group[i] && chosen.size < capacity) chosen.add(group[i]);
    }
    if (i >= Math.max(editing.length, selected.length, owned.length)) break;
  }
  for (const entry of unique) {
    if (chosen.size >= capacity) break;
    chosen.add(entry);
  }
  return {
    visible: unique.filter((entry) => chosen.has(entry)),
    total: unique.length,
    hidden: unique.length - chosen.size,
    owned: owned.length,
    hiddenOwned: owned.filter((entry) => !chosen.has(entry)).length,
    hiddenContext: unique.filter(
      (entry) => (entry.selected || isWalletFlowEditTarget(entry, editingId)) && !chosen.has(entry),
    ).length,
  };
}
