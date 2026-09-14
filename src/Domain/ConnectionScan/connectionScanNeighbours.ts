import { isScanNodeId, SCAN_LIMITS } from './connectionScan';
import type { GraphData } from '../types';

/** Index loaded observed links once, independently of canvas membership and visibility. */
export function indexScanNeighbours(
  graph: Pick<GraphData, 'nodes' | 'links'>,
): ReadonlyMap<string, readonly string[]> {
  const kinds = new Map(
    graph.nodes
      .filter(
        (node) =>
          isScanNodeId(node.id) &&
          ((node.kind === 'transaction' && node.id.startsWith('tx:')) ||
            (node.kind === 'output' && node.id.startsWith('out:'))),
      )
      .map((node) => [node.id, node.kind]),
  );
  const neighbours = new Map<string, Set<string>>(
    [...kinds.keys()].map((id) => [id, new Set<string>()]),
  );
  for (const link of graph.links) {
    const sourceKind = kinds.get(link.source);
    const targetKind = kinds.get(link.target);
    if (
      (link.kind === 'creates' && sourceKind === 'transaction' && targetKind === 'output') ||
      (link.kind === 'spends' && sourceKind === 'output' && targetKind === 'transaction')
    ) {
      neighbours.get(link.source)!.add(link.target);
      neighbours.get(link.target)!.add(link.source);
    }
  }
  return new Map([...neighbours].map(([id, adjacent]) => [id, [...adjacent].sort()]));
}

/** Freeze nearest loaded targets in breadth-first order. No chain lookup or scan-direction bias. */
export function prepareNeighbourScanTargets({
  source,
  neighbours,
}: {
  source: string;
  neighbours: ReadonlyMap<string, readonly string[]>;
}): { ids: string[]; capped: boolean } {
  if (!isScanNodeId(source)) throw new Error('Choose a transaction or output as the scan source.');
  const seen = new Set([source]);
  const queue = [source];
  const ids: string[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const id of neighbours.get(queue[cursor]!) ?? []) {
      if (seen.has(id)) continue;
      // Detect a real omitted target without admitting another node to the queue.
      if (ids.length === SCAN_LIMITS.maxTargets) return { ids, capped: true };
      seen.add(id);
      queue.push(id);
      ids.push(id);
    }
  }
  return { ids, capped: false };
}
