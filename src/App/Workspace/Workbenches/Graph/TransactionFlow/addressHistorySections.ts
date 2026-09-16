export interface AddressHistorySectionPage<T> {
  items: readonly T[];
  collapsed: boolean;
}

/**
 * Allocates a bounded page across the visible address-history sections.
 * Expanded non-empty sections get one row first, then the remaining budget is
 * filled in section order so pending activity remains first without hiding a
 * later expanded section behind an earlier full section.
 */
export function paginateAddressHistorySections<T>(
  sections: readonly AddressHistorySectionPage<T>[],
  limit: number,
): T[][] {
  const visible = sections.map(() => [] as T[]);
  const budget = Number.isFinite(limit)
    ? Math.max(0, Math.floor(limit))
    : limit > 0
      ? Number.MAX_SAFE_INTEGER
      : 0;
  const expanded = sections
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => !section.collapsed && section.items.length > 0);
  let remaining = Math.min(
    budget,
    expanded.reduce((total, { section }) => total + section.items.length, 0),
  );

  if (remaining >= expanded.length) {
    for (const { index, section } of expanded) {
      visible[index] = section.items.slice(0, 1);
      remaining -= 1;
    }
  }

  for (const { index, section } of expanded) {
    if (!remaining) break;
    const current = visible[index].length;
    const count = Math.min(section.items.length - current, remaining);
    if (count > 0) {
      visible[index] = section.items.slice(0, current + count);
      remaining -= count;
    }
  }
  return visible;
}
