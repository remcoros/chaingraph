import { expect, it } from 'vitest';
import { listTagsForNode } from './tagMembership';
import { createWorkspace } from '../createWorkspace';

it('applies address tags to outputs but never implicitly to their transaction', () => {
  const workspace = createWorkspace('Tag subjects', 'mainnet');
  const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
  const tag = { id: 'fixture', name: 'Watch', color: '#aabbcc', nodeIds: [`addr:${address}`] };
  workspace.annotations.tags = [tag];
  expect(listTagsForNode(workspace, { id: 'out:fixture:0', kind: 'output', address })).toEqual([
    tag,
  ]);
  expect(listTagsForNode(workspace, { id: 'tx:fixture', kind: 'transaction', address })).toEqual(
    [],
  );
  expect(listTagsForNode(workspace, { id: 'out:fixture:0', kind: 'output' })).toEqual([]);
});
