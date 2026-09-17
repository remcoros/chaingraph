import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import {
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  labelBatchPlan,
} from '../../Annotations/batchEdits';
import { outpointReference, transactionReference } from '../../entityReferences';
import type { Workspace } from '../../workspace';
import type { Transaction } from '../../../ChainData';

import { createBrowserWorkspaceStore } from './workspaceStoreFixture';
import type { WorkspaceStore } from '../../Session/WorkspaceStore';

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
const first = outpointReference(a, 0),
  second = outpointReference(a, 1),
  third = outpointReference(a, 2);

function workspace(): Workspace {
  const w = createWorkspace('Batch fixture', 'mainnet');
  w.chainData.transactions = { [a]: structuredClone(funding), [b]: structuredClone(spending) };
  w.annotations.entities = {
    [first]: { label: 'Salary', note: 'January invoice', icon: '★', bookmarked: true },
    [second]: { label: 'Rent', note: '', icon: '', bookmarked: false },
  };
  w.annotations.tags = [
    { id: crypto.randomUUID(), name: 'Exchange', color: '#65cbbb', nodeIds: [first] },
  ];
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
    expect(updated.annotations.entities[second]).toEqual({
      label: 'Utility payment',
      note: '',
      icon: '',
      bookmarked: false,
    });
    expect(updated.annotations.entities[third].label).toBe('Utility payment');
    expect(updated.annotations.entities[first]).toEqual(w.annotations.entities[first]);
    expect(updated.chainData.transactions).toBe(w.chainData.transactions);
    expect(updated.annotations.tags).toBe(w.annotations.tags);
  });

  it('keeps existing labels when only unlabeled entities are targeted', () => {
    const w = workspace();
    const updated = applyBatchLabel(w, [first, second, third], 'Batch', { onlyUnlabeled: true });
    expect(updated.annotations.entities[first].label).toBe('Salary');
    expect(updated.annotations.entities[second].label).toBe('Rent');
    expect(updated.annotations.entities[third].label).toBe('Batch');
  });

  it('clears labels explicitly and returns the same workspace for a no-op batch', () => {
    const w = workspace();
    const cleared = applyBatchLabel(w, [first], '');
    expect(cleared.annotations.entities[first].label).toBe('');
    expect(cleared.annotations.entities[first].note).toBe('January invoice');
    expect(applyBatchLabel(cleared, [first], '')).toBe(cleared);
    expect(applyBatchLabel(w, [], 'Ignored')).toBe(w);
  });
});

describe('batch icon edits', () => {
  it('sets and clears icons without touching labels, notes or bookmarks', () => {
    const w = workspace();
    const updated = applyBatchIcon(w, [first, second], '🤝');
    expect(updated.annotations.entities[first]).toEqual({
      label: 'Salary',
      note: 'January invoice',
      icon: '🤝',
      bookmarked: true,
    });
    expect(updated.annotations.entities[second].icon).toBe('🤝');
    const cleared = applyBatchIcon(updated, [first], '');
    expect(cleared.annotations.entities[first].icon).toBe('');
    expect(cleared.annotations.entities[second].icon).toBe('🤝');
  });
});

describe('batch tag edits', () => {
  it('adds and removes only the supplied entities', () => {
    const w = workspace();
    const tagId = w.annotations.tags![0].id;
    const added = applyBatchTag(w, [second, third], tagId, 'add');
    expect(added.annotations.tags![0].nodeIds).toEqual([first, second, third]);
    const removed = applyBatchTag(added, [first, second], tagId, 'remove');
    expect(removed.annotations.tags![0].nodeIds).toEqual([third]);
    expect(removed.annotations.entities).toBe(w.annotations.entities);
    expect(applyBatchTag(removed, [first], tagId, 'remove')).toBe(removed);
  });

  it('creates a tag with the selection and reuses an existing name instead of duplicating it', () => {
    const w = workspace();
    const created = createBatchTag(w, [second, third], { name: 'Merchant', color: '#e4af67' });
    expect(created.annotations.tags).toHaveLength(2);
    expect(created.annotations.tags![1].nodeIds).toEqual([second, third]);
    const reused = createBatchTag(created, [first, second], {
      name: 'merchant',
      color: '#9c9aed',
    });
    expect(reused.annotations.tags).toHaveLength(2);
    expect(reused.annotations.tags![1].nodeIds).toEqual([second, third, first]);
  });

  it('rejects a tag that no longer exists', () => {
    const w = workspace();
    expect(() => applyBatchTag(w, [first], crypto.randomUUID(), 'add')).toThrow(
      /no longer part of this workspace/,
    );
  });

  it('canonicalizes supplied references and ignores duplicates', () => {
    const w = workspace();
    const updated = applyBatchLabel(
      w,
      [transactionReference(a), transactionReference(a).toUpperCase()],
      'Coinbase',
    );
    expect(Object.keys(updated.annotations.entities).filter((id) => id.startsWith('tx:'))).toEqual([
      transactionReference(a),
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
    expect(() => applyBatchTag(w, ids, w.annotations.tags![0].id, 'add')).toThrow(/reference/);
    expect(() => createBatchTag(w, ids, { name: 'New', color: '#65cbbb' })).toThrow(/reference/);
    expect(w).toEqual(original);
  });

  it('counts all supplied references toward the batch limit before deduplication', () => {
    const w = workspace();
    const ids = Array<string>(50_000).fill(first);
    expect(applyBatchLabel(w, ids, 'Salary')).toBe(w);
    ids.push(first);
    expect(() => applyBatchLabel(w, ids, 'Changed')).toThrow(/at most 50,000/);
    expect(() => applyBatchIcon(w, ids, '★')).toThrow(/at most 50,000/);
    expect(() => applyBatchTag(w, ids, w.annotations.tags![0].id, 'remove')).toThrow(
      /at most 50,000/,
    );
    expect(() => createBatchTag(w, ids, { name: 'New', color: '#65cbbb' })).toThrow(
      /at most 50,000/,
    );
  });
});

describe('batch undo ownership', () => {
  const session = () => {
    const store = createBrowserWorkspaceStore({
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
      annotations: {
        ...w.annotations,
        entities: {
          ...w.annotations.entities,
          [third]: { ...w.annotations.entities[third], note: 'Later note' },
        },
      },
    }));
    expect(head(store, id)).not.toBe(batch);
    // Undoing restores that later note only, and retires the older claim again.
    store.undo(id);
    expect(store.getUnlocked(id)!.data.annotations.entities[third].note).toBe('');
    expect(store.getUnlocked(id)!.data.annotations.entities[third].label).toBe('Batch reviewed');
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
