import { z } from 'zod';
import { canonicalEntityNodeId } from '../Metadata/entityReferences';
import type { Network } from '../Chain/network';

export const MAX_HIDDEN_NODES = 50_000;
export const hiddenNodeIdsSchema = z.array(z.string().max(200)).max(MAX_HIDDEN_NODES);

export function assertHiddenNodeBudget(value: unknown): void {
  if (Array.isArray(value) && value.length > MAX_HIDDEN_NODES)
    throw new Error('Workspace exceeds the 50,000 hidden entity limit.');
}

export function parseHiddenNodeIds(value: unknown, network: Network): string[] {
  assertHiddenNodeBudget(value);
  return [
    ...new Set(hiddenNodeIdsSchema.parse(value).map((id) => canonicalEntityNodeId(id, network))),
  ];
}
