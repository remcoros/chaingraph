import { describe, expect, it } from 'vitest';
import type { RenderNode } from '../src/components/graph/adapter';
import { placeFlowCaptions, type FlowCaptionCandidate } from '../src/components/graph/flowCaptions';

const viewport = { width: 1800, height: 900, topInset: 30 };
const empty = new Set<string>();

function candidate(index: number, overrides: Partial<RenderNode> = {}): FlowCaptionCandidate {
  return {
    node: {
      id: `out:${index}`,
      text: `Output ${index}`,
      shape: 'sphere',
      color: '#ffffff',
      radius: 3.2,
      highlight: false,
      ...overrides,
    },
    x: 20 + (index % 10) * 170,
    y: 60 + Math.floor(index / 10) * 65,
    radius: 1,
  };
}

describe('flow caption placement', () => {
  it('shows repeated explicit tags on small outpoints independently of glow or selection', () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      candidate(i, { text: '#op_return', captionPriority: true }),
    );
    const before = structuredClone(candidates);
    const captions = placeFlowCaptions(candidates, viewport, empty);
    expect(captions.map((caption) => caption.node.id)).toEqual(
      candidates.map(({ node }) => node.id),
    );
    expect(captions.every((caption) => caption.text === '#op_return')).toBe(true);
    expect(candidates).toEqual(before);
  });

  it('keeps more than 48 explicit captions when there is room', () => {
    const candidates = Array.from({ length: 90 }, (_, i) =>
      candidate(i, { text: '#op_return', captionPriority: true }),
    );
    const captions = placeFlowCaptions(candidates, viewport, empty);
    expect(captions).toHaveLength(90);
    expect(new Set(captions.map(({ node }) => node.id)).size).toBe(90);
  });

  it('retains collision winners when a distant selection changes', () => {
    const first = { ...candidate(0, { captionPriority: true }), radius: 4 };
    const winner = { ...candidate(1, { captionPriority: true }), x: first.x, radius: 5 };
    const distant = candidate(9, { captionPriority: true });
    const baseline = placeFlowCaptions([first, winner, distant], viewport, empty);
    expect(baseline.map(({ node }) => node.id)).toEqual([winner.node.id, distant.node.id]);
    const previous = new Set(baseline.map(({ node }) => node.id));
    const selected = { ...distant, node: { ...distant.node, selected: true } };
    const next = placeFlowCaptions([selected, { ...first, radius: 6 }, winner], viewport, previous);
    expect(new Set(next.map(({ node }) => node.id))).toEqual(previous);
    expect(next.find(({ node }) => node.id === winner.node.id)).toEqual(baseline[0]);
    expect(previous).toEqual(new Set([winner.node.id, distant.node.id]));
  });

  it('prevents overlaps across spatial cell boundaries in a dense annotated cluster', () => {
    const candidates = Array.from({ length: 120 }, (_, i) => ({
      ...candidate(i, { text: '#op_return', captionPriority: true }),
      x: 110 + (i % 12) * 37,
      y: 110 + Math.floor(i / 12) * 17,
    }));
    const captions = placeFlowCaptions(candidates, viewport, empty);
    expect(captions.length).toBeGreaterThan(10);
    expect(captions.length).toBeLessThan(candidates.length);
    for (let i = 0; i < captions.length; i++)
      for (let j = i + 1; j < captions.length; j++) {
        const a = captions[i];
        const b = captions[j];
        expect(
          a.x < b.x + b.width + 6 &&
            a.x + a.width + 6 > b.x &&
            a.y < b.y + b.height + 4 &&
            a.y + a.height + 4 > b.y,
        ).toBe(false);
      }
  });

  it('keeps generated captions subject to radius, duplicate and total-caption limits', () => {
    const candidates = Array.from({ length: 80 }, (_, i) => ({ ...candidate(i), radius: 4 }));
    expect(placeFlowCaptions(candidates, viewport, empty)).toHaveLength(48);
    expect(placeFlowCaptions([candidate(0)], viewport, empty)).toEqual([]);
    const duplicate = candidates.slice(0, 3).map((entry) => ({
      ...entry,
      node: { ...entry.node, text: 'Generated' },
    }));
    expect(placeFlowCaptions(duplicate, viewport, empty)).toHaveLength(1);
    const priority = Array.from({ length: 60 }, (_, i) => candidate(i, { captionPriority: true }));
    expect(placeFlowCaptions([...priority, ...candidates.slice(60)], viewport, empty)).toHaveLength(
      60,
    );
  });

  it('preserves selected and hovered small captions ahead of repeated ordinary text', () => {
    const candidates = [
      candidate(0, { text: 'Repeated', selected: true }),
      candidate(1, { text: 'Repeated' }),
      { ...candidate(2, { text: 'Repeated' }), radius: 5 },
    ];
    const captions = placeFlowCaptions(candidates, viewport, empty, candidates[1].node.id);
    expect(captions.map(({ node }) => node.id)).toEqual([
      candidates[0].node.id,
      candidates[1].node.id,
    ]);
  });

  it('hides ordinary captions outside the usable viewport and clamps explicit captions', () => {
    const smallViewport = { width: 360, height: 180, topInset: 40 };
    const offscreen = { ...candidate(0), x: -500, radius: 4 };
    const underToolbar = { ...candidate(1), x: 60, y: 15, radius: 4 };
    expect(placeFlowCaptions([offscreen, underToolbar], smallViewport, empty)).toEqual([]);
    const edge = { ...candidate(0, { captionPriority: true }), x: 355, y: 10 };
    const [caption] = placeFlowCaptions([edge], smallViewport, empty);
    expect(caption.x).toBeLessThan(edge.x);
    expect(caption.x).toBeGreaterThanOrEqual(8);
    expect(caption.x + caption.width).toBeLessThanOrEqual(smallViewport.width - 8);
    expect(caption.y).toBe(smallViewport.topInset + 4);
    expect(caption.y + caption.height).toBeLessThanOrEqual(smallViewport.height - 8);
    expect(placeFlowCaptions([edge], { ...smallViewport, height: 45 }, empty)).toEqual([]);
  });

  it('truncates captions to two lines and 36 Unicode characters per line', () => {
    const entry = candidate(0, {
      captionPriority: true,
      text: `${'🔒'.repeat(40)}\nSecond\nThird`,
    });
    const [caption] = placeFlowCaptions([entry], viewport, empty);
    expect(caption.text.split('\n')).toEqual([`${'🔒'.repeat(35)}…`, 'Second']);
    expect(caption.width).toBe(254);
    expect(caption.height).toBe(38);
  });
});
