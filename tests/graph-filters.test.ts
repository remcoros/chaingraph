import { describe, expect, it } from 'vitest';
import { filterGraph, sortEntities, valueFilterError } from '../src/domain/graphFilters';
import type { Annotation, GraphData } from '../src/domain/types';

const graph: GraphData = {
  nodes: [
    { id: 'tx:a', kind: 'transaction', label: 'Funding', value: 100 },
    { id: 'out:a:0', kind: 'output', label: 'First output', value: 100 },
    { id: 'tx:b', kind: 'transaction', label: 'Spending', value: 90 },
    { id: 'out:b:0', kind: 'output', label: 'Second output', value: 90 },
    { id: 'addr:c', kind: 'address', label: 'Destination', address: 'address-c' },
    { id: 'out:missing:0', kind: 'output', label: 'Missing funding' },
    { id: 'tx:isolated', kind: 'transaction', label: 'Unrelated', value: 0 },
  ],
  links: [
    { id: 'a-create', source: 'tx:a', target: 'out:a:0', kind: 'creates' },
    { id: 'a-spend', source: 'out:a:0', target: 'tx:b', kind: 'spends' },
    { id: 'b-create', source: 'tx:b', target: 'out:b:0', kind: 'creates' },
    { id: 'b-address', source: 'out:b:0', target: 'addr:c', kind: 'address' },
    { id: 'missing-spend', source: 'out:missing:0', target: 'tx:b', kind: 'spends' },
  ],
};
const annotations: Record<string, Annotation> = {
  'out:a:0': { label: 'Salary', note: 'January invoice', bookmarked: true, icon: '' },
  'out:b:0': { label: '', note: 'Personal savings', bookmarked: false, icon: 'star' },
};
const ids = (data: { nodes: { id: string }[] }) => data.nodes.map((node) => node.id);

