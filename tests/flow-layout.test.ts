import { describe, expect, it } from 'vitest';
import { flowLayout, type LayoutRequest } from '../src/components/graph/flowLayout';
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
describe('directed flow shelves', () => {
  it('preserves inputs, distinguishes stages, and is deterministic under reordered input', () => {
    const request = fixture(327),
      before = structuredClone(request);
    const result = flowLayout(request);
    expect(request).toEqual(before);
    expect(result.positions).toHaveLength(656);
    const positions = new Map(result.positions),
      tx = positions.get('transaction')!;
    for (const [id, p] of result.positions) {
      expect(Object.values(p).every(Number.isFinite)).toBe(true);
      if (id.startsWith('input')) expect(p.x).toBeLessThan(tx.x);
      if (id.startsWith('output')) expect(p.x).toBeGreaterThan(tx.x);
    }
    expect(new Set(result.positions.map(([, p]) => `${p.x},${p.y}`)).size).toBe(
      result.positions.length,
    );
    expect(
      flowLayout({
        ...request,
        nodes: [...request.nodes].reverse(),
        links: [...request.links].reverse(),
      }).positions,
    ).toEqual(result.positions);
  });
  it('retains all existing positions across parent expansion, metadata updates and hide/restore', () => {
    const request = fixture(20);
    const previous = flowLayout(request).positions;
    const expanded = {
      ...request,
      previous,
      nodes: [...request.nodes, { id: 'parent', shape: 'box' as const }],
      links: [...request.links, { source: 'parent', target: 'input-0' }],
    };
    const positions = new Map(flowLayout(expanded).positions);
    for (const [id, p] of previous) expect(positions.get(id)).toEqual(p);
    expect(positions.get('parent')!.x).toBeLessThan(positions.get('input-0')!.x);
    const filtered = flowLayout({
      ...expanded,
      nodes: expanded.nodes.filter((n) => n.id !== 'output-0'),
    });
    const restored = flowLayout({ ...expanded, previous: [...previous, ...filtered.positions] });
    expect(new Map(restored.positions).get('output-0')).toEqual(new Map(previous).get('output-0'));
  });
  it('keeps disconnected paths separate, explicit hints exact and malformed cycles finite', () => {
    const request = fixture();
    request.nodes.push({ id: 'unrelated', shape: 'box', fx: 800, fy: 300, fz: 50 });
    request.links.push({ source: 'output-0', target: 'input-0' });
    const positions = new Map(flowLayout(request).positions);
    expect(positions.get('unrelated')).toEqual({ x: 800, y: 300, z: 50 });
    expect(positions.size).toBe(5);
    expect([...positions.values()].every((p) => Object.values(p).every(Number.isFinite))).toBe(
      true,
    );
  });
});
