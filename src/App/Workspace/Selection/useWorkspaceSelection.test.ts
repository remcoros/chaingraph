import { describe, expect, it } from 'vitest';
import { prunedSelection } from './useWorkspaceSelection';

const address = 'addr:bc1qexampleexampleexampleexampleexampleexam';
const transaction = `tx:${'a'.repeat(64)}`;

describe('pruning the workspace selection', () => {
  it('keeps a selection the graph already lists', () => {
    expect(prunedSelection(transaction, new Set([transaction]), undefined)).toBe(transaction);
    expect(prunedSelection(transaction, new Map([[transaction, {}]]), undefined)).toBe(transaction);
  });

  it('keeps a just-made selection through the pass that cannot see it yet', () => {
    // A wallet or analysis handoff admits an address and turns addresses on in
    // one edit, but the projection is deferred, so the next pass still runs
    // against a graph projected without addresses. Dropping the selection here
    // is what left the graph workbench open on nothing.
    expect(prunedSelection(address, new Set([transaction]), address)).toBe(address);
  });

  it('drops a selection that a second pass still cannot see', () => {
    // The hold is spent by the pass that used it, so a removed entity does not
    // stay selected for good.
    const afterHandoff = prunedSelection(address, new Set([transaction]), address);
    expect(prunedSelection(afterHandoff, new Set([transaction]), undefined)).toBeUndefined();
  });

  it('drops a selection whose entity is gone when nothing is held', () => {
    expect(prunedSelection(address, new Set([transaction]), undefined)).toBeUndefined();
    expect(prunedSelection(address, new Set(), undefined)).toBeUndefined();
  });

  it('does not let a hold for one entity rescue another', () => {
    expect(prunedSelection(address, new Set([transaction]), transaction)).toBeUndefined();
  });

  it('leaves an empty selection alone', () => {
    expect(prunedSelection(undefined, new Set([transaction]), address)).toBeUndefined();
  });
});
