import { describe, expect, it } from 'vitest';
import type { Position } from './flowLayout';
import {
  layoutTransactionSkeleton,
  type TransactionSkeletonEdge,
  type TransactionSkeletonNode,
} from './transactionSkeleton';

const node = (
  id: string,
  options: Partial<Omit<TransactionSkeletonNode, 'id'>> = {},
): TransactionSkeletonNode => ({
  id,
  incomingExtent: 12,
  outgoingExtent: 12,
  transverseExtent: 12,
  localMass: 1,
  ...options,
});
const edge = (source: string, target: string): TransactionSkeletonEdge => ({
  source,
  target,
  gap: 20,
  weight: 1,
});
const delta = (from: Position, to: Position) => ({
  x: to.x - from.x,
  y: to.y - from.y,
  z: to.z - from.z,
});
const normalized = (value: Position) => {
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};
const dot = (a: Position, b: Position) => a.x * b.x + a.y * b.y + a.z * b.z;

describe('transaction skeleton', () => {
  it('packs differently sized downstream subtrees into deterministic 3D branch cones', () => {
    const nodes = [node('root')],
      edges: TransactionSkeletonEdge[] = [];
    for (const [prefix, count] of [
      ['large', 7],
      ['medium', 6],
      ['small', 3],
    ] as const) {
      for (let index = 0; index < count; index++) nodes.push(node(`${prefix}-${index}`));
      edges.push(edge('root', `${prefix}-0`));
      for (let index = 1; index < count; index++)
        edges.push(edge(`${prefix}-${index - 1}`, `${prefix}-${index}`));
    }
    nodes.push(node('tiny'));
    edges.push(edge('root', 'tiny'));

    const result = layoutTransactionSkeleton(nodes, edges, 3),
      root = result.positions.get('root')!,
      large = normalized(delta(root, result.positions.get('large-0')!)),
      medium = normalized(delta(root, result.positions.get('medium-0')!)),
      small = normalized(delta(root, result.positions.get('small-0')!));
    // The largest subtree owns the continuing cone. Other substantial branches
    // receive genuinely different solid-angle sectors rather than world-Y lanes.
    expect(large.x).toBeGreaterThan(0.999);
    expect(dot(large, medium)).toBeLessThan(0.65);
    expect(dot(large, small)).toBeLessThan(0.65);
    const volume = Math.abs(
      large.x * (medium.y * small.z - medium.z * small.y) -
        large.y * (medium.x * small.z - medium.z * small.x) +
        large.z * (medium.x * small.y - medium.y * small.x),
    );
    expect(volume).toBeGreaterThan(0.3);
    const points = [...result.positions.values()];
    const span = (axis: keyof Position) =>
      Math.max(...points.map((point) => point[axis])) -
      Math.min(...points.map((point) => point[axis]));
    expect(span('y')).toBeGreaterThan(200);
    expect(span('z')).toBeGreaterThan(100);
    expect(span('x') / Math.max(span('y'), span('z'))).toBeLessThan(1.5);
    for (const item of edges)
      expect(result.positions.get(item.target)!.x).toBeGreaterThan(
        result.positions.get(item.source)!.x,
      );

    const reversed = layoutTransactionSkeleton([...nodes].reverse(), [...edges].reverse(), 3);
    expect([...reversed.positions]).toEqual([...result.positions]);
  });

  it('uses descendant mass rather than identifier order to choose the continuing branch', () => {
    const nodes = [node('root'), node('a-tiny')],
      edges = [edge('root', 'a-tiny')];
    for (let index = 0; index < 6; index++) nodes.push(node(`z-large-${index}`));
    edges.push(edge('root', 'z-large-0'));
    for (let index = 1; index < 6; index++)
      edges.push(edge(`z-large-${index - 1}`, `z-large-${index}`));
    const result = layoutTransactionSkeleton(nodes, edges, 3),
      root = result.positions.get('root')!;
    expect(normalized(delta(root, result.positions.get('z-large-0')!)).x).toBeGreaterThan(0.999);
    expect(normalized(delta(root, result.positions.get('a-tiny')!)).x).toBeLessThan(0.65);
  });

  it('uses a high fan-in transaction as one spatial branch point on both chronology sides', () => {
    const nodes = [node('join', { localMass: 80 })],
      edges: TransactionSkeletonEdge[] = [];
    for (let index = 0; index < 24; index++) {
      const id = `parent-${index.toString().padStart(2, '0')}`;
      nodes.push(node(id));
      edges.push(edge(id, 'join'));
    }
    for (let branch = 0; branch < 4; branch++) {
      let parent = 'join';
      for (let generation = 0; generation < 4 - Math.floor(branch / 2); generation++) {
        const id = `child-${branch}-${generation}`;
        nodes.push(node(id));
        edges.push(edge(parent, id));
        parent = id;
      }
    }
    const result = layoutTransactionSkeleton(nodes, edges, 3),
      join = result.positions.get('join')!,
      parents = nodes
        .filter((item) => item.id.startsWith('parent-'))
        .map((item) => ({ id: item.id, position: result.positions.get(item.id)! }));
    expect(parents.every(({ position }) => position.x < join.x)).toBe(true);
    expect(
      [0, 1, 2, 3].every((branch) => result.positions.get(`child-${branch}-0`)!.x > join.x),
    ).toBe(true);
    const span = (axis: 'y' | 'z') =>
      Math.max(...parents.map(({ position }) => position[axis])) -
      Math.min(...parents.map(({ position }) => position[axis]));
    expect(span('y')).toBeGreaterThan(50);
    expect(span('z')).toBeGreaterThan(50);
  });

  it('extends retained branches without moving them and assigns new siblings an open sector', () => {
    const initialNodes = [node('root'), node('a'), node('a-1'), node('b')],
      initialEdges = [edge('root', 'a'), edge('a', 'a-1'), edge('root', 'b')];
    const initial = layoutTransactionSkeleton(initialNodes, initialEdges, 3);
    const retainedNodes = initialNodes.map((item) =>
      node(item.id, { position: initial.positions.get(item.id) }),
    );
    const expandedNodes = [...retainedNodes, node('a-2'), node('c')],
      expandedEdges = [...initialEdges, edge('a-1', 'a-2'), edge('root', 'c')];
    const expanded = layoutTransactionSkeleton(expandedNodes, expandedEdges, 3);
    for (const [id, position] of initial.positions)
      expect(expanded.positions.get(id)).toEqual(position);

    const a = initial.positions.get('a')!,
      a1 = initial.positions.get('a-1')!,
      a2 = expanded.positions.get('a-2')!;
    expect(dot(normalized(delta(a, a1)), normalized(delta(a1, a2)))).toBeGreaterThan(0.999);
    const root = initial.positions.get('root')!,
      c = normalized(delta(root, expanded.positions.get('c')!)),
      established = ['a', 'b'].map((id) => normalized(delta(root, initial.positions.get(id)!)));
    expect(Math.max(...established.map((direction) => dot(direction, c)))).toBeLessThan(0.8);
  });

  it('roots an expanded component in retained topology when a new hub has higher degree', () => {
    const initialNodes = [node('root'), node('stem')],
      initialEdges = [edge('root', 'stem')],
      initial = layoutTransactionSkeleton(initialNodes, initialEdges, 3),
      retained = initialNodes.map((item) =>
        node(item.id, { position: initial.positions.get(item.id) }),
      ),
      expandedNodes = [...retained, node('junction')],
      expandedEdges = [...initialEdges, edge('stem', 'junction')];
    for (let index = 0; index < 8; index++) {
      expandedNodes.push(node(`new-${index}`));
      expandedEdges.push(edge('junction', `new-${index}`));
    }
    const expanded = layoutTransactionSkeleton(expandedNodes, expandedEdges, 3);
    for (const [id, position] of initial.positions)
      expect(expanded.positions.get(id)).toEqual(position);

    const root = initial.positions.get('root')!,
      stem = initial.positions.get('stem')!,
      junction = expanded.positions.get('junction')!;
    expect(dot(normalized(delta(root, stem)), normalized(delta(stem, junction)))).toBeGreaterThan(
      0.999,
    );
    expect(junction.x).toBeGreaterThan(stem.x);
  });

  it('chooses one spatial parent for a reconnection without duplicating or mutating DAG nodes', () => {
    const nodes = [node('root'), node('left'), node('right'), node('join'), node('tail')],
      edges = [
        edge('root', 'left'),
        edge('root', 'right'),
        edge('left', 'join'),
        edge('right', 'join'),
        edge('join', 'tail'),
      ],
      before = structuredClone({ nodes, edges });
    const result = layoutTransactionSkeleton(nodes, edges, 3);
    expect(result.positions.size).toBe(nodes.length);
    expect([...result.positions.keys()].sort()).toEqual(nodes.map((item) => item.id).sort());
    expect(new Set([...result.positions.values()].map((point) => JSON.stringify(point))).size).toBe(
      nodes.length,
    );
    expect({ nodes, edges }).toEqual(before);
  });
});
