import { describe, expect, it } from 'vitest';
import {
  buildGraphPresentationIndex,
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
  it('reuses topology across display and selection changes without retaining stale visuals', () => {
    const index = buildGraphPresentationIndex(nodes, links);
    const before = structuredClone(index);
    const nodePresentation = new Map([
      ['out', { label: 'Savings', icon: '🔒', tags: ['Wallet'], color: '#ff0000', scale: 1.5 }],
    ]);
    const variants: Partial<Parameters<typeof presentGraph>[0]>[] = [
      { showLabels: false },
      { showTags: false },
      { showIcons: false },
      { glow: false },
      { sizeBy: 'value' },
      { sizeBy: 'degree' },
      { selectedId: 'out', batchSelectedIds: ['spend'] },
      { dimensions: 3 },
      {
        flowContext: {
          transactionId: 'spend',
          nodes: new Map([['out', 'input']]),
          links: new Map([['spending', 'input']]),
        },
      },
      { nodePresentation: undefined },
    ];
    for (const variant of variants) {
      const changed = { ...input, nodePresentation, ...variant };
      expect(presentGraph(changed, palette, index)).toEqual(presentGraph(changed, palette));
    }
    const selected = presentGraph(
      { ...input, nodePresentation, selectedId: 'out' },
      palette,
      index,
    );
    expect(selected.nodes[1]).toMatchObject({
      color: palette.accent,
      selected: true,
      text: '🔒 Savings\n#Wallet',
    });
    expect(presentGraph(input, palette, index).nodes[1]).toMatchObject({
      selected: false,
      text: 'Output',
      radius: 3.2,
    });
    expect(index).toEqual(before);
    expect(index.nodes).toBe(nodes);
    expect(index.links[0]).toBe(links[0]);
  });

  it('excludes dangling edges from reused topology and rebuilds when membership changes', () => {
    const visibleNodes = nodes.slice(0, 2);
    const index = buildGraphPresentationIndex(visibleNodes, links);
    const frame = presentGraph({ ...input, nodes: visibleNodes, sizeBy: 'degree' }, palette, index);
    expect(frame.links.map((link) => link.id)).toEqual(['create']);
    expect(frame.links[0].width).toBe(0);
    expect(frame.nodes[1].radius).toBeCloseTo(3.2 * Math.cbrt(2));
    const restored = presentGraph({ ...input, sizeBy: 'degree' }, palette, index);
    expect(restored.links[0].width).toBe(1);
    expect(restored.nodes[1].radius).toBeCloseTo(3.2 * Math.cbrt(1 + Math.sqrt(3)));
    const changedLinks = { ...input, nodes: visibleNodes, links: [] };
    expect(presentGraph(changedLinks, palette, index).links).toEqual([]);
    expect(index.links.map((link) => link.id)).toEqual(['create']);
  });

  it('marks active and batch flow neighborhoods without changing focus or treating annotations as selection', () => {
    const frame = presentGraph(
      { ...input, selectedId: 'tx', batchSelectedIds: ['spend'] },
      palette,
    );
    expect(frame.nodes.filter((node) => node.flowActive).map((node) => node.id)).toEqual([
      'tx',
      'spend',
    ]);
    expect(frame.nodes.filter((node) => node.selected).map((node) => node.id)).toEqual(['tx']);
    expect(frame.nodes.find((node) => node.id === 'out')?.highlight).toBe(true);
    expect(frame.nodes.find((node) => node.id === 'out')?.flowActive).toBe(false);
    expect(frame.links.filter((link) => link.directed).map((link) => link.id)).toEqual([
      'create',
      'spending',
    ]);
  });

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
    expect(selected.links.map((link) => link.arrowLength)).toEqual([5.5, 5.5, 0]);
    expect(selected.links.map((link) => link.width)).toEqual([1, 1, 0.65]);
    expect(
      presentGraph({ ...input, glow: false }, palette).nodes.every((node) => !node.highlight),
    ).toBe(true);
  });
  it('keeps visible transaction bridges legible and emphasizes selected terminal links', () => {
    const baseline = presentGraph(input, palette).links;
    expect(baseline.map((link) => link.arrowLength)).toEqual([5.5, 5.5, 0]);
    expect(baseline.map((link) => link.width)).toEqual([1, 1, 0]);
    expect(baseline.every((link) => link.color === palette.muted)).toBe(true);
    const selected = presentGraph({ ...input, selectedId: 'tx' }, palette).links;
    expect(selected[0].arrowLength).toBe(baseline[0].arrowLength);
    expect(selected[0].width).toBe(baseline[0].width);
    expect(selected[0].color).toBe(palette.accent);
    expect(selected[0]).toMatchObject({ source: 'tx', target: 'out' });
    expect(selected[1]).toEqual(baseline[1]);
    expect(selected[2].arrowLength).toBe(0);
    const terminal = { ...input, nodes: nodes.filter((node) => node.id !== 'spend') };
    const neutralTerminal = presentGraph(terminal, palette).links[0];
    const selectedTerminal = presentGraph({ ...terminal, selectedId: 'tx' }, palette).links[0];
    expect(neutralTerminal.width).toBe(0);
    expect(selectedTerminal.width).toBeGreaterThan(neutralTerminal.width);
    expect(selectedTerminal.arrowLength).toBeGreaterThan(neutralTerminal.arrowLength);
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
    expect(render({ glow: false })[1]).toMatchObject({
      captionPriority: true,
      highlight: false,
    });
    expect(render({ showLabels: false, showTags: false })[0].captionPriority).toBe(false);
    expect(render({ showTags: false })[0].captionPriority).toBe(true);
    expect(render({ showTags: false })[1].captionPriority).toBe(false);
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
    expect(radii.every((radius) => Number.isFinite(radius) && radius >= 1.6 && radius <= 12)).toBe(
      true,
    );
    for (let index = 1; index < radii.length; index++)
      expect(radii[index]).toBeGreaterThan(radii[index - 1]);
    expect(radii[4]).toBeGreaterThan(radii[2] * 1.15);
    expect(radii[8] / radii[2]).toBeGreaterThan(4);
    // Filtering or adding an unrelated whale must not resize existing values.
    expect(render([valueNodes[2], valueNodes[8]]).map((node) => node.radius)).toEqual([
      radii[2],
      radii[8],
    ]);
    const beyondSupply = render([{ ...valueNodes[0], value: Number.MAX_VALUE }])[0].radius;
    expect(Number.isFinite(beyondSupply)).toBe(true);
    expect(beyondSupply).toBeGreaterThan(radii.at(-1)!);
  });
  it('makes 150 million sats substantially larger than 20 thousand sats at a fixed absolute scale', () => {
    const small: GraphNode = { id: 'small', kind: 'output', label: 'Small', value: 20_000 };
    const large: GraphNode = { id: 'large', kind: 'output', label: 'Large', value: 150_000_000 };
    const render = (items: GraphNode[]) =>
      presentGraph({ ...input, nodes: items, links: [], sizeBy: 'value' }, palette).nodes;
    const radii = render([small, large]).map((node) => node.radius);
    expect(radii[0]).toBeGreaterThan(2);
    expect(radii[0]).toBeLessThan(2.2);
    expect(radii[1]).toBeGreaterThan(5);
    expect(radii[1]).toBeLessThan(5.6);
    expect(radii[1] / radii[0]).toBeGreaterThan(2.5);
    expect(radii[1] / radii[0]).toBeLessThan(2.8);
    expect((radii[1] / radii[0]) ** 2).toBeGreaterThan(6);
    expect(
      render([small, large, { ...large, id: 'whale', value: 2_100_000_000_000_000 }])
        .slice(0, 2)
        .map((node) => node.radius),
    ).toEqual(radii);
    expect(render([small])[0].radius).toBe(radii[0]);
    expect(render([large])[0].radius).toBe(radii[1]);
  });
  it('keeps increasing across large whale values without an early plateau', () => {
    const amounts = [59_849_955_894, 340_000_000_000, 1_000_000_000_000, 10_000_000_000_000];
    const valueNodes: GraphNode[] = amounts.map((value, index) => ({
      id: String(index),
      kind: 'output',
      label: 'Output',
      value,
    }));
    const render = (items: GraphNode[]) =>
      presentGraph({ ...input, nodes: items, links: [], sizeBy: 'value' }, palette).nodes;
    const radii = render(valueNodes).map((node) => node.radius);
    const diameterRatio = radii[1] / radii[0];
    expect(diameterRatio).toBeGreaterThan(1.08);
    expect(diameterRatio ** 2).toBeGreaterThan(1.16);
    for (let index = 1; index < radii.length; index++)
      expect(radii[index]).toBeGreaterThan(radii[index - 1]);
    expect(radii[3] - radii[0]).toBeGreaterThan(1.8);
    expect(radii.every((radius) => radius < 12)).toBe(true);
    // The same pair retains its proportions after unrelated large nodes disappear.
    expect(render(valueNodes.slice(0, 2)).map((node) => node.radius)).toEqual(radii.slice(0, 2));
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
