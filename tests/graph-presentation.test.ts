import { describe, expect, it } from 'vitest';
import {
  presentGraph,
  resolveGraphHit,
  type GraphPalette,
} from '../src/components/graph/presentation';
import type { GraphNode, GraphLink } from '../src/domain/types';
const nodes: GraphNode[] = [
  { id: 'tx', kind: 'transaction', label: 'Transaction', value: 10000 },
  { id: 'out', kind: 'output', label: 'Output', value: 10000, cluster: 'finding' },
  { id: 'spend', kind: 'transaction', label: 'Spending transaction' },
  { id: 'addr', kind: 'address', label: 'Address' },
];
const links: GraphLink[] = [
  { id: 'create', source: 'tx', target: 'out', kind: 'creates' },
  { id: 'spending', source: 'out', target: 'spend', kind: 'spends' },
  { id: 'address', source: 'out', target: 'addr', kind: 'address' },
];
const palette: GraphPalette = {
  transaction: '#111111',
  output: '#222222',
  address: '#333333',
  accent: '#444444',
  muted: '#555555',
  background: '#000000',
};
const input = { nodes, links, dimensions: 2 as const, sizeBy: 'uniform' as const, glow: true };
describe('shared graph semantics and presentation', () => {
  it('routes node and all edge kinds to the same entity for selection, trace and edit', () => {
    expect(resolveGraphHit({ type: 'node', id: 'tx' }, nodes, links)?.id).toBe('tx');
    for (const id of ['create', 'spending'])
      expect(resolveGraphHit({ type: 'link', id }, nodes, links)?.id).toBe('out');
    expect(resolveGraphHit({ type: 'link', id: 'address' }, nodes, links)?.id).toBe('addr');
    expect(resolveGraphHit({ type: 'link', id: 'tx' }, nodes, links)).toBeUndefined();
    expect(resolveGraphHit({ type: 'node', id: 'gone' }, nodes, links)).toBeUndefined();
  });
  it('resolves optional visuals without leaking wallet, tag, transaction or finding semantics', () => {
    const frame = presentGraph(
      {
        ...input,
        nodePresentation: new Map([['out', { color: '#ff0000', highlight: false, scale: 2 }]]),
      },
      palette,
    );
    expect(frame.nodes[1]).toMatchObject({
      shape: 'sphere',
      color: '#ff0000',
      radius: 6.4,
      highlight: false,
    });
    expect(frame.nodes[0]).toMatchObject({ shape: 'box', color: palette.transaction });
    expect(frame.nodes[3].shape).toBe('octahedron');
    for (const node of frame.nodes)
      for (const field of ['label', 'kind', 'cluster', 'value', 'txid', 'address'])
        expect(node).not.toHaveProperty(field);
    expect(frame.links[0]).not.toHaveProperty('kind');
    const selected = presentGraph(
      {
        ...input,
        selectedId: 'out',
        nodePresentation: new Map([['out', { color: '#ff0000', highlight: false }]]),
      },
      palette,
    );
    expect(selected.nodes[1]).toMatchObject({ color: palette.accent, highlight: true });
    expect(selected.links.map((link) => link.arrowLength)).toEqual([3, 3, 0]);
    expect(selected.links.every((link) => link.width === 0.65)).toBe(true);
    expect(
      presentGraph({ ...input, glow: false }, palette).nodes.every((node) => !node.highlight),
    ).toBe(true);
  });
  it('filters missing endpoints before degree sizing and restores defaults when overrides disappear', () => {
    const frame = presentGraph({ ...input, nodes: nodes.slice(0, 2), sizeBy: 'degree' }, palette);
    expect(frame.links).toHaveLength(1);
    expect(frame.nodes[1].radius).toBeCloseTo(3.2 * Math.cbrt(2));
    expect(frame.nodes[1].highlight).toBe(true);
    expect(frame.nodes[1].color).toMatch(/^hsl/);
    expect(
      presentGraph({ ...input, nodePresentation: new Map([['out', { scale: NaN }]]) }, palette)
        .nodes[1].radius,
    ).toBe(3.2);
  });
});