describe('loaded graph filtering', () => {
  it('keeps strict matches and links coherent without modifying the snapshot', () => {
    const snapshot = structuredClone(graph);
    const filtered = filterGraph(graph, { kind: 'output', minSats: 90, maxSats: 100 });
    expect(ids(filtered)).toEqual(['out:a:0', 'out:b:0']);
    expect(filtered.links).toEqual([]);
    expect(filtered.contextNodeIds).toEqual([]);
    expect(graph).toEqual(snapshot);
  });

  it('reports directly connected context separately and does not recursively expand it', () => {
    const filtered = filterGraph(graph, { query: 'salary', preserveContext: true }, annotations);
    expect(filtered.matchedNodes.map((node) => node.id)).toEqual(['out:a:0']);
    expect(new Set(filtered.contextNodeIds)).toEqual(new Set(['tx:a', 'tx:b']));
    expect(ids(filtered)).not.toContain('out:b:0');
    expect(filtered.links.map((link) => link.id)).toEqual(['a-create', 'a-spend']);
    expect(
      filtered.links.every(
        (link) => ids(filtered).includes(link.source) && ids(filtered).includes(link.target),
      ),
    ).toBe(true);
  });

  it('searches annotations, notes and addresses while distinguishing user labels from default labels/icons', () => {
    expect(ids(filterGraph(graph, { query: 'JANUARY invoice' }, annotations))).toEqual(['out:a:0']);
    expect(ids(filterGraph(graph, { query: 'address-c' }, annotations))).toEqual(['addr:c']);
    expect(
      ids(filterGraph(graph, { label: 'labeled', bookmarkedOnly: true }, annotations)),
    ).toEqual(['out:a:0']);
    expect(ids(filterGraph(graph, { label: 'unlabeled' }, annotations))).toContain('out:b:0');
    expect(ids(filterGraph(graph, { label: 'unlabeled' }, annotations))).not.toContain('out:a:0');
  });

  it('classifies spend evidence against the full graph, including spenders hidden by type filters', () => {
    expect(ids(filterGraph(graph, { kind: 'output', spend: 'observed' }))).toEqual([
      'out:a:0',
      'out:missing:0',
    ]);
    expect(ids(filterGraph(graph, { spend: 'unknown' }))).toEqual(['out:b:0']);
    expect(ids(filterGraph(graph, { kind: 'transaction', spend: 'unknown' }))).toEqual([]);
  });

  it('keeps missing funding distinct from unknown spend status', () => {
    expect(ids(filterGraph(graph, { funding: 'missing' }))).toEqual(['out:missing:0']);
    expect(ids(filterGraph(graph, { funding: 'loaded', spend: 'unknown' }))).toEqual(['out:b:0']);
    const amountOnly = {
      nodes: [{ id: 'out:partial', kind: 'output' as const, label: 'Amount only', value: 5 }],
      links: [],
    };
    expect(ids(filterGraph(amountOnly, { funding: 'missing' }))).toEqual(['out:partial']);
  });

  it('focuses by actual graph edges for one or two hops and intersects context with that boundary', () => {
    expect(ids(filterGraph(graph, { focus: { id: 'out:a:0', hops: 1 } }))).toEqual([
      'tx:a',
      'out:a:0',
      'tx:b',
    ]);
    expect(ids(filterGraph(graph, { focus: { id: 'out:a:0', hops: 2 } }))).toEqual([
      'tx:a',
      'out:a:0',
      'tx:b',
      'out:b:0',
      'out:missing:0',
    ]);
    expect(
      ids(
        filterGraph(graph, {
          focus: { id: 'out:a:0', hops: 1 },
          query: 'Spending',
          preserveContext: true,
        }),
      ),
    ).toEqual(['out:a:0', 'tx:b']);
    expect(ids(filterGraph(graph, { focus: { id: 'absent', hops: 2 } }))).toEqual([]);
  });

  it('hides addresses including context and rejects dangling links', () => {
    const malformed = {
      nodes: graph.nodes,
      links: [
        ...graph.links,
        { id: 'dangling', source: 'missing-node', target: 'out:b:0', kind: 'spends' as const },
      ],
    };
    const filtered = filterGraph(malformed, {
      query: 'Second output',
      preserveContext: true,
      showAddresses: false,
    });
    expect(ids(filtered)).toEqual(['tx:b', 'out:b:0']);
    expect(filtered.links.map((link) => link.id)).toEqual(['b-create']);
    expect(ids(filterGraph(malformed, { spend: 'observed' }))).not.toContain('missing-node');
  });

  it('isolates finding members, with optional nonmatching neighbors and a reversible empty filter', () => {
    const filtered = filterGraph(graph, {
      includeIds: ['out:a:0', 'absent'],
      preserveContext: true,
    });
    expect(filtered.matchedNodes.map((node) => node.id)).toEqual(['out:a:0']);
    expect(filtered.contextNodeIds).toHaveLength(2);
    expect(ids(filterGraph(graph, { includeIds: [] }))).toEqual([]);
    expect(ids(filterGraph(graph, {}))).toEqual(ids(graph));
  });

  it('does not treat unknown values as zero and rejects invalid amount filters', () => {
    expect(ids(filterGraph(graph, { minSats: 0, maxSats: 0 }))).toEqual(['tx:isolated']);
    for (const minSats of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
      expect(valueFilterError({ minSats })).toBeTruthy();
      expect(ids(filterGraph(graph, { minSats }))).toEqual([]);
    }
    expect(valueFilterError({ minSats: 100, maxSats: 90 })).toContain('Minimum');
    expect(valueFilterError({ minSats: 0, maxSats: 2_100_000_000_000_000 })).toBeUndefined();
  });
});

describe('entity ordering', () => {
  it('sorts all records without changing graph order and puts unknown amounts last in both directions', () => {
    const original = ids(graph);
    const ascending = sortEntities(graph.nodes, 'value-asc');
    const descending = sortEntities(graph.nodes, 'value-desc');
    expect(ascending[0].id).toBe('tx:isolated');
    expect(descending[0].value).toBe(100);
    expect(ascending.slice(-2).every((node) => node.value === undefined)).toBe(true);
    expect(descending.slice(-2).every((node) => node.value === undefined)).toBe(true);
    expect(ids(graph)).toEqual(original);
  });

  it('retains every entity beyond the old 200-row cutoff with deterministic numeric label sorting', () => {
    const nodes = Array.from({ length: 501 }, (_, index) => ({
      id: `tx:${index}`,
      kind: 'transaction' as const,
      label: `Transaction ${500 - index}`,
    }));
    const sorted = sortEntities(nodes, 'label');
    expect(sorted).toHaveLength(501);
    expect(sorted[0].label).toBe('Transaction 0');
    expect(sorted[500].label).toBe('Transaction 500');
    expect(new Set(sorted.map((node) => node.id)).size).toBe(501);
  });
});
