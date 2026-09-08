import type { Force, SimulationNode } from 'd3-force-3d';
import type { Position } from './flowLayout';
export type Particle = SimulationNode & { radius: number; center: Position };
type Obstacle = Position & { radius: number };
const clearance = (radius: number) => radius * 1.4 + 3;

/** Fixed geometry is indexed once, never integrated or put through a force tree
 * on every tick. This index affects placement only: drawing retains every node. */
export function anchoredForces(
  moving: Particle[],
  fixed: ReadonlyMap<string, Obstacle>,
  links: readonly { source: string; target: string }[],
  dimensions: 2 | 3,
): { tethers: Force<Particle>; obstacles: Force<Particle> } {
  const byId = new Map(moving.map((n) => [n.id, n]));
  const tethers: { node: Particle; anchor: Obstacle; length: number; weight: number }[] = [];
  const counts = new Map<string, number>();
  for (const l of links) {
    const node = byId.get(l.source) ?? byId.get(l.target);
    const anchor = fixed.get(l.source) ?? fixed.get(l.target);
    if (!node || !anchor) continue;
    counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    tethers.push({ node, anchor, length: node.radius + anchor.radius + 22, weight: 0 });
  }
  for (const tether of tethers) tether.weight = 0.35 / counts.get(tether.node.id)!;
  let maxRadius = 0;
  for (const p of [...moving, ...fixed.values()])
    maxRadius = Math.max(maxRadius, clearance(p.radius));
  const cellSize = Math.max(24, maxRadius * 2);
  const cells = new Map<string, Obstacle[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const p of fixed.values()) {
    const id = key(
      Math.floor(p.x / cellSize),
      Math.floor(p.y / cellSize),
      dimensions === 3 ? Math.floor(p.z / cellSize) : 0,
    );
    const bucket = cells.get(id) ?? [];
    bucket.push(p);
    cells.set(id, bucket);
  }
  return {
    tethers(alpha) {
      for (const { node: n, anchor: a, length, weight } of tethers) {
        const x = a.x - n.x!,
          y = a.y - n.y!,
          z = dimensions === 3 ? a.z - n.z! : 0;
        const distance = Math.hypot(x, y, z) || 1;
        const pull = ((distance - length) / distance) * alpha * weight;
        n.vx! += x * pull;
        n.vy! += y * pull;
        if (dimensions === 3) n.vz! += z * pull;
      }
    },
    obstacles() {
      for (const n of moving) {
        const px = n.x! + n.vx!,
          py = n.y! + n.vy!,
          pz = dimensions === 3 ? n.z! + n.vz! : 0;
        const cx = Math.floor(px / cellSize),
          cy = Math.floor(py / cellSize),
          cz = Math.floor(pz / cellSize);
        for (let x = cx - 1; x <= cx + 1; x++)
          for (let y = cy - 1; y <= cy + 1; y++)
            for (let z = dimensions === 3 ? cz - 1 : 0; z <= (dimensions === 3 ? cz + 1 : 0); z++)
              for (const a of cells.get(key(x, y, z)) ?? []) {
                let dx = px - a.x,
                  dy = py - a.y,
                  dz = dimensions === 3 ? pz - a.z : 0;
                let distance = Math.hypot(dx, dy, dz);
                const radius = clearance(n.radius) + clearance(a.radius);
                if (distance >= radius) continue;
                // Deterministic separation for exact coincident coordinates.
                if (distance < 0.001) {
                  dx = 0.001;
                  dy = 0.001;
                  dz = dimensions === 3 ? 0.001 : 0;
                  distance = Math.hypot(dx, dy, dz);
                }
                const push = (Math.min(radius, radius - distance) / distance) * 0.7;
                n.vx! += dx * push;
                n.vy! += dy * push;
                if (dimensions === 3) n.vz! += dz * push;
              }
      }
    },
  };
}
