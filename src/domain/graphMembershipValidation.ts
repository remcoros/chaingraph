import { z } from 'zod';
import { canonicalEntityNodeId } from './entityReferences';
import type { Network } from './types';

// A legacy graph can include address nodes beyond the 50,000 observed records,
// plus 10,000 independently watched addresses. Migration must preserve that view.
export const MAX_GRAPH_NODES = 110_000;
export const MAX_GRAPH_ACTION_NODES = 50_000;
export const graphNodeIdsSchema = z.array(z.string().max(200)).max(MAX_GRAPH_NODES);

export function assertGraphNodeBudget(value: unknown): void {
  if (Array.isArray(value) && value.length > MAX_GRAPH_NODES)
    throw new Error('Workspace exceeds the 110,000 graph entity limit.');
}

export function parseGraphNodeIds(value: unknown, network: Network): string[] {
  assertGraphNodeBudget(value);
  return [
    ...new Set(graphNodeIdsSchema.parse(value).map((id) => canonicalEntityNodeId(id, network))),
  ];
}
