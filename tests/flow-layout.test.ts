import { inferredAxis } from '../src/components/graph/flowOrientation';
import { compactLayout } from '../src/components/graph/compactLayout';
import { describe, expect, it } from 'vitest';
import type { LayoutRequest, Position } from '../src/components/graph/flowLayout';
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
// Normalized covariance determinant is positive only for genuinely spatial
// groups, including when a planar disc is tilted away from the world axes.
function spatialVolume(points: Position[]) {
  const axes = ['x', 'y', 'z'] as const;
  const means = axes.map(
    (axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length,
  );
  const matrix = axes.map((a, i) =>
    axes.map(
      (b, j) =>
        points.reduce((sum, p) => sum + (p[a] - means[i]) * (p[b] - means[j]), 0) / points.length,
    ),
  );
  const m = matrix,
    scale = Math.max(m[0][0], m[1][1], m[2][2]);
  return (
    (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])) /
    scale ** 3
  );
}
describe('grouped flow and generic compact layout', () => {
  it.each([1, -1] as const)(
    'continues a rotated clicked branch in direction %d and orients later side shells',
    (side) => {
      const graph: LayoutRequest = {
        revision: 1,
        dimensions: 3,
        nodes: [
          { id: 'known', shape: 'box' },
          { id: 'clicked', shape: 'sphere' },
          { id: 'opened', shape: 'box' },
        ],
        links:
          side === 1
            ? [
                { source: 'known', target: 'clicked', directed: true },
                { source: 'clicked', target: 'opened', directed: true },
              ]
            : [
                { source: 'opened', target: 'clicked', directed: true },
                { source: 'clicked', target: 'known', directed: true },
              ],
        previous: [
          ['known', { x: 0, y: 0, z: 0 }],
          ['clicked', { x: 20 * side, y: 30, z: 40 }],
        ],
        expansionOrigin: { nodeId: 'opened', anchorId: 'clicked' },
      };
      const opened = compactLayout(graph).positions,
        byId = new Map(opened),
        clicked = byId.get('clicked')!,
        hub = byId.get('opened')!;
      const hop = { x: hub.x - clicked.x, y: hub.y - clicked.y, z: hub.z - clicked.z };
      const length = Math.hypot(hop.x, hop.y, hop.z);
      expect(
        (hop.x * clicked.x + hop.y * clicked.y + hop.z * clicked.z) /
          (length * Math.hypot(clicked.x, clicked.y, clicked.z)),
      ).toBeGreaterThan(0.98);
      // Sparse groups retain bounded clearance beyond the clicked glyph.
      expect(length).toBeGreaterThan(50);
      expect(length).toBeLessThan(65);
      for (const [id, point] of graph.previous) expect(byId.get(id)).toEqual(point);
      for (let i = 0; i < 14; i++)
        for (const role of ['input', 'output']) {
          const id = `${role}-${i}`;
          graph.nodes.push({ id, shape: 'sphere', radius: 4 });
          graph.links.push(
            role === 'input'
              ? { source: id, target: 'opened', directed: true }
              : { source: 'opened', target: id, directed: true },
          );
        }
      graph.previous = opened;
      const sides = compactLayout(graph).positions,
        placed = new Map(sides);
      for (const [id, point] of opened) expect(placed.get(id)).toEqual(point);
      for (const [id, point] of sides) {
        const along =
          (((point.x - hub.x) * hop.x + (point.y - hub.y) * hop.y + (point.z - hub.z) * hop.z) *
            side) /
          length;
        if (id.startsWith('input')) expect(along).toBeLessThan(-8);
        if (id.startsWith('output')) expect(along).toBeGreaterThan(8);
      }
      expect(
        compactLayout({
          ...graph,
          nodes: [...graph.nodes].reverse(),
          links: [...graph.links].reverse(),
          previous: [...graph.previous].reverse(),
        }).positions,
      ).toEqual(sides);
      // Later side additions cannot change any displayed observation.
      graph.previous = sides;
      graph.nodes.push({ id: 'a-earlier-input', shape: 'sphere' });
      graph.links.push({ source: 'a-earlier-input', target: 'opened', directed: true });
      const later = new Map(compactLayout(graph).positions);
      for (const [id, point] of sides) expect(later.get(id)).toEqual(point);
      const extra = later.get('a-earlier-input')!;
      expect(
        ((extra.x - hub.x) * hop.x + (extra.y - hub.y) * hop.y + (extra.z - hub.z) * hop.z) * side,
      ).toBeLessThan(0);
    },
  );

  it('keeps a fresh or repacked sparse connection compact while giving incremental opening extra runway', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      nodes: [
        { id: 'known', shape: 'box' },
        { id: 'clicked', shape: 'sphere' },
        { id: 'opened', shape: 'box' },
      ],
      links: [
        { source: 'known', target: 'clicked', directed: true },
        { source: 'clicked', target: 'opened', directed: true },
      ],
      previous: [],
    };
    const fresh = compactLayout(graph).positions,
      byId = new Map(fresh);
    expect(byId.get('opened')!.x - byId.get('known')!.x).toBeLessThan(60);
    const retained = fresh.filter(([id]) => id !== 'opened');
    const incremental = new Map(
      compactLayout({
        ...graph,
        previous: retained,
        expansionOrigin: { nodeId: 'opened', anchorId: 'clicked' },
      }).positions,
    );
    const hop = incremental.get('opened')!.x - incremental.get('clicked')!.x;
    expect(hop).toBeGreaterThan(50);
    expect(hop).toBeLessThan(65);
    for (const [id, point] of retained) expect(incremental.get(id)).toEqual(point);
    expect(compactLayout(graph).positions).toEqual(fresh);
  });

  it('uses the requested clicked outpoint when several cached branches meet a new transaction', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      nodes: [
        { id: 'left', shape: 'box' },
        { id: 'right', shape: 'box' },
        { id: 'opened', shape: 'box' },
        { id: 'a-first', shape: 'sphere' },
        { id: 'z-clicked', shape: 'sphere' },
      ],
      links: [
        { source: 'left', target: 'a-first', directed: true },
        { source: 'a-first', target: 'opened', directed: true },
        { source: 'right', target: 'z-clicked', directed: true },
        { source: 'z-clicked', target: 'opened', directed: true },
      ],
      previous: [
        ['left', { x: -200, y: 0, z: 0 }],
        ['a-first', { x: -170, y: 0, z: 0 }],
        ['right', { x: 0, y: 0, z: 0 }],
        ['z-clicked', { x: 0, y: 30, z: 0 }],
      ],
      expansionOrigin: { nodeId: 'opened', anchorId: 'z-clicked' },
    };
    const placed = new Map(compactLayout(graph).positions),
      hub = placed.get('opened')!;
    expect(hub.y).toBeGreaterThan(50);
    expect(Math.abs(hub.x)).toBeLessThan(15);
    for (const [id, point] of graph.previous) expect(placed.get(id)).toEqual(point);
  });

  it('exits a clicked shell along its ray before placing the newly opened hub', () => {
    const points = [
      { x: 20, y: 0, z: 0 },
      { x: 80, y: 0, z: 0 },
      { x: 50, y: 30, z: 0 },
      { x: 50, y: -30, z: 0 },
      { x: 50, y: 0, z: 30 },
      { x: 50, y: 0, z: -30 },
    ];
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      nodes: [
        { id: 'known', shape: 'box' },
        { id: 'opened', shape: 'box' },
      ],
      links: [],
      previous: [['known', { x: 0, y: 0, z: 0 }]],
      expansionOrigin: { nodeId: 'opened', anchorId: 'output-0' },
    };
    for (let i = 0; i < points.length; i++) {
      const id = `output-${i}`;
      graph.nodes.push({ id, shape: 'sphere' });
      graph.links.push({ source: 'known', target: id, directed: true });
      graph.previous.push([id, points[i]]);
    }
    graph.links.push({ source: 'output-0', target: 'opened', directed: true });
    const placed = new Map(compactLayout(graph).positions),
      hub = placed.get('opened')!;
    expect(hub.x).toBeGreaterThan(90);
    expect(hub.x).toBeLessThan(145);
    expect(Math.hypot(hub.y, hub.z)).toBeLessThan(25);
    for (const [id, point] of graph.previous) expect(placed.get(id)).toEqual(point);
  });

  it.each([1, -1] as const)(
    'scales direction %d from the containing sphere boundary, regardless of which edge is clicked',
    (side) => {
      for (const size of [25, 160, 500]) {
        const center = side * (size + 20);
        const points = [
          { x: side * 20, y: 0, z: 0 },
          { x: side * (2 * size + 20), y: 0, z: 0 },
          { x: center, y: size, z: 0 },
          { x: center, y: -size, z: 0 },
          { x: center, y: 0, z: size },
          { x: center, y: 0, z: -size },
        ];
        const positions: Position[] = [];
        for (const clicked of [0, 1]) {
          const graph: LayoutRequest = {
            revision: 1,
            dimensions: 3,
            nodes: [
              { id: 'known', shape: 'box' },
              { id: 'opened', shape: 'box' },
              ...points.map((_, i) => ({ id: `io-${i}`, shape: 'sphere' as const })),
            ],
            links: points.map((_, i) =>
              side === 1
                ? { source: 'known', target: `io-${i}`, directed: true }
                : { source: `io-${i}`, target: 'known', directed: true },
            ),
            previous: [
              ['known', { x: 0, y: 0, z: 0 }],
              ...points.map((point, i): [string, Position] => [`io-${i}`, point]),
            ],
            expansionOrigin: { nodeId: 'opened', anchorId: `io-${clicked}` },
          };
          graph.links.push(
            side === 1
              ? { source: `io-${clicked}`, target: 'opened', directed: true }
              : { source: 'opened', target: `io-${clicked}`, directed: true },
          );
          const opened = new Map(compactLayout(graph).positions);
          const at = opened.get('opened')!;
          positions.push(at);
          const clearance = side * at.x - (2 * size + 20 + 5);
          expect(clearance).toBeGreaterThan(Math.max(40, size));
          expect(clearance).toBeLessThan(Math.max(40, size) + 30);
          expect(Math.hypot(at.y, at.z)).toBeLessThan(1e-6);
          for (const [id, point] of graph.previous) expect(opened.get(id)).toEqual(point);

          // A previously traced member stays in the same sphere, while a
          // separate repacked bridge and its large glyph cannot inflate it.
          graph.nodes.push(
            { id: 'traced', shape: 'box' },
            { id: 'remote', shape: 'box' },
            { id: 'far-bridge', shape: 'sphere', radius: 80 },
          );
          graph.previous.push(
            ['traced', { x: side * 7000, y: 1000, z: 0 }],
            ['remote', { x: side * 7000, y: 0, z: 0 }],
            ['far-bridge', { x: side * 6000, y: 0, z: 0 }],
          );
          graph.links.push(
            ...(side === 1
              ? [
                  { source: 'io-2', target: 'traced', directed: true },
                  { source: 'known', target: 'far-bridge', directed: true },
                  { source: 'far-bridge', target: 'remote', directed: true },
                ]
              : [
                  { source: 'traced', target: 'io-2', directed: true },
                  { source: 'far-bridge', target: 'known', directed: true },
                  { source: 'remote', target: 'far-bridge', directed: true },
                ]),
          );
          const withOtherBranches = new Map(compactLayout(graph).positions).get('opened')!;
          expect(
            Math.hypot(
              withOtherBranches.x - at.x,
              withOtherBranches.y - at.y,
              withOtherBranches.z - at.z,
            ),
          ).toBeLessThan(1e-6);
        }
        expect(Math.abs(positions[0].x - positions[1].x)).toBeLessThan(1e-6);
      }
    },
  );

  it.each([
    { x: 0, y: 40, z: 0 },
    { x: 0, y: 0, z: 40 },
    { x: 0, y: 0, z: 0 },
  ])('keeps flat vector expansion finite for vertical or degenerate rays %j', (clicked) => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 2,
      nodes: [
        { id: 'known', shape: 'box' },
        { id: 'clicked', shape: 'sphere' },
        { id: 'opened', shape: 'box' },
      ],
      links: [
        { source: 'known', target: 'clicked', directed: true },
        { source: 'clicked', target: 'opened', directed: true },
      ],
      previous: [
        ['known', { x: 0, y: 0, z: 0 }],
        ['clicked', clicked],
      ],
    };
    const placed = new Map(compactLayout(graph).positions);
    expect(placed.get('clicked')).toEqual(clicked);
    expect(placed.get('opened')!.z).toBe(0);
    expect(Object.values(placed.get('opened')!).every(Number.isFinite)).toBe(true);
  });

  it('continues an established tilted branch when a connector and transaction are added together', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      nodes: [
        { id: 'known', shape: 'box' },
        { id: 'old-output', shape: 'sphere' },
        { id: 'new-bridge', shape: 'sphere' },
        { id: 'opened', shape: 'box' },
        { id: 'new-output', shape: 'sphere' },
      ],
      links: [
        { source: 'known', target: 'old-output', directed: true },
        { source: 'known', target: 'new-bridge', directed: true },
        { source: 'new-bridge', target: 'opened', directed: true },
        { source: 'opened', target: 'new-output', directed: true },
      ],
      previous: [
        ['known', { x: 0, y: 0, z: 0 }],
        ['old-output', { x: 0, y: 30, z: 40 }],
      ],
    };
    const placed = new Map(compactLayout(graph).positions),
      opened = placed.get('opened')!,
      output = placed.get('new-output')!;
    expect(Math.abs(opened.x)).toBeLessThan(1e-8);
    expect(opened.y).toBeGreaterThan(30);
    expect(opened.z).toBeGreaterThan(40);
    expect((output.y - opened.y) * 0.6 + (output.z - opened.z) * 0.8).toBeGreaterThan(8);
    for (const [id, point] of graph.previous) expect(placed.get(id)).toEqual(point);
  });

  it('does not let an incomplete coplanar shell override an established bridge direction', () => {
    const r = Math.sqrt(300),
      hub = { x: 0, y: 0, z: 0 },
      bridge = [{ x: 1, y: 0, z: 0 }];
    const points = [
      { x: 50 - r, y: 0, z: 10 },
      { x: 50 + r, y: 0, z: 10 },
      { x: 50, y: -r, z: 10 },
      { x: 50, y: r, z: 10 },
    ];
    expect(inferredAxis(hub, [{ side: 1, points }], bridge, false)).toEqual(bridge[0]);
    expect(inferredAxis(hub, [{ side: 1, points: points.slice(0, 3) }], bridge, false)).toEqual(
      bridge[0],
    );
  });

  it.each([2, 3] as const)(
    'rounds shared outpoints between the same transaction pair in %dD while preserving flow and anchors',
    (dimensions) => {
      const graph: LayoutRequest = {
        revision: 1,
        dimensions,
        previous: [],
        nodes: [
          { id: 'a', shape: 'box' },
          { id: 'b', shape: 'box' },
        ],
        links: [],
      };
      for (let i = 0; i < 80; i++) {
        const id = `bridge-${i}`;
        graph.nodes.push({ id, shape: 'sphere', radius: 5 });
        graph.links.push(
          { source: 'a', target: id, directed: true },
          { source: id, target: 'b', directed: true },
        );
      }
      const result = compactLayout(graph).positions,
        placed = new Map(result),
        points = result.filter(([id]) => id.startsWith('bridge')).map(([, point]) => point);
      expect(points).toHaveLength(80);
      if (dimensions === 3) expect(spatialVolume(points)).toBeGreaterThan(0.1);
      else expect(points.every((point) => point.z === 0)).toBe(true);
      for (const point of points) {
        expect(point.x).toBeGreaterThan(placed.get('a')!.x + 5);
        expect(point.x).toBeLessThan(placed.get('b')!.x - 5);
      }
      for (let i = 0; i < points.length; i++)
        for (let j = i + 1; j < points.length; j++)
          expect(
            Math.hypot(
              points[i].x - points[j].x,
              points[i].y - points[j].y,
              points[i].z - points[j].z,
            ),
          ).toBeGreaterThan(11.4);
      for (const axis of ['x', 'y', 'z'] as const)
        expect(
          Math.max(...points.map((point) => point[axis])) -
            Math.min(...points.map((point) => point[axis])),
        ).toBeLessThan(180);
      expect(compactLayout({ ...graph, previous: result }).positions).toEqual(result);
      expect(
        compactLayout({
          ...graph,
          nodes: [...graph.nodes].reverse(),
          links: [...graph.links].reverse(),
        }).positions,
      ).toEqual(result);
    },
  );

  it('keeps a fresh fan of distinct spending transactions and its direct outpoints genuinely spatial', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      previous: [],
      nodes: [{ id: 'root', shape: 'box' }],
      links: [],
    };
    for (let i = 0; i < 32; i++) {
      graph.nodes.push({ id: `tx-${i}`, shape: 'box' }, { id: `bridge-${i}`, shape: 'sphere' });
      graph.links.push(
        { source: 'root', target: `bridge-${i}`, directed: true },
        { source: `bridge-${i}`, target: `tx-${i}`, directed: true },
      );
    }
    const result = compactLayout(graph).positions,
      placed = new Map(result);
    for (const prefix of ['tx-', 'bridge-']) {
      const points = result.filter(([id]) => id.startsWith(prefix)).map(([, point]) => point);
      expect(spatialVolume(points)).toBeGreaterThan(0.01);
      for (const axis of ['x', 'y', 'z'] as const)
        expect(
          Math.max(...points.map((point) => point[axis])) -
            Math.min(...points.map((point) => point[axis])),
        ).toBeLessThan(260);
    }
    for (const link of graph.links)
      expect(placed.get(link.source)!.x).toBeLessThan(placed.get(link.target)!.x);
    expect(compactLayout({ ...graph, previous: result }).positions).toEqual(result);
    expect(
      compactLayout({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        links: [...graph.links].reverse(),
      }).positions,
    ).toEqual(result);
    const flat = compactLayout({ ...graph, dimensions: 2 }).positions;
    expect(flat.every(([, point]) => point.z === 0)).toBe(true);
  });

  it('orders reconverging transaction paths consistently on a fresh layout', () => {
    const graph: LayoutRequest = {
      revision: 1,
      previous: [],
      dimensions: 3,
      nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, shape: 'box' })),
      links: [],
    };
    for (const [source, target] of [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['a', 'd'],
    ]) {
      const id = `${source}-${target}`;
      graph.nodes.push({ id, shape: 'sphere' });
      graph.links.push(
        { source, target: id, directed: true },
        { source: id, target, directed: true },
      );
    }
    const placed = compactLayout(graph).positions;
    const byId = new Map(placed);
    for (const link of graph.links)
      expect(byId.get(link.target)!.x).toBeGreaterThan(byId.get(link.source)!.x);
    expect(
      compactLayout({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        links: [...graph.links].reverse(),
      }).positions,
    ).toEqual(placed);
    expect(compactLayout({ ...graph, previous: placed }).positions).toEqual(placed);
  });

  it('keeps a thousand shared outpoints in one compact bridge footprint', () => {
    const graph: LayoutRequest = {
      revision: 1,
      previous: [],
      dimensions: 3,
      nodes: [
        { id: 'a', shape: 'box' },
        { id: 'b', shape: 'box' },
      ],
      links: [],
    };
    for (let i = 0; i < 1000; i++) {
      const id = `shared-${i}`;
      graph.nodes.push({ id, shape: 'sphere' });
      graph.links.push(
        { source: 'a', target: id, directed: true },
        { source: id, target: 'b', directed: true },
      );
    }
    const placed = compactLayout(graph).positions,
      byId = new Map(placed);
    const shared = placed.filter(([id]) => id.startsWith('shared-'));
    const span = (axis: 'x' | 'y') =>
      Math.max(...shared.map(([, point]) => point[axis])) -
      Math.min(...shared.map(([, point]) => point[axis]));
    expect(shared).toHaveLength(1000);
    expect(span('x')).toBeLessThan(500);
    expect(span('y')).toBeLessThan(500);
    expect(span('x') / span('y')).toBeGreaterThan(0.8);
    expect(
      shared.every(([, point]) => point.x > byId.get('a')!.x && point.x < byId.get('b')!.x),
    ).toBe(true);
    expect(new Set(shared.map(([, point]) => JSON.stringify(point))).size).toBe(1000);
  });

  it.each([2, 3] as const)(
    'packs each side into a rounded %dD group with distinct glyph footprints',
    (dimensions) => {
      const request = fixture(80);
      request.dimensions = dimensions;
      request.nodes = request.nodes
        .filter((node) => node.id !== 'address')
        .map((node, i) => ({ ...node, radius: i % 3 === 0 ? 7 : 3.2 }));
      request.links = request.links
        .filter((link) => link.target !== 'address')
        .map((link) => ({ ...link, directed: true }));
      const result = new Map(compactLayout(request).positions);
      for (const prefix of ['input-', 'output-']) {
        const side = request.nodes.filter((node) => node.id.startsWith(prefix));
        for (let i = 0; i < side.length; i++)
          for (let j = i + 1; j < side.length; j++) {
            const a = result.get(side[i].id)!,
              b = result.get(side[j].id)!;
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
              side[i].radius! + side[j].radius! + 1.4,
            );
          }
        const span = (axis: 'x' | 'y' | 'z') => {
          const values = side.map((node) => result.get(node.id)![axis]);
          return Math.max(...values) - Math.min(...values);
        };
        expect(span('x') / span('y')).toBeGreaterThan(0.65);
        expect(span('x') / span('y')).toBeLessThan(1.5);
        if (dimensions === 2) expect(span('z')).toBe(0);
        else {
          expect(span('z')).toBeGreaterThan(Math.max(span('x'), span('y')) * 0.75);
          expect(span('z')).toBeLessThan(Math.max(span('x'), span('y')) * 1.5);
          const xs = side.map((node) => result.get(node.id)!.x);
          const ys = side.map((node) => result.get(node.id)!.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          const distances = side.map((node) => {
            const point = result.get(node.id)!;
            return Math.hypot(point.x - cx, point.y - cy, point.z);
          });
          expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(0.000001);
        }
      }
    },
  );

  it('gives a five-input five-output transaction visible depth on both sides', () => {
    const request = fixture(5);
    request.nodes = request.nodes.filter((node) => node.id !== 'address');
    request.links = request.links
      .filter((link) => link.target !== 'address')
      .map((link) => ({ ...link, directed: true }));
    const placed = compactLayout(request).positions;
    for (const prefix of ['input-', 'output-']) {
      const points = placed.filter(([id]) => id.startsWith(prefix)).map(([, point]) => point);
      expect(Math.max(...points.map((point) => point.z))).toBeGreaterThan(3);
      expect(Math.min(...points.map((point) => point.z))).toBeLessThan(-3);
    }
  });

  it('traces three creating transactions and adds their sides without moving existing observations', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      previous: [],
      nodes: [
        { id: 'root', shape: 'box' },
        { id: 'input-0', shape: 'sphere' },
      ],
      links: [{ source: 'input-0', target: 'root', directed: true }],
    };
    let positions = compactLayout(graph).positions;
    let current = 'input-0';
    for (let level = 1; level <= 3; level++) {
      const hub = `creator-${level}`;
      graph.nodes.push({ id: hub, shape: 'box' });
      graph.links.push({ source: hub, target: current, directed: true });
      graph.previous = positions;
      const opened = new Map(compactLayout(graph).positions);
      const at = opened.get(hub)!,
        outpoint = opened.get(current)!;
      expect(at.x).toBeLessThan(outpoint.x);
      expect(Math.hypot(at.x - outpoint.x, at.y - outpoint.y, at.z - outpoint.z)).toBeLessThan(160);
      for (const [id, point] of positions) expect(opened.get(id)).toEqual(point);
      graph.previous = [...opened];
      for (let i = 0; i < 5; i++) {
        const id = `input-${level}-${i}`;
        graph.nodes.push({ id, shape: 'sphere' });
        graph.links.push({ source: id, target: hub, directed: true });
      }
      positions = compactLayout(graph).positions;
      const withInputs = new Map(positions);
      for (const [id, point] of opened) expect(withInputs.get(id)).toEqual(point);
      for (let i = 0; i < 5; i++)
        expect(withInputs.get(`input-${level}-${i}`)!.x).toBeLessThan(at.x);
      current = `input-${level}-0`;
    }
    const repacked = new Map(compactLayout({ ...graph, previous: [] }).positions);
    for (const link of graph.links)
      expect(repacked.get(link.source)!.x).toBeLessThan(repacked.get(link.target)!.x);
    expect(repacked.size).toBe(graph.nodes.length);
  });

  it('opens an output creator nearby, then keeps newly added inputs upstream despite fixed obstacles', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      nodes: [{ id: 'output', shape: 'sphere', radius: 4 }],
      links: [],
      previous: [['output', { x: 0, y: 0, z: 0 }]],
    };
    graph.nodes.push({ id: 'creator', shape: 'box', radius: 4 });
    graph.links.push({ source: 'creator', target: 'output', directed: true });
    const opened = compactLayout(graph).positions;
    const hub = new Map(opened).get('creator')!;
    expect(hub.x).toBeLessThan(0);
    expect(Math.hypot(hub.x, hub.y, hub.z)).toBeLessThan(80);
    graph.previous = opened;
    // Occupy the natural upstream landing zone with saved, unrelated observations.
    for (let i = 0; i < 64; i++) {
      const id = `obstacle-${i}`;
      graph.nodes.push({ id, shape: 'sphere', radius: 5 });
      graph.previous.push([
        id,
        {
          x: hub.x - 18 - (i % 4) * 14,
          y: hub.y + ((Math.floor(i / 4) % 4) - 1.5) * 14,
          z: hub.z + (Math.floor(i / 16) - 1.5) * 14,
        },
      ]);
    }
    for (let i = 0; i < 120; i++) {
      const id = `input-${i}`;
      graph.nodes.push({ id, shape: 'sphere', radius: 4 });
      graph.links.push({ source: id, target: 'creator', directed: true });
    }
    const result = compactLayout(graph).positions;
    const byId = new Map(result);
    for (const [id, point] of graph.previous) expect(byId.get(id)).toEqual(point);
    const inputs = result.filter(([id]) => id.startsWith('input-'));
    expect(inputs.every(([, point]) => point.x <= hub.x - 6)).toBe(true);
    expect(new Set(inputs.map(([, point]) => point.x)).size).toBeGreaterThan(6);
    const nearest = Math.min(
      ...inputs.flatMap(([, point]) =>
        graph.previous
          .filter(([id]) => id.startsWith('obstacle-'))
          .map(([, fixed]) => Math.hypot(point.x - fixed.x, point.y - fixed.y, point.z - fixed.z)),
      ),
    );
    expect(nearest).toBeGreaterThan(9);
    expect(
      compactLayout({
        ...graph,
        nodes: [...graph.nodes].reverse(),
        links: [...graph.links].reverse(),
        previous: [...graph.previous].reverse(),
      }).positions,
    ).toEqual(result);
  });

  it('keeps sparse transaction hops compact and retains their anchors when sides are added', () => {
    const graph: LayoutRequest = {
      revision: 1,
      dimensions: 3,
      previous: [],
      nodes: [
        { id: 'a', shape: 'box' },
        { id: 'shared', shape: 'sphere' },
      ],
      links: [{ source: 'a', target: 'shared', directed: true }],
    };
    const initial = compactLayout(graph).positions;
    graph.nodes.push({ id: 'b', shape: 'box' });
    graph.links.push({ source: 'shared', target: 'b', directed: true });
    const sparse = compactLayout({ ...graph, previous: initial }).positions;
    const byId = new Map(sparse),
      a = byId.get('a')!,
      b = byId.get('b')!;
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(120);
    const shared = byId.get('shared')!;
    expect(Math.hypot(b.x - shared.x, b.y - shared.y, b.z - shared.z)).toBeLessThan(80);
    expect(b.x).toBeGreaterThan(shared.x);
    for (const [id, point] of initial) expect(byId.get(id)).toEqual(point);
    for (const hub of ['a', 'b']) {
      for (let i = 0; i < 90; i++) {
        if (hub !== 'b' || i !== 0) {
          const id = `${hub}-input-${i}`;
          graph.nodes.push({ id, shape: 'sphere' });
          graph.links.push({ source: id, target: hub, directed: true });
        }
        if (hub !== 'a' || i !== 0) {
          const id = `${hub}-output-${i}`;
          graph.nodes.push({ id, shape: 'sphere' });
          graph.links.push({ source: hub, target: id, directed: true });
        }
      }
    }
    const expanded = compactLayout({ ...graph, previous: sparse }).positions;
    const retained = new Map(expanded);
    for (const [id, point] of sparse) expect(retained.get(id)).toEqual(point);
    for (const [id, point] of expanded) {
      const hub = retained.get(id.slice(0, 1));
      if (!hub) continue;
      if (id.includes('-input-')) expect(point.x).toBeLessThan(hub.x);
      if (id.includes('-output-')) expect(point.x).toBeGreaterThan(hub.x);
    }
    expect(expanded).toHaveLength(graph.nodes.length);
    expect(expanded.every(([, point]) => Object.values(point).every(Number.isFinite))).toBe(true);
  });

  it('reserves separate 3D neighborhoods for connected CoinJoin hubs, including anchored expansion', () => {
    const graph: LayoutRequest = { revision: 1, dimensions: 3, previous: [], nodes: [], links: [] };
    const addHub = (id: string, shared: string[] = []) => {
      graph.nodes.push({ id, shape: 'box' });
      for (let i = 0; i < 90; i++) {
        const input = shared[i] ?? `${id}-input-${i}`;
        const output = `${id}-output-${i}`;
        if (!shared[i]) graph.nodes.push({ id: input, shape: 'sphere' });
        graph.nodes.push({ id: output, shape: 'sphere' });
        graph.links.push(
          { source: input, target: id, directed: true },
          { source: id, target: output, directed: true },
        );
      }
    };
    addHub('a');
    const original = compactLayout(graph).positions;
    // Multiple shared outpoints must not multiply the neighborhood repulsion.
    addHub('b', ['a-output-0', 'a-output-1', 'a-output-2']);
    addHub('c', ['a-output-3']);
    const fresh = compactLayout(graph).positions;
    const expanded = compactLayout({ ...graph, previous: original }).positions;
    const check = (positions: typeof fresh) => {
      const byId = new Map(positions);
      const distance = (a: string, b: string) => {
        const from = byId.get(a)!,
          to = byId.get(b)!;
        return Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      };
      expect(distance('a', 'b')).toBeGreaterThan(80);
      expect(distance('a', 'b')).toBeLessThan(500);
      expect(distance('a', 'c')).toBeGreaterThan(80);
      expect(distance('a', 'c')).toBeLessThan(500);
      expect(distance('b', 'c')).toBeGreaterThan(80);
      expect(distance('b', 'c')).toBeLessThan(500);
      expect(byId.get('b')!.x).toBeGreaterThan(byId.get('a')!.x);
      expect(byId.get('c')!.x).toBeGreaterThan(byId.get('a')!.x);
      expect(positions).toHaveLength(graph.nodes.length);
      expect(positions.every(([, point]) => Object.values(point).every(Number.isFinite))).toBe(
        true,
      );
    };
    check(fresh);
    check(expanded);
    const retained = new Map(expanded);
    for (const [id, point] of original) expect(retained.get(id)).toEqual(point);
    expect(
      compactLayout({
        ...graph,
        previous: [...original].reverse(),
        nodes: [...graph.nodes].reverse(),
        links: [...graph.links].reverse(),
      }).positions,
    ).toEqual(expanded);
  });

  it.each([2, 3] as const)(
    'separates an asymmetric dense transaction into incoming and outgoing neighborhoods in %dD',
    (dimensions) => {
      const request = fixture(90);
      request.dimensions = dimensions;
      request.nodes = request.nodes.filter(
        (node) => !node.id.startsWith('input-') || Number(node.id.slice(6)) < 8,
      );
      request.links = request.links.map((link) => ({
        ...link,
        directed: link.target !== 'address',
      }));
      const before = structuredClone(request);
      const positions = compactLayout(request).positions;
      const byId = new Map(positions),
        center = byId.get('transaction')!;
      const inputs = positions.filter(([id]) => id.startsWith('input-'));
      const outputs = positions.filter(([id]) => id.startsWith('output-'));
      expect(inputs.every(([, point]) => point.x < center.x - 8)).toBe(true);
      expect(outputs.every(([, point]) => point.x > center.x)).toBe(true);
      const transverse = outputs.map(([, point]) => point.y);
      expect(Math.max(...transverse) - Math.min(...transverse)).toBeGreaterThan(60);
      if (dimensions === 2) expect(positions.every(([, point]) => point.z === 0)).toBe(true);
      expect(
        compactLayout({
          ...request,
          nodes: [...request.nodes].reverse(),
          links: [...request.links].reverse(),
        }).positions,
      ).toEqual(positions);
      expect(request).toEqual(before);
    },
  );

  it('keeps shared outpoints between transactions and extends an anchored path downstream', () => {
    const request: LayoutRequest = {
      revision: 1,
      previous: [],
      nodes: Array.from({ length: 7 }, (_, i) => ({
        id: `path-${i}`,
        shape: i % 2 ? 'sphere' : 'box',
      })),
      links: Array.from({ length: 6 }, (_, i) => ({
        source: `path-${i}`,
        target: `path-${i + 1}`,
        directed: true,
      })),
    };
    const original = compactLayout(request).positions;
    const byId = new Map(original);
    for (const link of request.links)
      expect(byId.get(link.target)!.x).toBeGreaterThan(byId.get(link.source)!.x + 8);
    const expanded: LayoutRequest = {
      ...request,
      previous: original,
      nodes: [
        ...request.nodes,
        { id: 'next-output', shape: 'sphere' },
        { id: 'next-transaction', shape: 'box' },
      ],
      links: [
        ...request.links,
        { source: 'path-6', target: 'next-output', directed: true },
        { source: 'next-output', target: 'next-transaction', directed: true },
      ],
    };
    const placed = new Map(compactLayout(expanded).positions);
    for (const [id, point] of original) expect(placed.get(id)).toEqual(point);
    expect(placed.get('next-output')!.x).toBeGreaterThan(placed.get('path-6')!.x + 8);
    expect(placed.get('next-transaction')!.x).toBeGreaterThan(placed.get('next-output')!.x + 8);
    expect(placed.size).toBe(expanded.nodes.length);
    expect(
      compactLayout({
        ...expanded,
        previous: [...placed],
        nodes: expanded.nodes.filter((node) => node.id !== 'next-transaction'),
      }).positions,
    ).toEqual([...placed].filter(([id]) => id !== 'next-transaction'));
  });

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
