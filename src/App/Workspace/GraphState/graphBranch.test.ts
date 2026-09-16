import { describe, expect, it } from 'vitest';
import {
  graphRemovalClosure,
  graphTransactionOutputIds,
  graphUnconnectedOutputIds,
} from './graphBranch';
import type { GraphData } from './types';

it('clears a transaction footprint while keeping shared outpoints and unrelated branches', () => {
  const graph: GraphData = {
    nodes: [
      ...['a', 'b'].map((id) => ({ id, kind: 'transaction' as const, label: id })),
      ...['in', 'shared', 'out', 'other'].map((id) => ({ id, kind: 'output' as const, label: id })),
    ],
    links: [
      { id: 'in-a', source: 'in', target: 'a', kind: 'spends' },
      { id: 'a-shared', source: 'a', target: 'shared', kind: 'creates' },
      { id: 'shared-b', source: 'shared', target: 'b', kind: 'spends' },
      { id: 'a-out', source: 'a', target: 'out', kind: 'creates' },
      { id: 'b-other', source: 'b', target: 'other', kind: 'creates' },
    ],
  };
  const admitted = new Set(graph.nodes.map((node) => node.id));
  expect(new Set(graphRemovalClosure(graph, admitted, ['a']))).toEqual(new Set(['a', 'in', 'out']));
  admitted.delete('b');
  admitted.delete('out');
  expect(new Set(graphRemovalClosure(graph, admitted, ['a']))).toEqual(
    new Set(['a', 'in', 'shared']),
  );
  expect(graph.nodes).toHaveLength(6);
});

const graph: GraphData = {
  nodes: [
    ...['a', 'b', 'unrelated'].map((id) => ({ id, kind: 'transaction' as const, label: id })),
    ...['input', 'shared', 'output', 'orphan'].map((id) => ({
      id,
      kind: 'output' as const,
      label: id,
    })),
    { id: 'address', kind: 'address', label: 'Address connection' },
  ],
  links: [
    { id: 'input-a', source: 'input', target: 'a', kind: 'spends' },
    { id: 'a-shared', source: 'a', target: 'shared', kind: 'creates' },
    { id: 'shared-b', source: 'shared', target: 'b', kind: 'spends' },
    { id: 'a-output', source: 'a', target: 'output', kind: 'creates' },
    { id: 'output-address', source: 'output', target: 'address', kind: 'address' },
  ],
};
const participating = () => new Set(graph.nodes.map((node) => node.id));

describe('unconnected graph I/O', () => {
  it('includes detached and terminal I/O while preserving transaction and address bridges', () => {
    expect(graphUnconnectedOutputIds(graph, participating())).toEqual(new Set(['input', 'orphan']));
    const visible = participating();
    visible.delete('b');
    visible.delete('address');
    expect(graphUnconnectedOutputIds(graph, visible)).toEqual(
      new Set(['input', 'shared', 'output', 'orphan']),
    );
    visible.delete('orphan');
    expect(graphUnconnectedOutputIds(graph, visible).has('orphan')).toBe(false);
  });

  it('counts distinct neighbors regardless of edge direction and ignores dangling connections', () => {
    const members = participating();
    members.add('missing');
    const repeated: GraphData = {
      ...graph,
      links: [
        ...graph.links,
        { id: 'reverse', source: 'a', target: 'input', kind: 'creates' },
        { id: 'dangling', source: 'input', target: 'missing', kind: 'creates' },
        { id: 'self', source: 'orphan', target: 'orphan', kind: 'spends' },
      ],
    };
    expect(graphUnconnectedOutputIds(repeated, members)).toEqual(new Set(['input', 'orphan']));
    expect(
      graphUnconnectedOutputIds({ ...repeated, links: [...repeated.links].reverse() }, members),
    ).toEqual(new Set(['input', 'orphan']));
  });

  it('finds only loaded I/O directly connected to requested transactions, without recursing', () => {
    expect(graphTransactionOutputIds(graph, new Set(['a']))).toEqual(
      new Set(['input', 'shared', 'output']),
    );
    expect(graphTransactionOutputIds(graph, new Set(['b']))).toEqual(new Set(['shared']));
    expect(graphTransactionOutputIds(graph, new Set(['address', 'missing', 'input']))).toEqual(
      new Set(),
    );
    expect(graphTransactionOutputIds(graph, new Set(['a', 'b']))).toEqual(
      new Set(['input', 'shared', 'output']),
    );
  });
});

describe('simultaneous transaction I/O removal closure', () => {
  it('removes newly orphaned inputs while retaining shared outputs, addresses and existing orphans', () => {
    expect(graphRemovalClosure(graph, participating(), ['a'])).toEqual(['a', 'input']);
  });

  it('evaluates all requested transactions together before deciding whether a shared outpoint survives', () => {
    expect(graphRemovalClosure(graph, participating(), ['a', 'b'])).toEqual([
      'a',
      'b',
      'input',
      'shared',
    ]);
  });

  it('retains any surviving graph connection, including an address, regardless of link direction', () => {
    const reverseAddress = {
      ...graph,
      links: graph.links.map((link) =>
        link.kind === 'address' ? { ...link, source: link.target, target: link.source } : link,
      ),
    };
    expect(graphRemovalClosure(reverseAddress, participating(), ['a', 'b'])).toEqual([
      'a',
      'b',
      'input',
      'shared',
    ]);
    expect(graphRemovalClosure(graph, participating(), ['a', 'b', 'address'])).toEqual([
      'a',
      'b',
      'input',
      'shared',
      'output',
      'address',
    ]);
  });

  it('uses participation rather than loaded evidence to decide if hidden or removed connections remain', () => {
    const visible = participating();
    visible.delete('b');
    visible.delete('address');
    expect(graphRemovalClosure(graph, visible, ['a'])).toEqual(['a', 'input', 'shared', 'output']);
    expect(graph.nodes.map((node) => node.id)).toContain('b');
  });

  it('does not cascade output or address removal to transactions or unrelated entities', () => {
    expect(graphRemovalClosure(graph, participating(), ['input', 'shared', 'address'])).toEqual([
      'input',
      'shared',
      'address',
    ]);
    expect(graphRemovalClosure(graph, participating(), ['orphan'])).toEqual(['orphan']);
  });

  it('does not cascade from a requested transaction that is not participating', () => {
    const visible = participating();
    visible.delete('a');
    expect(graphRemovalClosure(graph, visible, ['a'])).toEqual([]);
  });

  it('keeps batch results deterministic without mutating nodes, links or participating membership', () => {
    const original = structuredClone(graph);
    const members = participating();
    const expected = graphRemovalClosure(graph, members, ['a', 'b', 'address']);
    expect(
      graphRemovalClosure(
        { nodes: [...graph.nodes].reverse(), links: [...graph.links].reverse() },
        members,
        ['address', 'b', 'a', 'a'],
      ),
    ).toEqual(expected);
    expect(graph).toEqual(original);
    expect(members).toEqual(participating());
  });

  it('ignores dangling links as surviving connections but preserves explicitly requested future membership', () => {
    const members = participating();
    members.add('future');
    const dangling = {
      ...graph,
      links: [
        ...graph.links,
        { id: 'input-future', source: 'input', target: 'future', kind: 'address' as const },
      ],
    };
    expect(graphRemovalClosure(dangling, members, ['a'])).toEqual(['a', 'input']);
    expect(graphRemovalClosure(dangling, members, ['future'])).toEqual(['future']);
  });
});
