import { compactLayout } from '../src/components/graph/compactLayout';
import { describe, expect, it } from 'vitest';
import type { LayoutRequest } from '../src/components/graph/flowLayout';
import { particleCollisions, type Particle } from '../src/components/graph/anchoredForces';
const fixture = (count = 1): LayoutRequest => ({
  revision: 1,
  previous: [],
  nodes: [
    { id: 'transaction', shape: 'box' },
    ...Array.from({ length: count }, (_, i) => ({ id: `input-${i}`, shape: 'sphere' as const })),
    ...Array.from({ length: count }, (_, i) => ({ id: `output-${i}`, shape: 'sphere' as const })),
    { id: 'address', shape: 'octahedron' },
  ],
  links: [
    ...Array.from({ length: count }, (_, i) => ({ source: `input-${i}`, target: 'transaction' })),
    ...Array.from({ length: count }, (_, i) => ({ source: 'transaction', target: `output-${i}` })),
    { source: 'output-0', target: 'address' },
  ],
});
describe('compact force layout', () => {
  it('settles a dense hub into a rounded 3D neighborhood without changing or dropping data', () => {
    const request = fixture(140),
      before = structuredClone(request);
    const result = compactLayout(request);
    expect(request).toEqual(before);
    expect(result.positions).toHaveLength(request.nodes.length);
    expect(
      compactLayout({
        ...request,
        nodes: [...request.nodes].reverse(),
        links: [...request.links].reverse(),
      }),
    ).toEqual(result);
    const spans = ['x', 'y', 'z'].map((axis) => {
      const values = result.positions.map(([, p]) => p[axis as keyof typeof p]);
      return Math.max(...values) - Math.min(...values);
    });
    expect(Math.max(...spans) / Math.min(...spans)).toBeLessThan(1.5);
    expect(result.positions.every(([, p]) => Object.values(p).every(Number.isFinite))).toBe(true);
    expect(new Set(result.positions.map(([, p]) => JSON.stringify(p))).size).toBe(
      request.nodes.length,
    );
  });
  it('reduces sparse path travel and resolves Flat geometry in two dimensions', () => {
    const request: LayoutRequest = {
      revision: 1,
      previous: [],
      nodes: Array.from({ length: 12 }, (_, i) => ({
        id: `${i}`,
        shape: i % 2 ? 'sphere' : 'box',
      })),
      links: Array.from({ length: 11 }, (_, i) => ({ source: `${i}`, target: `${i + 1}` })),
    };
    const diameter = (result: ReturnType<typeof compactLayout>) =>
      Math.max(
        ...result.positions.flatMap(([, a]) =>
          result.positions.map(([, b]) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)),
        ),
      );
    expect(diameter(compactLayout(request))).toBeLessThan(400);
    const flat = compactLayout({ ...request, dimensions: 2 });
    expect(flat.positions.every(([, p]) => p.z === 0)).toBe(true);
    expect(new Set(flat.positions.map(([, p]) => `${p.x},${p.y}`)).size).toBe(12);
  });
  it('anchors saved nodes across expansion, filtering and radius changes, including explicit coordinates', () => {
    const request = fixture(10);
    request.nodes.push({ id: 'pinned', shape: 'box', fx: 400, fy: 10, fz: -30 });
    const previous = compactLayout(request).positions;
    const expanded = {
      ...request,
      previous,
      nodes: [
        ...request.nodes.map((n) => ({ ...n, radius: 20 })),
        { id: 'hop', shape: 'box' as const },
      ],
      links: [...request.links, { source: 'output-0', target: 'hop' }],
    };
    const result = new Map(compactLayout(expanded).positions);
    for (const [id, p] of previous) expect(result.get(id)).toEqual(p);
    expect(result.get('pinned')).toEqual({ x: 400, y: 10, z: -30 });
    const output = result.get('output-0')!,
      hop = result.get('hop')!;
    expect(Math.hypot(output.x - hop.x, output.y - hop.y, output.z - hop.z)).toBeLessThan(120);
    const hidden = compactLayout({
      ...expanded,
      previous: [...result],
      nodes: expanded.nodes.filter((n) => n.id !== 'output-0'),
    });
    expect(
      new Map(
        compactLayout({ ...expanded, previous: [...previous, ...hidden.positions] }).positions,
      ),
    ).toEqual(result);
  });
});

