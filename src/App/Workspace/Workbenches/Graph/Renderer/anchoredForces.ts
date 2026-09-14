import type { Force, SimulationNode } from 'd3-force-3d';
import type { Position } from './flowLayout';
export type Particle = SimulationNode & { radius: number; center: Position };
type Obstacle = Position & { radius: number };
const clearance = (radius: number) => radius * 1.4 + 3;

/** Radius-bounded local collisions need only adjacent grid cells. A numeric grid
 * avoids rebuilding and visiting an octree for every particle on every tick. */
export function particleCollisions(moving: Particle[], dimensions: 2 | 3): Force<Particle> {
  const radii = moving.map((n) => clearance(n.radius));
  let cellSize = 1;
  for (const radius of radii) cellSize = Math.max(cellSize, radius * 2);
  const xs = new Float64Array(moving.length);
  const ys = new Float64Array(moving.length);
  const zs = new Float64Array(moving.length);
  const cells = new Map<number, Map<number, Map<number, number[]>>>();
  return () => {
    cells.clear();
    for (let i = 0; i < moving.length; i++) {
      const n = moving[i];
      xs[i] = n.x! + n.vx!;
      ys[i] = n.y! + n.vy!;
      zs[i] = dimensions === 3 ? n.z! + n.vz! : 0;
      const x = Math.floor(xs[i] / cellSize);
      const y = Math.floor(ys[i] / cellSize);
      const z = Math.floor(zs[i] / cellSize);
      let column = cells.get(x);
      if (!column) cells.set(x, (column = new Map()));
      let row = column.get(y);
      if (!row) column.set(y, (row = new Map()));
      let bucket = row.get(z);
      if (!bucket) row.set(z, (bucket = []));
      bucket.push(i);
    }
    for (let i = 0; i < moving.length; i++) {
      const n = moving[i];
      const cx = Math.floor(xs[i] / cellSize);
      const cy = Math.floor(ys[i] / cellSize);
      const cz = Math.floor(zs[i] / cellSize);
      for (let x = cx - 1; x <= cx + 1; x++) {
        const column = cells.get(x);
        if (!column) continue;
        for (let y = cy - 1; y <= cy + 1; y++) {
          const row = column.get(y);
          if (!row) continue;
          for (let z = dimensions === 3 ? cz - 1 : 0; z <= (dimensions === 3 ? cz + 1 : 0); z++) {
            const bucket = row.get(z);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              let dx = xs[i] - xs[j],
                dy = ys[i] - ys[j],
                dz = zs[i] - zs[j];
              const radius = radii[i] + radii[j];
              let squared = dx * dx + dy * dy + dz * dz;
              if (squared >= radius * radius) continue;
              if (squared < 1e-12) {
                // Separate coincident particles consistently, including in Flat mode.
                const angle = (i + j + 1) * 2.399963229728653;
                dx = Math.cos(angle) * 1e-6;
                dy = Math.sin(angle) * 1e-6;
                dz = dimensions === 3 ? 1e-6 : 0;
                squared = dx * dx + dy * dy + dz * dz;
              }
              const distance = Math.sqrt(squared);
              const push = (radius - distance) / distance;
              const weight = radii[j] ** 2 / (radii[i] ** 2 + radii[j] ** 2);
              const other = moving[j];
              n.vx! += dx * push * weight;
              n.vy! += dy * push * weight;
              other.vx! -= dx * push * (1 - weight);
              other.vy! -= dy * push * (1 - weight);
              if (dimensions === 3) {
                n.vz! += dz * push * weight;
                other.vz! -= dz * push * (1 - weight);
              }
            }
          }
        }
      }
    }
  };
}

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
