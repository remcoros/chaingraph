import { describe, expect, it } from 'vitest';
import { filterSmallAmounts, omitAmountOrphans } from '../src/Domain/Graph/smallAmounts';
import { filterGraph } from '../src/Domain/Graph/graphFilters';
import { newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';
import type { GraphData } from '../src/Domain/types';

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
  it('shows strictly greater amounts, retaining unknown values and connected transactions', () => {
    const before = structuredClone(graph);
    const result = filterSmallAmounts(graph, 546);
    expect(result.hiddenCount).toBe(3);
    expect(ids(result)).toEqual(['tx:a', 'out:unknown:0']);
    expect(result.links.map((link) => link.id)).toEqual(['input']);
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
    expect(ids(result)).not.toContain('out:a:2');
    expect(ids(filterGraph(filtered, { focus: { id: 'tx:a', hops: 2 } }))).not.toContain('out:a:1');
  });

  it('omits orphan cubes regardless of provenance and keeps connected unknown inputs', () => {
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
    expect(ids(result)).toEqual(['tx:unknown', 'out:unknown:0', 'tx:main']);
    expect(result.hiddenCount).toBe(2); // The user-facing count describes outputs only.
    expect(result.links.map((link) => link.id)).toEqual(['unknown-create', 'unknown-spend']);
    expect(fixture).toEqual(before);
    expect(ids(filterSmallAmounts(fixture, 0, undefined, provenance))).toEqual(ids(fixture));
    expect(ids(filterSmallAmounts(fixture, 546, 'tx:auto', provenance))).toContain('tx:auto');
    expect(ids(filterSmallAmounts(fixture, 546, 'out:auto:0', provenance))).toContain('tx:auto');

    // Canvas cleanup after other filters also drops remaining orphan scaffolding.
    const manual = filterGraph(result, {}, {}, { hiddenNodeIds: ['out:unknown:0'] });
    expect(ids(omitAmountOrphans(manual))).not.toContain('tx:unknown');
    const transactions = filterGraph(result, { kind: 'transaction' });
    expect(ids(transactions)).toContain('tx:unknown');
  });

  it.each(['smallAmountThreshold', 'flowAmountThreshold'] as const)(
    'persists and validates independent %s values',
    (field) => {
      const workspace = newWorkspace('Amount filter', 'mainnet');
      expect(parseWorkspace(workspace).view[field]).toBeUndefined();
      for (const value of [0, 546, 1000, 10000, 100000, 1234]) {
        expect(
          parseWorkspace({ ...workspace, view: { ...workspace.view, [field]: value } }).view[field],
        ).toBe(value);
      }
      for (const value of [-1, 0.5, '546', Infinity, 2_100_000_000_000_001]) {
        expect(() =>
          parseWorkspace({ ...workspace, view: { ...workspace.view, [field]: value } }),
        ).toThrow();
      }
      const legacy = parseWorkspace({
        ...workspace,
        view: { ...workspace.view, smallAmountThreshold: 1000 },
      });
      expect(legacy.view.smallAmountThreshold).toBe(1000);
      expect(legacy.view.flowAmountThreshold).toBeUndefined();
    },
  );
});

it('hides a prefetched branch cut off by a small connecting output, even with large siblings', () => {
  const fixture: GraphData = {
    nodes: [
      { id: 'tx:root', kind: 'transaction', label: 'Investigation' },
      { id: 'out:root:0', kind: 'output', label: 'Large destination', value: 1e8 },
      { id: 'tx:parent', kind: 'transaction', label: 'Prefetched parent' },
      { id: 'out:parent:0', kind: 'output', label: 'Small bridge', value: 300 },
      { id: 'out:parent:1', kind: 'output', label: 'Unrelated large sibling', value: 1e8 },
      { id: 'tx:grandparent', kind: 'transaction', label: 'More prefetched ancestry' },
      { id: 'out:grandparent:0', kind: 'output', label: 'Parent funding', value: 2e8 },
    ],
    links: [
      { id: 'r', source: 'tx:root', target: 'out:root:0', kind: 'creates' },
      { id: 'p', source: 'tx:parent', target: 'out:parent:0', kind: 'creates' },
      { id: 'bridge', source: 'out:parent:0', target: 'tx:root', kind: 'spends' },
      { id: 'sibling', source: 'tx:parent', target: 'out:parent:1', kind: 'creates' },
      { id: 'g', source: 'tx:grandparent', target: 'out:grandparent:0', kind: 'creates' },
      { id: 'funding', source: 'out:grandparent:0', target: 'tx:parent', kind: 'spends' },
    ],
  };
  const context = ['parent', 'grandparent'];
  const before = structuredClone(fixture);
  expect(ids(filterSmallAmounts(fixture, 546, 'tx:root', context))).toEqual([
    'tx:root',
    'out:root:0',
  ]);
  expect(filterSmallAmounts(fixture, 546, 'tx:root', context).hiddenCount).toBe(3);
  expect(ids(filterSmallAmounts(fixture, 0, 'tx:root', context))).toEqual(ids(fixture));
  // Selecting the detached branch restores its inspection context without resetting the filter.
  expect(ids(filterSmallAmounts(fixture, 546, 'out:parent:1', context))).toContain('tx:parent');
  // A separately added parent remains an independent investigation.
  expect(ids(filterSmallAmounts(fixture, 546, 'tx:root', ['grandparent']))).toContain('tx:parent');
  expect(fixture).toEqual(before);
});
