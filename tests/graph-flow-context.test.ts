import { describe, expect, it } from 'vitest';
import { indexGraphFlow } from '../src/components/graph/flowContext';
import { presentGraph, type GraphPalette } from '../src/components/graph/presentation';
import type { GraphData } from '../src/domain/types';

const graph: GraphData = {
  nodes: [
    { id: 'tx:a', txid: 'a', kind: 'transaction', label: 'A' },
    { id: 'tx:b', txid: 'b', kind: 'transaction', label: 'B' },
    { id: 'out:unknown:0', kind: 'output', label: 'Unknown input' },
    { id: 'out:a:0', txid: 'a', vout: 0, kind: 'output', label: 'Shared output' },
    { id: 'out:b:0', txid: 'b', vout: 0, kind: 'output', label: 'Next output' },
    { id: 'addr:test', kind: 'address', label: 'Address' },
  ],
  links: [
    { id: 'in-a', source: 'out:unknown:0', target: 'tx:a', kind: 'spends' },
    { id: 'out-a', source: 'tx:a', target: 'out:a:0', kind: 'creates' },
    { id: 'in-b', source: 'out:a:0', target: 'tx:b', kind: 'spends' },
    { id: 'out-b', source: 'tx:b', target: 'out:b:0', kind: 'creates' },
    { id: 'address', source: 'out:a:0', target: 'addr:test', kind: 'address' },
  ],
};
const palette: GraphPalette = {
  transaction: '#e3b477',
  output: '#79b5bd',
  address: '#b0a0e0',
  accent: '#f7931a',
  muted: '#a1adb0',
  background: '#14191b',
  input: '#83baff',
  flowOutput: '#82cfaa',
};

describe('contextual transaction flow', () => {
  it('retains the displayed spending context on an outpoint and changes role on explicit transaction selection', () => {
    const index = indexGraphFlow(graph);
    const a = index.resolve('tx:a');
    const b = index.resolve('tx:b', 'a');
    expect(a?.nodes.get('out:a:0')).toBe('output');
    expect(b?.nodes.get('out:a:0')).toBe('input');
    expect(index.resolve('out:a:0', 'b')).toBe(b);
    expect(index.resolve('out:a:0', 'a')).toBe(a);
    expect(index.resolve('out:a:0', 'unrelated')).toBe(a);
    expect(index.resolve('out:a:0')).toBe(a);
  });

  it('uses observed input links with unknown prevouts and leaves address/background selections neutral', () => {
    const index = indexGraphFlow(graph);
    expect(index.resolve('out:unknown:0')?.nodes.get('out:unknown:0')).toBe('input');
    expect(index.resolve('tx:a')?.nodes.has('addr:test')).toBe(false);
    expect(index.resolve('addr:test', 'a')).toBeUndefined();
    expect(index.resolve(undefined, 'a')).toBeUndefined();
  });

  it('changes markers and incident edge colors while preserving canonical geometry, annotations and selection', () => {
    const index = indexGraphFlow(graph);
    const input = {
      ...graph,
      dimensions: 3 as const,
      sizeBy: 'uniform' as const,
      glow: false,
      showLabels: false,
      showTags: false,
      showIcons: false,
      nodePresentation: new Map([['out:a:0', { color: '#ff00ff', label: 'Keep me', icon: 'X' }]]),
    };
    const fromA = presentGraph({ ...input, flowContext: index.resolve('tx:a') }, palette);
    const fromB = presentGraph(
      { ...input, flowContext: index.resolve('tx:b'), selectedId: 'out:a:0' },
      palette,
    );
    const outputA = fromA.nodes.find((n) => n.id === 'out:a:0')!;
    const inputB = fromB.nodes.find((n) => n.id === 'out:a:0')!;
    expect(outputA).toMatchObject({
      color: '#ff00ff',
      marker: { shape: 'ring', color: palette.flowOutput },
    });
    expect(inputB).toMatchObject({
      color: palette.accent,
      selected: true,
      marker: { shape: 'brackets', color: palette.input },
      highlight: false,
    });
    expect(inputB.text).toBeUndefined();
    const geometry = (frame: typeof fromA) =>
      frame.nodes.map(({ id, shape, radius, x, y, z }) => ({ id, shape, radius, x, y, z }));
    expect(geometry(fromB)).toEqual(geometry(fromA));
    expect(fromB.links.find((l) => l.id === 'in-b')).toMatchObject({
      color: palette.input,
      directed: true,
    });
    expect(fromB.links.find((l) => l.id === 'out-b')).toMatchObject({
      color: palette.flowOutput,
      directed: true,
    });
    expect(fromB.links.find((l) => l.id === 'address')).toMatchObject({
      arrowLength: 0,
      directed: false,
    });
    const neutral = presentGraph(input, palette);
    expect(neutral.nodes.every((n) => !n.marker)).toBe(true);
    expect(input.nodePresentation.get('out:a:0')?.label).toBe('Keep me');
  });
});
