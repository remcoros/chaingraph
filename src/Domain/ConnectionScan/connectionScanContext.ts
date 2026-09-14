import {
  SCAN_LIMITS,
  isScanNodeId,
  scanPathHops,
  type ScanDirection,
  type ScanRoute,
} from './connectionScanPaths';

export const scanEdgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Direction is structural; transaction evidence is checked again before accepting Add. */
function directionBetween(a: string, b: string): ScanDirection {
  const creates = a.split(':')[1] === b.split(':')[1];
  return a.startsWith('tx:') === creates ? 'downstream' : 'upstream';
}

export interface ScanContextIndex {
  edges: Set<string>;
  connected: Set<string>;
  isNovel(path: readonly string[]): boolean;
  route(target: string): { path: string[]; directions: ScanDirection[] } | undefined;
}

/** One frozen baseline index. Only a bounded witness, never this index, enters a result. */
export async function prepareScanContext(
  source: string,
  links: readonly (readonly [string, string])[],
  known: ReadonlySet<string>,
  checkpoint: () => Promise<void>,
): Promise<ScanContextIndex> {
  const adjacent = new Map<string, Set<string>>();
  const edges = new Set<string>();
  for (const [a, b] of links) {
    await checkpoint();
    if (!isScanNodeId(a) || !isScanNodeId(b) || a.startsWith('tx:') === b.startsWith('tx:'))
      throw new Error('Invalid loaded scan context edge.');
    edges.add(scanEdgeKey(a, b));
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const neighbours = adjacent.get(from) ?? new Set<string>();
      neighbours.add(to);
      adjacent.set(from, neighbours);
    }
  }
  // The identity of an existing outpoint already tells us which transaction
  // created it. Merely loading that creator is not a new relationship.
  for (const node of known) {
    await checkpoint();
    if (node.startsWith('out:')) edges.add(scanEdgeKey(node, `tx:${node.split(':')[1]}`));
  }
  const parents = new Map<string, string>();
  const connected = new Set([source]);
  const queue = [source];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    await checkpoint();
    const node = queue[cursor];
    for (const next of [...(adjacent.get(node) ?? [])].sort()) {
      if (connected.has(next)) continue;
      connected.add(next);
      parents.set(next, node);
      queue.push(next);
    }
  }
  return {
    edges,
    connected,
    isNovel: (path) => path.some((node, i) => i > 0 && !edges.has(scanEdgeKey(path[i - 1], node))),
    route(target) {
      if (!connected.has(target) || target === source) return;
      const path = [target];
      while (path.at(-1) !== source) {
        if (path.length >= 2 * SCAN_LIMITS.maxHops + 3) return;
        path.push(parents.get(path.at(-1)!)!);
      }
      path.reverse();
      if (scanPathHops(path) > SCAN_LIMITS.maxHops) return;
      return { path, directions: path.slice(1).map((node, i) => directionBetween(path[i], node)) };
    },
  };
}

/** Opposite presentations of the same closed route are one relationship. */
export function scanReconnectionKey(
  result: { path: string[]; context?: ScanRoute },
): string | undefined {
  if (!result.context) return;
  const edges = new Set<string>();
  for (const path of [result.path, result.context.path])
    path.slice(1).forEach((node, i) => edges.add(scanEdgeKey(path[i], node)));
  return JSON.stringify([result.path[0], [...edges].sort()]);
}
