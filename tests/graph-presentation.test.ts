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
    expect(frame.nodes[0].text).toBe('Transaction');
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
    expect(selected.links.map((link) => link.arrowLength)).toEqual([4.5, 4.5, 0]);
    expect(selected.links.every((link) => link.width === 0.65)).toBe(true);
    expect(
      presentGraph({ ...input, glow: false }, palette).nodes.every((node) => !node.highlight),
    ).toBe(true);
  });
  it('shows direction on every funding and spending link and strengthens only the selected neighborhood', () => {
    const baseline = presentGraph(input, palette).links;
    expect(baseline.map((link) => link.arrowLength)).toEqual([3.6, 3.6, 0]);
    expect(baseline.every((link) => link.width === 0 && link.color === palette.muted)).toBe(true);
    const selected = presentGraph({ ...input, selectedId: 'tx' }, palette).links;
    expect(selected[0].arrowLength).toBeGreaterThan(baseline[0].arrowLength);
    expect(selected[0].width).toBeGreaterThan(baseline[0].width);
    expect(selected[0].color).toBe(palette.accent);
    expect(selected[0]).toMatchObject({ source: 'tx', target: 'out' });
    expect(selected[1]).toEqual(baseline[1]);
    expect(selected[2].arrowLength).toBe(0);
    const addressSelected = presentGraph({ ...input, selectedId: 'addr' }, palette).links;
    expect(addressSelected[2].arrowLength).toBe(0);
    expect(addressSelected[2].width).toBeGreaterThan(0);
  });
  it('independently projects annotation labels, tags and icons without generated IDs leaking through', () => {
    const nodePresentation = new Map([
      ['tx', { label: 'Exchange deposit', icon: '🏦', tags: ['Exchange', 'Savings'] }],
      ['out', { label: '', icon: '🔒', tags: ['Cold wallet'] }],
    ]);
    const render = (flags = {}) =>
      presentGraph({ ...input, nodePresentation, ...flags }, palette).nodes;
    expect(render()[0].text).toBe('🏦 Exchange deposit\n#Exchange · #Savings');
    expect(render({ showLabels: false })[0].text).toBe('🏦\n#Exchange · #Savings');
    expect(render({ showTags: false })[0].text).toBe('🏦 Exchange deposit');
    expect(render({ showIcons: false })[0].text).toBe('Exchange deposit\n#Exchange · #Savings');
    expect(render({ showIcons: false, showTags: false })[1].text).toBeUndefined();
    expect(
      render({ showLabels: false, showTags: false, showIcons: false }).every((node) => !node.text),
    ).toBe(true);
  });
  it('makes dust and large values visibly distinct while keeping broad Bitcoin ranges bounded', () => {
    const values = [
      0, 1, 300, 1000, 10000, 100000, 1000000, 100000000, 59849987177, 2100000000000000,
    ];
    const valueNodes: GraphNode[] = values.map((value, index) => ({
      id: String(index),
      kind: 'output',
      label: 'Output',
      value,
    }));
    const render = (items: GraphNode[]) =>
      presentGraph({ ...input, nodes: items, links: [], sizeBy: 'value' }, palette).nodes;
    const radii = render(valueNodes).map((node) => node.radius);
    expect(
      radii.every((radius) => Number.isFinite(radius) && radius >= 2.4 && radius <= 14.4),
    ).toBe(true);
    for (let index = 1; index < radii.length; index++)
      expect(radii[index]).toBeGreaterThan(radii[index - 1]);
    expect(radii[8] / radii[2]).toBeGreaterThan(5);
    expect(radii[8] / radii[2]).toBeLessThan(6);
    // Filtering or adding an unrelated whale must not resize existing values.
    expect(render([valueNodes[2], valueNodes[8]]).map((node) => node.radius)).toEqual([
      radii[2],
      radii[8],
    ]);
    expect(render([{ ...valueNodes[0], value: Number.MAX_VALUE }])[0].radius).toBe(14.4);
  });
  it('keeps missing and malformed values renderable and preserves intentional visual scale overrides', () => {
    for (const value of [undefined, NaN, Infinity, -1]) {
      const frame = presentGraph(
        { ...input, nodes: [{ ...nodes[0], value }], sizeBy: 'value' },
        palette,
      );
      expect(frame.nodes[0].radius).toBe(3.2);
    }
    const base = presentGraph({ ...input, sizeBy: 'value' }, palette).nodes[0].radius;
    const overridden = presentGraph(
      { ...input, sizeBy: 'value', nodePresentation: new Map([['tx', { scale: 1.5 }]]) },
      palette,
    );
    expect(overridden.nodes[0].radius).toBeCloseTo(base * 1.5);
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
