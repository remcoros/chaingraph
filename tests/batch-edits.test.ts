import { describe, expect, it } from 'vitest';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import {
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  labelBatchPlan,
  MAX_BATCH_TARGETS,
  tagBatchPlan,
} from '../src/Domain/Metadata/batchEdits';
import { outputNodeId, txNodeId, type Transaction, type Workspace } from '../src/Domain/types';
import { WorkspaceStore } from '../src/App/Workspace/useWorkspaces';

const a = 'a'.repeat(64),
  b = 'b'.repeat(64);
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const funding: Transaction = {
  txid: a,
  vin: [{ coinbase: '00' }],
  vout: [0, 1, 2].map((n) => ({ n, value: 1, scriptPubKey: { address } })),
};
const spending: Transaction = {
  txid: b,
  vin: [{ txid: a, vout: 0 }],
  vout: [{ n: 0, value: 0.9, scriptPubKey: {} }],
};
const first = outputNodeId(a, 0),
  second = outputNodeId(a, 1),
  third = outputNodeId(a, 2);

function workspace(): Workspace {
  const w = newWorkspace('Batch fixture', 'mainnet');
  w.transactions = { [a]: structuredClone(funding), [b]: structuredClone(spending) };
  w.annotations = {
    [first]: { label: 'Salary', note: 'January invoice', icon: '★', bookmarked: true },
    [second]: { label: 'Rent', note: '', icon: '', bookmarked: false },
  };
  w.tags = [{ id: crypto.randomUUID(), name: 'Exchange', color: '#65cbbb', nodeIds: [first] }];
  return w;
}

describe('batch label edits', () => {
  it('reports the exact affected and replaced counts before writing anything', () => {
    const w = workspace();
    const all = labelBatchPlan(w, [first, second, third]);
    expect(all.targetIds).toEqual([first, second, third]);
    expect(all.labeledCount).toBe(2);
    expect(all.unlabeledCount).toBe(1);
    expect(all.replacedCount).toBe(2);
    expect(all.distinctLabels).toEqual(['Salary', 'Rent']);
    const restricted = labelBatchPlan(w, [first, second, third], { onlyUnlabeled: true });
    expect(restricted.targetIds).toEqual([third]);
    expect(restricted.replacedCount).toBe(0);
  });

  it('writes only the label field of the supplied entities', () => {
    const w = workspace();
    const updated = applyBatchLabel(w, [second, third], 'Utility payment');
    expect(updated.annotations[second]).toEqual({
      label: 'Utility payment',
      note: '',
      icon: '',
      bookmarked: false,
    });
    expect(updated.annotations[third].label).toBe('Utility payment');
    expect(updated.annotations[first]).toEqual(w.annotations[first]);
    expect(updated.transactions).toBe(w.transactions);
    expect(updated.tags).toBe(w.tags);
  });

  it('keeps existing labels when only unlabeled entities are targeted', () => {
    const w = workspace();
    const updated = applyBatchLabel(w, [first, second, third], 'Batch', { onlyUnlabeled: true });
    expect(updated.annotations[first].label).toBe('Salary');
    expect(updated.annotations[second].label).toBe('Rent');
    expect(updated.annotations[third].label).toBe('Batch');
  });

  it('clears labels explicitly and returns the same workspace for a no-op batch', () => {
    const w = workspace();
    const cleared = applyBatchLabel(w, [first], '');
    expect(cleared.annotations[first].label).toBe('');
    expect(cleared.annotations[first].note).toBe('January invoice');
    expect(applyBatchLabel(cleared, [first], '')).toBe(cleared);
    expect(applyBatchLabel(w, [], 'Ignored')).toBe(w);
  });
});

describe('batch icon edits', () => {
  it('sets and clears icons without touching labels, notes or bookmarks', () => {
    const w = workspace();
    const updated = applyBatchIcon(w, [first, second], '🤝');
    expect(updated.annotations[first]).toEqual({
      label: 'Salary',
      note: 'January invoice',
      icon: '🤝',
      bookmarked: true,
    });
    expect(updated.annotations[second].icon).toBe('🤝');
    const cleared = applyBatchIcon(updated, [first], '');
    expect(cleared.annotations[first].icon).toBe('');
    expect(cleared.annotations[second].icon).toBe('🤝');
  });
});

