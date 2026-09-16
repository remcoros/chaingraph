import { describe, expect, it, vi } from 'vitest';
import type { GraphAdapter, GraphFrame, NodeAppearancePatch } from './adapter';
import { GraphPresentationUpdates } from './presentationUpdates';
import {
  buildGraphPresentationIndex,
  presentGraph,
  type GraphPalette,
  type GraphPresentationInput,
  type NodePresentation,
} from './presentation';

const palette: GraphPalette = {
  transaction: '#112233',
  output: '#223344',
  address: '#334455',
  accent: '#445566',
  muted: '#556677',
  background: '#000000',
};
const input: GraphPresentationInput = {
  nodes: [
    { id: 'tx', kind: 'transaction', label: 'Transaction' },
    { id: 'out', kind: 'output', label: 'Output' },
    { id: 'addr', kind: 'address', label: 'Address' },
  ],
  links: [{ id: 'create', source: 'tx', target: 'out', kind: 'creates' }],
  dimensions: 2,
  sizeBy: 'uniform',
  glow: true,
};

function harness(partial = true) {
  let frame: GraphFrame | undefined;
  const update = vi.fn((next: GraphFrame) => {
    frame = next;
  });
  const updateNodeAppearance = vi.fn((patches: readonly NodeAppearancePatch[]) => {
    const changes = new Map(patches.map((patch) => [patch.id, patch]));
    frame = {
      ...frame!,
      nodes: frame!.nodes.map((node) =>
        changes.has(node.id) ? { ...node, ...changes.get(node.id) } : node,
      ),
    };
  });
  const adapter: GraphAdapter = {
    canvas: {} as HTMLCanvasElement,
    update,
    ...(partial ? { updateNodeAppearance } : {}),
    resize() {},
    focus() {},
    fit() {},
    dispose() {},
  };
  const controller = new GraphPresentationUpdates();
  const render = (next = input, colors = palette) =>
    controller.update(adapter, next, colors, buildGraphPresentationIndex(next.nodes, next.links));
  return { adapter, controller, render, update, updateNodeAppearance, frame: () => frame! };
}

