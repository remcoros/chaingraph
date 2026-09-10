import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceZ,
  type SimulationLink,
} from 'd3-force-3d';
import type { LayoutRequest, LayoutResult, Position } from './flowLayout';
import { anchoredForces, particleCollisions, type Particle } from './anchoredForces';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hash = (id: string) => {
  let value = 2166136261;
  for (const c of id) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
};

/** Static, deterministic force layout. d3 mutates only worker-owned particles/links.
 * Fixed anchors preserve the investigation across expansion and visibility changes. */
export function compactLayout(request: LayoutRequest): LayoutResult {
  const dimensions = request.dimensions ?? 3;
  const anchors = new Map(request.previous);
  const nodes = [...request.nodes].sort((a, b) => compare(a.id, b.id));
  for (const n of nodes) {
    const x = n.fx ?? n.x,
      y = n.fy ?? n.y,
      z = n.fz ?? n.z;
    if (Number.isFinite(x) && Number.isFinite(y))
      anchors.set(n.id, { x: x!, y: y!, z: Number.isFinite(z) ? z! : 0 });
  }
  if (nodes.every((n) => anchors.has(n.id)))
    return {
      revision: request.revision,
      positions: nodes.map((n) => [n.id, { ...anchors.get(n.id)! }]),
    };
  const adjacent = new Map(nodes.map((n) => [n.id, [] as string[]]));
  const links = request.links
    .filter((l) => adjacent.has(l.source) && adjacent.has(l.target))
    .map((l) => ({ ...l }))
    .sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));
  for (const l of links) {
    adjacent.get(l.source)!.push(l.target);
    adjacent.get(l.target)!.push(l.source);
  }
  // Multi-source traversal seeds additions near their closest existing observation.
  const centers = new Map<string, Position>();
  const queue: string[] = [];
  for (const n of nodes)
    if (anchors.has(n.id)) {
      centers.set(n.id, anchors.get(n.id)!);
      queue.push(n.id);
    }
  for (let i = 0; i < queue.length; i++)
    for (const id of adjacent.get(queue[i])!) {
      if (centers.has(id)) continue;
      centers.set(id, centers.get(queue[i])!);
      queue.push(id);
    }
  const particles: Particle[] = nodes
    .filter((n) => !anchors.has(n.id))
    .map((n) => {
      const center = centers.get(n.id) ?? { x: 0, y: 0, z: 0 };
      const radius = Math.max(2.4, n.radius ?? 5);
      if (!centers.has(n.id)) return { id: n.id, radius, center };
      const angle = hash(n.id) * Math.PI * 2,
        height = hash(`${n.id}:z`) * 2 - 1;
      const span = radius + 24;
      return {
        id: n.id,
        radius,
        center,
        x: center.x + Math.cos(angle) * span,
        y: center.y + Math.sin(angle) * span,
        z: dimensions === 3 ? center.z + height * span : 0,
      };
    });
  const simulation = forceSimulation(particles, dimensions)
    .stop()
    .force(
      'links',
      forceLink<Particle>(
        links.filter(
          (l) => !anchors.has(l.source) && !anchors.has(l.target),
        ) as SimulationLink<Particle>[],
      )
        .id((n) => n.id)
        .distance((l) => (l.source as Particle).radius + (l.target as Particle).radius + 22),
    )
    .force('charge', forceManyBody<Particle>().strength(-32))
    .force('collision', particleCollisions(particles, dimensions))
    .force('x', forceX<Particle>((n) => n.center.x).strength(0.018))
    .force('y', forceY<Particle>((n) => n.center.y).strength(0.018));
  if (dimensions === 3) simulation.force('z', forceZ<Particle>((n) => n.center.z).strength(0.018));
  const fixed = new Map(
    nodes
      .filter((n) => anchors.has(n.id))
      .map((n) => [n.id, { ...anchors.get(n.id)!, radius: Math.max(2.4, n.radius ?? 5) }]),
  );
  if (fixed.size) {
    const forces = anchoredForces(particles, fixed, links, dimensions);
    simulation.force('tethers', forces.tethers).force('obstacles', forces.obstacles);
  }
  simulation.tick(180);
  const placed = new Map(
    particles.map((n) => [n.id, { x: n.x!, y: n.y!, z: dimensions === 3 ? n.z! : 0 }]),
  );
  return {
    revision: request.revision,
    positions: nodes.map((n) => [
      n.id,
      // Retain exact supplied/saved coordinates, even the hidden depth in Flat mode.
      anchors.get(n.id) ? { ...anchors.get(n.id)! } : placed.get(n.id)!,
    ]),
  };
}
