import { describe, expect, it } from 'vitest';
import { planEntityRemoval, removeWorkspaceEntity } from '../src/domain/entityRemoval';
import { buildGraph, newWorkspace, parseWorkspace } from '../src/domain/workspace';

const parent = 'a'.repeat(64),
  child = 'b'.repeat(64);
const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
const note = { label: '', note: 'Investigation note', icon: '', bookmarked: false };
function fixture() {
  const w = newWorkspace('Removal fixture', 'mainnet');
  w.transactions = {
    [parent]: {
      txid: parent,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    },
    [child]: {
      txid: child,
      vin: [{ txid: parent, vout: 0 }],
      vout: [{ n: 0, value: 0.9, scriptPubKey: { hex: '51' } }],
    },
  };
  return w;
}
describe('workspace entity removal', () => {
  it('removes unannotated transactions immediately but never edits individual outputs or inputs', () => {
    const w = fixture();
    expect(planEntityRemoval(w, `tx:${parent}`)?.requiresConfirmation).toBe(false);
    expect(planEntityRemoval(w, `out:${parent}:0`)).toBeUndefined();
    expect(removeWorkspaceEntity(w, `out:${parent}:0`)).toBe(w);
    const next = removeWorkspaceEntity(w, `tx:${parent}`);
    expect(next.transactions[parent]).toBeUndefined();
    expect(next.transactions[child]).toBe(w.transactions[child]);
    expect(buildGraph(next).nodes.some((node) => node.id === `out:${parent}:0`)).toBe(true);
    expect(w.transactions[parent]).toBeDefined();
    expect(() => parseWorkspace(next)).not.toThrow();
  });
  it('includes output notes, imported output tags and bookmarks in confirmation and preserves unrelated metadata', () => {
    const w = fixture();
    w.annotations[`out:${parent}:0`] = note;
    w.annotations[`tx:${child}`] = { ...note, label: 'Keep child' };
    w.inputContext = { [parent]: [0] };
    w.tags = [
      {
        id: crypto.randomUUID(),
        name: 'Shop',
        color: '#339988',
        nodeIds: [`out:${parent}:0`, `out:${parent}:7`, `tx:${child}`],
      },
    ];
    const plan = planEntityRemoval(w, `tx:${parent}`)!;
    expect(plan).toMatchObject({
      requiresConfirmation: true,
      annotationCount: 1,
      tagMembershipCount: 2,
    });
    const next = removeWorkspaceEntity(w, plan.nodeId);
    expect(next.inputContext).toBeUndefined();
    expect(next.annotations).toEqual({ [`tx:${child}`]: w.annotations[`tx:${child}`] });
    expect(next.tags?.[0].nodeIds).toEqual([`tx:${child}`]);
    expect(next.tags?.[0].name).toBe('Shop');
    expect(w.tags[0].nodeIds).toHaveLength(3);
    expect(() => parseWorkspace(next)).not.toThrow();
    const bookmarked = fixture();
    bookmarked.annotations[`tx:${parent}`] = { label: '', note: '', icon: '', bookmarked: true };
    expect(planEntityRemoval(bookmarked, `tx:${parent}`)?.requiresConfirmation).toBe(true);
  });
  it('stops address monitoring and removes its annotations without changing shared transaction facts', () => {
    const w = fixture();
    w.watchedAddresses = [address];
    w.annotations[`addr:${address}`] = { ...note, icon: '★' };
    w.tags = [
      {
        id: crypto.randomUUID(),
        name: 'Address group',
        color: '#339988',
        nodeIds: [`addr:${address}`, `tx:${child}`],
      },
    ];
    expect(planEntityRemoval(w, `addr:${address}`)).toMatchObject({
      kind: 'watched-address',
      requiresConfirmation: true,
    });
    const next = removeWorkspaceEntity(w, `addr:${address}`);
    expect(next.watchedAddresses).toEqual([]);
    expect(next.transactions).toBe(w.transactions);
    expect(next.annotations[`addr:${address}`]).toBeUndefined();
    expect(next.tags?.[0].nodeIds).toEqual([`tx:${child}`]);
    expect(planEntityRemoval(next, `addr:${address}`)).toBeUndefined();
    expect(() => parseWorkspace(next)).not.toThrow();
  });
});
