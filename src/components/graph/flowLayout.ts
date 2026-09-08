import type { RenderLink, RenderNode } from './adapter';
export type Position = { x: number; y: number; z: number };
export type LayoutNode = Pick<RenderNode, 'id' | 'shape' | 'x' | 'y' | 'z' | 'fx' | 'fy' | 'fz'>;
export interface LayoutRequest {
  revision: number;
  nodes: LayoutNode[];
  links: Pick<RenderLink, 'source' | 'target'>[];
  previous: [string, Position][];
}
export interface LayoutResult {
  revision: number;
  positions: [string, Position][];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ordered shelves along directed stages. Geometry has no time or ownership semantics.
 * Existing coordinates are immutable anchors, including temporarily filtered nodes. */
export function flowLayout(request: LayoutRequest): LayoutResult {
  const nodes = [...request.nodes].sort((a, b) => compare(a.id, b.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const prev = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const adjacent = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const l of request.links) {
    if (!byId.has(l.source) || !byId.has(l.target)) continue;
    adjacent.get(l.source)!.push(l.target);
    adjacent.get(l.target)!.push(l.source);
    // Address association is drawn, but never determines causal stage.
    if (byId.get(l.target)!.shape === 'octahedron' || byId.get(l.source)!.shape === 'octahedron')
      continue;
    next.get(l.source)!.push(l.target);
    prev.get(l.target)!.push(l.source);
  }
  const positions = new Map(request.previous.map(([id, p]) => [id, { ...p }]));
  for (const n of nodes) {
    const x = n.fx ?? n.x,
      y = n.fy ?? n.y,
      z = n.fz ?? n.z;
    if (Number.isFinite(x) && Number.isFinite(y))
      positions.set(n.id, { x: x!, y: y!, z: Number.isFinite(z) ? z! : 0 });
  }
  const visited = new Set<string>();
  let shelfBottom = Math.min(0, ...[...positions.values()].map((p) => p.y)) - 120;
  for (const seed of nodes) {
    if (visited.has(seed.id)) continue;
    const component = [seed.id];
    visited.add(seed.id);
    for (let i = 0; i < component.length; i++)
      for (const id of adjacent.get(component[i])!) {
        if (!visited.has(id)) {
          visited.add(id);
          component.push(id);
        }
      }
    component.sort(compare);
    const degree = new Map(component.map((id) => [id, prev.get(id)!.length]));
    const rank = new Map(component.map((id) => [id, 0]));
    const queue = component.filter((id) => degree.get(id) === 0);
    for (let i = 0; i < queue.length; i++)
      for (const id of next.get(queue[i])!) {
        rank.set(id, Math.max(rank.get(id)!, rank.get(queue[i])! + 1));
        degree.set(id, degree.get(id)! - 1);
        if (degree.get(id) === 0) queue.push(id);
      }
    // Malformed cycles stay visible with finite coordinates.
    const stages = new Map<number, string[]>();
    for (const id of component) {
      if (byId.get(id)!.shape === 'octahedron') continue;
      const r = rank.get(id)!;
      const stage = stages.get(r) ?? [];
      stage.push(id);
      stages.set(r, stage);
    }
    const maxCount = Math.max(1, ...[...stages.values()].map((s) => s.length));
    const columns = Math.ceil(Math.sqrt(maxCount / 1.6));
    const spacing = 58 + columns * 22;
    const anchors = component.filter((id) => positions.has(id));
    const anchor = anchors.find((id) => byId.get(id)!.shape !== 'octahedron') ?? anchors[0];
    const originX = anchor ? positions.get(anchor)!.x - rank.get(anchor)! * spacing : 0;
    const originY = anchor ? positions.get(anchor)!.y : shelfBottom;
    const order = new Map<string, number>();
    // Two barycentric sweeps keep siblings and multiple loaded paths near their neighbors.
    for (const stage of stages.values()) stage.forEach((id, i) => order.set(id, i));
    for (let pass = 0; pass < 2; pass++)
      for (const [r, stage] of [...stages].sort((a, b) => (pass ? b[0] - a[0] : a[0] - b[0]))) {
        const neighbors = pass ? next : prev;
        const center = (id: string) => {
          const ns = neighbors.get(id)!;
          return ns.length
            ? ns.reduce((s, n) => s + (order.get(n) ?? 0), 0) / ns.length
            : order.get(id)!;
        };
        stage.sort((a, b) => center(a) - center(b) || compare(a, b));
        stage.forEach((id, i) => order.set(id, i));
        stages.set(r, stage);
      }
    const occupied = new Set<string>();
    const cell = (x: number, y: number) => `${Math.round(x / 22)},${Math.round(y / 26)}`;
    for (const p of positions.values()) occupied.add(cell(p.x, p.y));
    for (const [r, stage] of stages) {
      const rows = Math.ceil(Math.sqrt(stage.length * 1.6));
      const cols = Math.ceil(stage.length / rows);
      stage.forEach((id, i) => {
        if (positions.has(id)) return;
        const col = Math.floor(i / rows) - (cols - 1) / 2;
        const related = [...prev.get(id)!, ...next.get(id)!].filter((n) => positions.has(n));
        // Newly loaded ancestors/spenders extend the anchored investigation locally.
        const neighbor = anchor && related.length ? related[0] : undefined;
        const x = neighbor
          ? positions.get(neighbor)!.x + (rank.get(id)! - rank.get(neighbor)!) * spacing + col * 22
          : originX + r * spacing + col * 22;
        let y = originY + ((i % rows) - (rows - 1) / 2) * 26;
        while (occupied.has(cell(x, y))) y += 26;
        positions.set(id, { x, y, z: -col * 32 });
        occupied.add(cell(x, y));
      });
    }
    for (const id of component) {
      if (positions.has(id)) continue;
      const source = adjacent.get(id)!.find((id) => positions.has(id));
      const p = source ? positions.get(source)! : { x: originX, y: originY, z: 0 };
      let y = p.y - 24;
      while (occupied.has(cell(p.x + 48, y))) y -= 26;
      positions.set(id, { x: p.x + 48, y, z: p.z - 38 });
      occupied.add(cell(p.x + 48, y));
    }
    shelfBottom = Math.min(shelfBottom, ...component.map((id) => positions.get(id)!.y)) - 160;
  }
  return { revision: request.revision, positions: nodes.map((n) => [n.id, positions.get(n.id)!]) };
}
