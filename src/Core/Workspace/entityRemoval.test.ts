import { expect, it } from 'vitest';
import { createWorkspace } from './createWorkspace';
import { planEntityRemoval, removeWorkspaceEntity } from './entityRemoval';

it('removes entity data and its metadata without requiring a Graph projection', () => {
  const workspace = createWorkspace('Removal', 'mainnet');
  const removed = 'a'.repeat(64),
    kept = 'b'.repeat(64);
  workspace.chainData.transactions = {
    [removed]: {
      txid: removed,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    },
    [kept]: { txid: kept, vin: [{ coinbase: '00' }], vout: [] },
  };
  const note = { label: 'Keep', note: '', icon: '', bookmarked: false };
  workspace.annotations.entities = {
    [`tx:${removed}`]: { ...note, label: 'Remove' },
    [`tx:${kept}`]: note,
  };
  const before = JSON.stringify(workspace);
  expect(planEntityRemoval(workspace, `tx:${removed}`)).toMatchObject({
    removedTransactionIds: [removed],
    annotationCount: 1,
    requiresConfirmation: true,
  });
  expect(planEntityRemoval(workspace, `tx:${removed}`)).not.toHaveProperty('title');
  const next = removeWorkspaceEntity(workspace, `tx:${removed}`);
  expect(Object.keys(next.chainData.transactions)).toEqual([kept]);
  expect(next.annotations.entities).toEqual({ [`tx:${kept}`]: note });
  expect(next.chainData.transactions[kept]).toBe(workspace.chainData.transactions[kept]);
  expect(JSON.stringify(workspace)).toBe(before);
  expect(removeWorkspaceEntity(next, `tx:${removed}`)).toBe(next);
});
