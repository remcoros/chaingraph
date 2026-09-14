import type { RenderLink } from './adapter';
import type { Position } from './flowLayout';
import { sideCenter } from './flowOrientation';

/** A target for branches, never a cutoff for the visible transaction structure. */
export const FLOW_BRANCH_TARGET = 50;
type Side = 'incoming' | 'outgoing';
type Outpoint = { creates: RenderLink[]; spends: RenderLink[] };
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function rank(id: string) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function indexFlowLinks(links: readonly RenderLink[]) {
  const byId = new Map<string, RenderLink>();
  const adjacent = new Map<string, RenderLink[]>();
  const incoming = new Map<string, RenderLink[]>();
  const outgoing = new Map<string, RenderLink[]>();
  const outpoints = new Map<string, Outpoint>();
  const transactions = new Set<string>();
  const append = (map: Map<string, RenderLink[]>, id: string, link: RenderLink) => {
    const group = map.get(id) ?? [];
    group.push(link);
    map.set(id, group);
  };
  for (const link of links) {
    if (!link.directed || byId.has(link.id)) continue;
    byId.set(link.id, link);
    for (const id of new Set([link.source, link.target])) append(adjacent, id, link);
    if (!link.flowSide) continue;
    const creates = link.flowSide === 'outgoing';
    const transaction = creates ? link.source : link.target;
    const output = creates ? link.target : link.source;
    transactions.add(transaction);
    append(creates ? outgoing : incoming, transaction, link);
    const point = outpoints.get(output) ?? { creates: [], spends: [] };
    (creates ? point.creates : point.spends).push(link);
    outpoints.set(output, point);
  }
  // Sorting once keeps traversal and tie-breaking independent of input order.
  for (const map of [adjacent, incoming, outgoing])
    for (const group of map.values()) group.sort((a, b) => compare(a.id, b.id));
  for (const point of outpoints.values())
    for (const group of [point.creates, point.spends]) group.sort((a, b) => compare(a.id, b.id));
  return { byId, adjacent, incoming, outgoing, outpoints, transactions };
}

/** Spread spare animation slots across world-space sectors of a terminal sphere.
 * Camera movement never changes this order. Stable ranks break ties inside sectors. */
function spatialOrder(
  links: RenderLink[],
  side: Side,
  positions?: ReadonlyMap<string, Position>,
  dimensions: 2 | 3 = 3,
): RenderLink[] {
  const ordered = links
    .map((link) => ({ link, rank: rank(link.id) }))
    .sort((a, b) => a.rank - b.rank || compare(a.link.id, b.link.id));
  if (!positions || links.length < 2) return ordered.map((item) => item.link);
  const endpoint = (link: RenderLink) => (side === 'incoming' ? link.source : link.target);
  const points = links.map((link) => positions.get(endpoint(link))!).filter(Boolean);
  if (!points.length) return ordered.map((item) => item.link);
  const center = sideCenter(points, dimensions === 2);
  const sectors = new Map<number, RenderLink[]>();
  for (const { link } of ordered) {
    const point = positions.get(endpoint(link));
    const x = point ? point.x - center.x : 0;
    const y = point ? point.y - center.y : 0;
    const z = point && dimensions === 3 ? point.z - center.z : 0;
    const length = Math.hypot(x, y, z);
    const longitude = Math.min(7, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 8));
    // Equal-height bands give equal-area regions on a sphere.
    const latitude =
      dimensions === 2 || !length ? 0 : Math.min(3, Math.floor((z / length + 1) * 2));
    const key = latitude * 8 + longitude;
    const sector = sectors.get(key) ?? [];
    sector.push(link);
    sectors.set(key, sector);
  }
  const groups = [...sectors.entries()].sort((a, b) => rank(String(a[0])) - rank(String(b[0])));
  const result: RenderLink[] = [];
  for (let offset = 0; result.length < links.length; offset++)
    for (const [, group] of groups) if (group[offset]) result.push(group[offset]);
  return result;
}

/** Animate all visible upstream/downstream transaction bridges first. Only
 * terminal branches at active nodes are sampled to fill the remaining target. */
