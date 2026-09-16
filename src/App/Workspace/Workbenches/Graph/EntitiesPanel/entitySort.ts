import type { GraphNode } from '../../../../../Domain/types';

export type EntitySort = 'graph' | 'label' | 'value-desc' | 'value-asc' | 'type';

export function sortEntities(nodes: GraphNode[], sort: EntitySort): GraphNode[] {
  if (sort === 'graph') return nodes;
  return [...nodes].sort((a, b) => {
    if (sort === 'value-asc' || sort === 'value-desc') {
      if (a.value === undefined && b.value !== undefined) return 1;
      if (b.value === undefined && a.value !== undefined) return -1;
      const difference = (a.value ?? 0) - (b.value ?? 0);
      if (difference) return sort === 'value-asc' ? difference : -difference;
    }
    if (sort === 'type') {
      const difference = a.kind.localeCompare(b.kind);
      if (difference) return difference;
    }
    return a.label.localeCompare(b.label, undefined, { numeric: true }) || a.id.localeCompare(b.id);
  });
}