describe('batch tag edits', () => {
  it('describes direct membership before changing it', () => {
    const w = workspace();
    const plan = tagBatchPlan(w, [first, second, third], w.tags![0].id);
    expect(plan).toEqual({ memberCount: 1, missingCount: 2, total: 3 });
  });

  it('adds and removes only the supplied entities', () => {
    const w = workspace();
    const tagId = w.tags![0].id;
    const added = applyBatchTag(w, [second, third], tagId, 'add');
    expect(added.tags![0].nodeIds).toEqual([first, second, third]);
    const removed = applyBatchTag(added, [first, second], tagId, 'remove');
    expect(removed.tags![0].nodeIds).toEqual([third]);
    expect(removed.annotations).toBe(w.annotations);
    expect(applyBatchTag(removed, [first], tagId, 'remove')).toBe(removed);
  });

  it('creates a tag with the selection and reuses an existing name instead of duplicating it', () => {
    const w = workspace();
    const created = createBatchTag(w, [second, third], { name: 'Merchant', color: '#e4af67' });
    expect(created.tags).toHaveLength(2);
    expect(created.tags![1].nodeIds).toEqual([second, third]);
    const reused = createBatchTag(created, [first, second], {
      name: 'merchant',
      color: '#9c9aed',
    });
    expect(reused.tags).toHaveLength(2);
    expect(reused.tags![1].nodeIds).toEqual([second, third, first]);
  });

  it('rejects a tag that no longer exists', () => {
    const w = workspace();
    expect(() => applyBatchTag(w, [first], crypto.randomUUID(), 'add')).toThrow(
      /no longer part of this workspace/,
    );
  });

  it('canonicalizes supplied references and ignores duplicates', () => {
    const w = workspace();
    const updated = applyBatchLabel(w, [txNodeId(a), txNodeId(a).toUpperCase()], 'Coinbase');
    expect(Object.keys(updated.annotations).filter((id) => id.startsWith('tx:'))).toEqual([
      txNodeId(a),
    ]);
  });
});

describe('strict batch boundaries', () => {
  it('rejects invalid references atomically for every mutation', () => {
    const w = workspace();
    const original = structuredClone(w);
    const ids = [third, 'invalid'];
    expect(() => applyBatchLabel(w, ids, 'Reviewed')).toThrow(/reference/);
    expect(() => applyBatchIcon(w, ids, '★')).toThrow(/reference/);
    expect(() => applyBatchTag(w, ids, w.tags![0].id, 'add')).toThrow(/reference/);
    expect(() => createBatchTag(w, ids, { name: 'New', color: '#65cbbb' })).toThrow(/reference/);
    expect(w).toEqual(original);
  });

  it('counts all supplied references toward the batch limit before deduplication', () => {
    const w = workspace();
    const ids = Array<string>(MAX_BATCH_TARGETS).fill(first);
    expect(applyBatchLabel(w, ids, 'Salary')).toBe(w);
    ids.push(first);
    expect(() => applyBatchLabel(w, ids, 'Changed')).toThrow(/at most 50,000/);
    expect(() => applyBatchIcon(w, ids, '★')).toThrow(/at most 50,000/);
    expect(() => applyBatchTag(w, ids, w.tags![0].id, 'remove')).toThrow(/at most 50,000/);
    expect(() => createBatchTag(w, ids, { name: 'New', color: '#65cbbb' })).toThrow(
      /at most 50,000/,
    );
  });
});

describe('batch undo ownership', () => {
  const session = () => {
    const store = new WorkspaceStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    const data = workspace();
    store.open(data, 'public batch undo fixture password');
    return { store, id: data.id };
  };
  const head = (store: WorkspaceStore, id: string) => store.getUnlocked(id)!.undoRevision;

  it('advances the undo head for an applied batch and for later unrelated edits', () => {
    const { store, id } = session();
    const start = head(store, id);
    store.update(id, (w) => applyBatchLabel(w, [second, third], 'Batch reviewed'));
    const batch = head(store, id);
    expect(batch).toBe(start + 1);
    // A later annotation edit takes ownership of the undo head.
    store.update(id, (w) => ({
      ...w,
      annotations: { ...w.annotations, [third]: { ...w.annotations[third], note: 'Later note' } },
    }));
    expect(head(store, id)).not.toBe(batch);
    // Undoing restores that later note only, and retires the older claim again.
    store.undo(id);
    expect(store.getUnlocked(id)!.data.annotations[third].note).toBe('');
    expect(store.getUnlocked(id)!.data.annotations[third].label).toBe('Batch reviewed');
    expect(head(store, id)).not.toBe(batch);
  });

  it('leaves the undo head untouched for presentation writes and no-op batches', () => {
    const { store, id } = session();
    store.update(id, (w) => applyBatchIcon(w, [first, second], '🤝'));
    const batch = head(store, id);
    store.update(id, (w) => ({ ...w, view: { ...w.view, selectionId: second } }), false);
    expect(head(store, id)).toBe(batch);
    // An identical batch changes nothing, so it creates no new undo step.
    store.update(id, (w) => applyBatchIcon(w, [first, second], '🤝'));
    expect(head(store, id)).toBe(batch);
  });
});