describe('incremental graph presentation', () => {
  it('skips bookmark-equivalent, cloned and invisible override changes', () => {
    const h = harness();
    const next = {
      ...input,
      nodePresentation: new Map<string, NodePresentation>([['tx', { label: '' }]]),
    };
    h.render(next);
    h.render({ ...next, nodePresentation: new Map([['tx', { label: '' }]]) });
    h.render({
      ...next,
      nodePresentation: new Map([
        ['tx', { label: '' }],
        ['offscreen', { label: 'Changed' }],
      ]),
    });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.updateNodeAppearance).not.toHaveBeenCalled();
    const hidden = { ...input, showLabels: false, showIcons: false, showTags: false, glow: false };
    h.render(hidden);
    h.render({
      ...hidden,
      nodePresentation: new Map([
        ['tx', { label: 'Hidden', icon: 'lock', tags: ['Cold'], highlight: true }],
      ]),
    });
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.updateNodeAppearance).not.toHaveBeenCalled();
  });

  it('patches single and batch annotations and clears them without touching unrelated visuals', () => {
    const h = harness();
    h.render(input);
    const initial = h.frame();
    const one = {
      ...input,
      nodePresentation: new Map([
        [
          'tx',
          { label: 'Savings', icon: 'lock', tags: ['Cold'], color: '#ff0000', highlight: true },
        ],
      ]),
    };
    h.render(one);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.updateNodeAppearance.mock.calls[0][0]).toEqual([
      {
        id: 'tx',
        text: 'lock Savings\n#Cold',
        captionPriority: true,
        color: '#ff0000',
        highlight: true,
      },
    ]);
    expect(h.frame()).toEqual(presentGraph(one, palette));
    expect(h.frame().nodes[1]).toBe(initial.nodes[1]);
    expect(h.frame().links).toBe(initial.links);
    const batch = {
      ...input,
      nodePresentation: new Map<string, NodePresentation>([
        ['tx', { label: '', tags: [] }],
        ['out', { label: 'Change', tags: ['Wallet'] }],
      ]),
    };
    h.render(batch);
    expect(h.updateNodeAppearance.mock.calls[1][0].map((node) => node.id)).toEqual(['tx', 'out']);
    expect(h.frame().nodes[0].text).toBeUndefined();
    expect(h.frame()).toEqual(presentGraph(batch, palette));
    h.render(input);
    expect(h.updateNodeAppearance.mock.calls[2][0].map((node) => node.id)).toEqual(['tx', 'out']);
    expect(h.frame()).toEqual(initial);
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it('only reads source node visuals for changed overrides', () => {
    const readTransactionLabel = vi.fn(() => 'Transaction');
    const source = {
      ...input,
      nodes: [
        {
          ...input.nodes[0],
          get label() {
            return readTransactionLabel();
          },
        },
        ...input.nodes.slice(1),
      ],
    };
    const h = harness();
    h.render(source);
    readTransactionLabel.mockClear();
    h.render({ ...source, nodePresentation: new Map([['out', { tags: ['Changed'] }]]) });
    expect(readTransactionLabel).not.toHaveBeenCalled();
    expect(h.updateNodeAppearance.mock.calls[0][0].map((node) => node.id)).toEqual(['out']);
  });

  it('keeps earlier patches when size changes require a complete frame', () => {
    const h = harness();
    h.render();
    h.render({ ...input, nodePresentation: new Map([['tx', { label: 'First patch' }]]) });
    const next = {
      ...input,
      nodePresentation: new Map<string, NodePresentation>([
        ['tx', { label: 'First patch' }],
        ['out', { scale: 2 }],
      ]),
    };
    h.render(next);
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.updateNodeAppearance).toHaveBeenCalledTimes(1);
    expect(h.frame()).toEqual(presentGraph(next, palette));
    h.render({ ...next, nodePresentation: new Map([['tx', { label: 'First patch' }]]) });
    expect(h.update).toHaveBeenCalledTimes(3);
    expect(h.frame().nodes[1].radius).toBe(3.2);
  });

  it('falls back for adapters without patches, while still skipping unchanged visuals', () => {
    const h = harness(false);
    h.render();
    const next = { ...input, nodePresentation: new Map([['tx', { tags: ['Cold'] }]]) };
    h.render(next);
    const patched = h.frame();
    h.render({ ...next, nodePresentation: new Map([['tx', { tags: ['Cold'] }]]) });
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.frame()).toEqual(presentGraph(next, palette));
    expect(h.frame()).toBe(patched);
  });

  it('refreshes selection, flow, palette, rendering settings and topology with full frames', () => {
    const variants: Partial<GraphPresentationInput>[] = [
      { selectedId: 'out' },
      { batchSelectedIds: ['tx'] },
      { dimensions: 3 },
      { sizeBy: 'degree' },
      { glow: false },
      { showLabels: false },
      { showIcons: false },
      { showTags: false },
      { nodes: input.nodes.slice(0, 2) },
      { links: [] },
      {
        flowContext: {
          transactionId: 'tx',
          nodes: new Map([['out', 'output']]),
          links: new Map([['create', 'output']]),
        },
      },
    ];
    for (const variant of variants) {
      const h = harness();
      h.render();
      const next = { ...input, ...variant };
      h.render(next);
      expect(h.update).toHaveBeenCalledTimes(2);
      expect(h.frame()).toEqual(presentGraph(next, palette));
      expect(h.updateNodeAppearance).not.toHaveBeenCalled();
    }
    const h = harness();
    h.render();
    h.render(input, { ...palette });
    expect(h.update).toHaveBeenCalledTimes(1);
    const changed = { ...palette, accent: '#ff8800', output: '#ff8800' };
    h.render(input, changed);
    expect(h.update).toHaveBeenCalledTimes(2);
    expect(h.frame()).toEqual(presentGraph(input, changed));
    const replacement = harness();
    h.controller.update(replacement.adapter, input, changed);
    expect(replacement.update).toHaveBeenCalledTimes(1);
    expect(replacement.frame()).toEqual(presentGraph(input, changed));
  });
});
