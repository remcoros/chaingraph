import { describe, expect, it } from 'vitest';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { WorkspaceSessionStore } from '../src/App/Workspace/useWorkspaces';

function setup() {
  const store = new WorkspaceSessionStore({
    storage: { getItem: () => null, setItem: () => undefined },
  });
  const workspace = newWorkspace('Undo fixture', 'mainnet');
  store.open(workspace, 'public test passphrase');
  return { store, id: workspace.id, session: () => store.getSession(workspace.id)! };
}

describe('undo entry descriptions', () => {
  it('keeps the next action paired with its snapshot across undo and camera updates', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, name: 'Renamed' }));
    store.update(id, (w) => ({ ...w, description: 'New description' }));
    expect(session().history.at(-1)?.description).toBe('Edit workspace description');
    const head = session().undoRevision;
    store.update(id, (w) => w);
    store.update(id, (w) => ({ ...w, view: { ...w.view, dimensions: 2 } }), false);
    expect(session().undoRevision).toBe(head);
    expect(session().history.at(-1)?.description).toBe('Edit workspace description');
    store.undo(id);
    expect(session().data.description).toBeUndefined();
    expect(session().data.view.dimensions).toBe(2);
    expect(session().history.at(-1)?.description).toBe('Rename workspace');
    store.undo(id);
    expect(session().data.name).toBe('Undo fixture');
    expect(session().history).toEqual([]);
  });

  it('describes all fields in a coalesced annotation edit and restores its starting state', () => {
    const { store, id, session } = setup();
    const node = `tx:${'a'.repeat(64)}`;
    store.update(
      id,
      (w) => ({
        ...w,
        annotations: {
          ...w.annotations,
          [node]: { label: 'Label', note: '', icon: '', bookmarked: false },
        },
      }),
      true,
      'annotation',
    );
    store.update(
      id,
      (w) => ({
        ...w,
        annotations: { ...w.annotations, [node]: { ...w.annotations[node], note: 'Note' } },
      }),
      true,
      'annotation',
    );
    expect(session().history).toHaveLength(1);
    expect(session().history[0].description).toBe('Edit annotations');
    store.undo(id);
    expect(session().data.annotations[node]).toBeUndefined();
  });

  it('bounds and clears descriptions together with history when chain evidence changes', () => {
    const { store, id, session } = setup();
    for (let i = 0; i < 18; i++) {
      store.update(id, (w) => ({ ...w, name: `Name ${i}` }), true, undefined, `Edit ${i}`);
    }
    expect(session().history).toHaveLength(15);
    expect(session().history[0].description).toBe('Edit 3');
    expect(session().history.at(-1)?.description).toBe('Edit 17');
    const txid = 'a'.repeat(64);
    store.update(
      id,
      (w) => ({
        ...w,
        transactions: { [txid]: { txid, vin: [{ coinbase: '00' }], vout: [] } },
      }),
      false,
    );
    expect(session().history).toEqual([]);
    expect(session().data).not.toHaveProperty('history');
  });

  it('keeps explicit path descriptions local to the owning session', () => {
    const { store, id, session } = setup();
    store.update(id, (w) => ({ ...w, description: 'Path fixture' }), true, undefined, 'Add path');
    const other = newWorkspace('Other workspace', 'testnet4');
    store.open(other, 'public test passphrase');
    expect(store.getSession(other.id)?.history).toEqual([]);
    expect(session().history.at(-1)?.description).toBe('Add path');
  });
});