it('places additions around nearby fixed obstacles without moving or dropping unrelated observations', () => {
  const request: LayoutRequest = { revision: 1, dimensions: 2, nodes: [], links: [], previous: [] };
  for (let i = 0; i < 1500; i++) {
    const id = `fixed-${i}`;
    request.nodes.push({ id, shape: 'sphere', radius: 5 });
    request.previous.push([id, { x: (i % 50) * 24, y: Math.floor(i / 50) * 24, z: 0 }]);
  }
  request.nodes.push({ id: 'new', shape: 'box', radius: 5 });
  request.links.push({ source: 'fixed-51', target: 'new' });
  const before = structuredClone(request);
  const result = new Map(compactLayout(request).positions);
  expect(result.size).toBe(1501);
  for (const [id, p] of request.previous) expect(result.get(id)).toEqual(p);
  const added = result.get('new')!;
  const distance = (p: { x: number; y: number }) => Math.hypot(added.x - p.x, added.y - p.y);
  expect(Math.min(...request.previous.map(([, p]) => distance(p)))).toBeGreaterThan(10);
  expect(distance(result.get('fixed-51')!)).toBeLessThan(130);
  expect(request).toEqual(before);
  expect(
    compactLayout({
      ...request,
      nodes: [...request.nodes].reverse(),
      previous: [...request.previous].reverse(),
    }).positions,
  ).toEqual([...result]);
});

describe('local particle collisions', () => {
  const particle = (id: string, x: number, radius = 5): Particle => ({
    id,
    x,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius,
    center: { x: 0, y: 0, z: 0 },
  });

  it.each([2, 3] as const)(
    'separates overlaps across negative cell boundaries in %dD without affecting distant nodes',
    (dimensions) => {
      const nodes = [particle('left', -1, 5), particle('right', 1, 10), particle('distant', 500)];
      particleCollisions(nodes, dimensions)(1);
      expect(nodes[0].vx).toBeLessThan(0);
      expect(nodes[1].vx).toBeGreaterThan(0);
      // Larger nodes move less, while the complete overlapping distance is resolved.
      expect(Math.abs(nodes[0].vx!)).toBeGreaterThan(Math.abs(nodes[1].vx!));
      expect(nodes[1].x! + nodes[1].vx! - nodes[0].x! - nodes[0].vx!).toBeCloseTo(27);
      expect(nodes[2]).toEqual(particle('distant', 500));
      expect(nodes.every((n) => n.vz === 0)).toBe(true);
    },
  );

  it.each([2, 3] as const)(
    'separates coincident particles finitely and deterministically in %dD',
    (dimensions) => {
      const initial = [particle('a', 0), particle('b', 0)];
      const nodes = structuredClone(initial),
        repeated = structuredClone(initial);
      particleCollisions(nodes, dimensions)(1);
      particleCollisions(repeated, dimensions)(1);
      expect(nodes).toEqual(repeated);
      const velocities = nodes.flatMap((n) => [n.vx!, n.vy!, n.vz!]);
      expect(velocities.every(Number.isFinite)).toBe(true);
      expect(
        Math.hypot(
          nodes[0].vx! - nodes[1].vx!,
          nodes[0].vy! - nodes[1].vy!,
          nodes[0].vz! - nodes[1].vz!,
        ),
      ).toBeCloseTo(20);
      if (dimensions === 2) expect(nodes.every((n) => n.vz === 0)).toBe(true);
    },
  );
});
