import { expect, it } from 'vitest';
import { transactionGraphBranch } from '../src/domain/graphBranch';
import type { GraphData } from '../src/domain/types';

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
  expect(new Set(transactionGraphBranch(graph, admitted, 'a'))).toEqual(
    new Set(['a', 'in', 'out']),
  );
  admitted.delete('b');
  admitted.delete('out');
  expect(new Set(transactionGraphBranch(graph, admitted, 'a'))).toEqual(
    new Set(['a', 'in', 'shared']),
  );
  expect(graph.nodes).toHaveLength(6);
});