export function chooseFlowLinks(
  index: ReturnType<typeof indexFlowLinks>,
  selected: readonly string[],
  hovered?: string,
  hoveredLink?: string,
  positions?: ReadonlyMap<string, Position>,
  dimensions: 2 | 3 = 3,
): RenderLink[] {
  const chosen = new Map<string, RenderLink>();
  const roots = { incoming: new Set<string>(), outgoing: new Set<string>() };
  const active = [...new Set([...(hovered ? [hovered] : []), ...selected])];
  const shown = (link: RenderLink) =>
    !positions || (positions.has(link.source) && positions.has(link.target));
  const add = (link: RenderLink) => {
    if (shown(link)) chosen.set(link.id, link);
  };
  const halves = (id: string) => {
    const point = index.outpoints.get(id);
    return {
      creates: point?.creates.filter(shown) ?? [],
      spends: point?.spends.filter(shown) ?? [],
    };
  };
  const seedOutpoint = (id: string) => {
    const point = halves(id);
    for (const link of point.creates) {
      add(link);
      roots.incoming.add(link.source);
    }
    for (const link of point.spends) {
      add(link);
      roots.outgoing.add(link.target);
    }
  };
  const hoveredEdge = hoveredLink ? index.byId.get(hoveredLink) : undefined;
  if (hoveredEdge && shown(hoveredEdge)) {
    add(hoveredEdge);
    if (hoveredEdge.flowSide)
      seedOutpoint(hoveredEdge.flowSide === 'incoming' ? hoveredEdge.source : hoveredEdge.target);
  }
  for (const id of active) {
    if (index.transactions.has(id)) {
      roots.incoming.add(id);
      roots.outgoing.add(id);
    } else if (index.outpoints.has(id)) seedOutpoint(id);
  }
  const bridgeCounts = { incoming: 0, outgoing: 0 };
  const bridgeSegments = new Set<string>();
  for (const side of ['incoming', 'outgoing'] as const) {
    const visited = new Set<string>();
    const queue = [...roots[side]].sort(compare);
    let branchCount = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const transaction = queue[cursor];
      if (visited.has(transaction)) continue;
      visited.add(transaction);
      const edges = (side === 'incoming' ? index.incoming : index.outgoing).get(transaction) ?? [];
      for (const direct of edges) {
        if (!shown(direct)) continue;
        const point = halves(side === 'incoming' ? direct.source : direct.target);
        const continuations = side === 'incoming' ? point.creates : point.spends;
        for (const other of continuations) {
          const next = side === 'incoming' ? other.source : other.target;
          if (next === transaction) continue;
          add(direct);
          add(other);
          bridgeSegments.add(direct.id);
          bridgeSegments.add(other.id);
          // Each transaction is visited once per direction, so each pair is
          // counted once even when several active roots reach the same branch.
          branchCount++;
          if (!visited.has(next)) queue.push(next);
        }
      }
    }
    bridgeCounts[side] = branchCount;
  }
  for (const side of ['incoming', 'outgoing'] as const) {
    const forcedTerminals = new Set<string>();
    const candidates = active.map((id) => {
      const links = index.transactions.has(id)
        ? ((side === 'incoming' ? index.incoming : index.outgoing).get(id) ?? [])
        : index.outpoints.has(id)
          ? []
          : (index.adjacent.get(id) ?? []).filter((link) =>
              side === 'incoming' ? link.target === id : link.source === id,
            );
      const terminal = links.filter((link) => shown(link) && !chosen.has(link.id));
      for (const link of links)
        if (chosen.has(link.id) && !bridgeSegments.has(link.id)) forcedTerminals.add(link.id);
      return spatialOrder(terminal, side, positions, dimensions);
    });
    let spare = Math.max(0, FLOW_BRANCH_TARGET - bridgeCounts[side] - forcedTerminals.size);
    // Fair sharing between hovered/selected nodes, and between spatial sectors.
    for (let offset = 0; spare > 0; offset++) {
      let found = false;
      for (const group of candidates) {
        const link = group[offset];
        if (!link) continue;
        found = true;
        if (chosen.has(link.id)) continue;
        add(link);
        spare--;
        if (!spare) break;
      }
      if (!found) break;
    }
  }
  return [...chosen.values()];
}
