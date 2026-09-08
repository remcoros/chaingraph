import { describe, expect, it } from 'vitest';
import { filterSmallAmounts } from '../src/domain/smallAmounts';
import { filterGraph } from '../src/domain/graphFilters';
import { newWorkspace, parseWorkspace } from '../src/domain/workspace';
import type { GraphData } from '../src/domain/types';

const graph: GraphData = {
  nodes: [
    { id: 'tx:a', kind: 'transaction', label: 'Transaction', value: 546 },
    { id: 'out:a:0', kind: 'output', label: 'Zero', value: 0 },
    { id: 'out:a:1', kind: 'output', label: 'Small', value: 300, address: 'example' },
    { id: 'out:a:2', kind: 'output', label: 'Boundary', value: 546 },
    { id: 'out:unknown:0', kind: 'output', label: 'Unknown input' },
    { id: 'addr:example', kind: 'address', label: 'Address', address: 'example' },
  ],
  links: [
    { id: 'zero', source: 'tx:a', target: 'out:a:0', kind: 'creates' },
    { id: 'small', source: 'tx:a', target: 'out:a:1', kind: 'creates' },
    { id: 'boundary', source: 'tx:a', target: 'out:a:2', kind: 'creates' },
    { id: 'input', source: 'out:unknown:0', target: 'tx:a', kind: 'spends' },
    { id: 'address', source: 'out:a:1', target: 'addr:example', kind: 'address' },
  ],
};
const ids = (value: GraphData) => value.nodes.map((node) => node.id);

describe('small amount presentation', () => {
  it('filters strictly below the threshold, retaining unknown values and transactions', () => {
    const before = structuredClone(graph);
    const result = filterSmallAmounts(graph, 546);
    expect(result.hiddenCount).toBe(2);
    expect(ids(result)).toEqual(['tx:a', 'out:a:2', 'out:unknown:0', 'addr:example']);
    expect(result.links.map((link) => link.id)).toEqual(['boundary', 'input']);
    expect(graph).toEqual(before);
    expect(ids(filterSmallAmounts(graph, 0))).toEqual(ids(graph));
    expect(ids(filterSmallAmounts(graph, 100_000))).toContain('tx:a');
  });

  it('retains selected outputs and selected address outputs without overriding manual hiding', () => {
    expect(ids(filterSmallAmounts(graph, 546, 'out:a:1'))).toContain('out:a:1');
    expect(ids(filterSmallAmounts(graph, 546, 'addr:example'))).toContain('out:a:1');
    const result = filterGraph(
      filterSmallAmounts(graph, 546, 'out:a:1'),
      {},
      {},
      {
        hiddenNodeIds: ['out:a:1'],
      },
    );
    expect(ids(result)).not.toContain('out:a:1');
  });

  it('cannot resurrect small outputs through context or focus expansion', () => {
    const filtered = filterSmallAmounts(graph, 546);
    const result = filterGraph(filtered, { kind: 'transaction', preserveContext: true });
    expect(ids(result)).not.toContain('out:a:0');
    expect(ids(result)).not.toContain('out:a:1');
    expect(ids(result)).toContain('out:a:2');
    expect(ids(filterGraph(filtered, { focus: { id: 'tx:a', hops: 2 } }))).not.toContain('out:a:1');
  });

  it('omits automatic context cubes only when amount filtering removes every valid incident edge', () => {
    const fixture: GraphData = {
      nodes: [
        { id: 'tx:auto', txid: 'auto', kind: 'transaction', label: 'Automatic parent' },
        { id: 'out:auto:0', kind: 'output', label: 'Small source', value: 300 },
        { id: 'tx:explicit', kind: 'transaction', label: 'Explicit parent' },
        { id: 'out:explicit:0', kind: 'output', label: 'Small explicit output', value: 300 },
        { id: 'tx:unknown', kind: 'transaction', label: 'Unknown branch' },
        { id: 'out:unknown:0', kind: 'output', label: 'Missing amount' },
        { id: 'tx:isolated', kind: 'transaction', label: 'Already isolated context' },
        { id: 'tx:main', kind: 'transaction', label: 'Main transaction' },
      ],
      links: [
        { id: 'automatic-create', source: 'tx:auto', target: 'out:auto:0', kind: 'creates' },
        { id: 'automatic-spend', source: 'out:auto:0', target: 'tx:main', kind: 'spends' },
        { id: 'explicit-create', source: 'tx:explicit', target: 'out:explicit:0', kind: 'creates' },
        { id: 'unknown-create', source: 'tx:unknown', target: 'out:unknown:0', kind: 'creates' },
        { id: 'unknown-spend', source: 'out:unknown:0', target: 'tx:main', kind: 'spends' },
        { id: 'invalid-reference', source: 'tx:isolated', target: 'out:absent:0', kind: 'creates' },
      ],
    };
    const provenance = ['auto', 'unknown', 'isolated'];
    const before = structuredClone(fixture);
    const result = filterSmallAmounts(fixture, 546, undefined, provenance);
    expect(ids(result)).not.toContain('tx:auto');
    expect(ids(result)).toEqual([
      'tx:explicit',
      'tx:unknown',
      'out:unknown:0',
      'tx:isolated',
      'tx:main',
    ]);
    expect(result.hiddenCount).toBe(2); // The user-facing count describes outputs only.
    expect(result.links.map((link) => link.id)).toEqual(['unknown-create', 'unknown-spend']);
    expect(fixture).toEqual(before);
    expect(ids(filterSmallAmounts(fixture, 0, undefined, provenance))).toEqual(ids(fixture));
    expect(ids(filterSmallAmounts(fixture, 546, 'tx:auto', provenance))).toContain('tx:auto');
    expect(ids(filterSmallAmounts(fixture, 546, 'out:auto:0', provenance))).toContain('tx:auto');

    // Other filters may subsequently hide all connections but do not trigger amount pruning.
    const manual = filterGraph(result, {}, {}, { hiddenNodeIds: ['out:unknown:0'] });
    expect(ids(manual)).toContain('tx:unknown');
    const transactions = filterGraph(result, { kind: 'transaction' });
    expect(ids(transactions)).toContain('tx:unknown');
  });

  it('persists valid integer satoshi thresholds and rejects malformed saved values', () => {
    const workspace = newWorkspace('Amount filter', 'mainnet');
    expect(parseWorkspace(workspace).view.smallAmountThreshold).toBeUndefined();
    for (const value of [0, 546, 1000, 10000, 100000, 1234]) {
      expect(
        parseWorkspace({ ...workspace, view: { ...workspace.view, smallAmountThreshold: value } })
          .view.smallAmountThreshold,
      ).toBe(value);
    }
    for (const value of [-1, 0.5, '546', Infinity, 2_100_000_000_000_001]) {
      expect(() =>
        parseWorkspace({ ...workspace, view: { ...workspace.view, smallAmountThreshold: value } }),
      ).toThrow();
    }
  });
});
