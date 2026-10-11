import { describe, expect, it, vi } from 'vitest';
import { WorkspaceStore } from './WorkspaceStore';
import { createWorkspace } from '../createWorkspace';
import {
  applyLabelImport,
  defaultLabelImportOptions,
  inspectLabels,
  planLabelImport,
  type LabelProfile,
} from '../Annotations/labels';
import { PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';

describe('captured workspace operations', () => {
  it.each<LabelProfile>(['generic', 'btcpay'])(
    'applies a reviewed %s exchange as one reversible session edit',
    async (profile) => {
      const persistence = {
        initialError: '',
        list: () => [],
        assertCurrent: () => {},
        save: vi.fn(async () => []),
        load: vi.fn(),
        remove: vi.fn(),
        readFile: vi.fn(),
        exportFile: vi.fn(),
      };
      const workspace = createWorkspace('Public exchange fixture', 'mainnet');
      workspace.wallets.definitions.push({
        id: crypto.randomUUID(),
        name: 'Original wallet name',
        key: PUBLIC_ZPUB,
        scriptType: 'p2wpkh',
        color: '#aabbcc',
        addresses: [],
      });
      const content = [
        { type: 'tx', ref: 'a'.repeat(64), label: 'First imported value' },
        { type: 'tx', ref: 'b'.repeat(64), label: 'Second imported value' },
        { type: 'xpub', ref: PUBLIC_ZPUB, label: 'Imported wallet name' },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n');
      const store = new WorkspaceStore(persistence);
      store.open(workspace, 'public test password');
      const plan = planLabelImport(workspace, inspectLabels(content, 'mainnet'), {
        ...defaultLabelImportOptions('mainnet'),
        profile,
        renameWallets: true,
      });
      expect(plan.changes.length).toBeGreaterThan(1);
      store.getUnlocked(workspace.id)!.edit((current) => applyLabelImport(current, plan));
      const imported = store.getUnlocked(workspace.id)!;
      expect(imported.undoRevision).toBe(1);
      expect(imported.data.annotations).toEqual(plan.next.annotations);
      expect(imported.data.wallets.definitions).toEqual(plan.next.wallets.definitions);
      imported.undo();
      expect(store.getUnlocked(workspace.id)!.data).toEqual(workspace);
      store.getUnlocked(workspace.id)!.redo();
      expect(store.getUnlocked(workspace.id)!.data).toEqual(plan.next);
      await store.getUnlocked(workspace.id)!.lock();
    },
  );
  it('cannot edit, undo, save, pause or close a later reopening of the same workspace', async () => {
    const persistence = {
      initialError: '',
      list: () => [],
      assertCurrent: () => {},
      save: vi.fn(async () => []),
      load: vi.fn(),
      remove: vi.fn(),
      readFile: vi.fn(),
      exportFile: vi.fn(),
    };
    const store = new WorkspaceStore(persistence);
    const workspace = createWorkspace('Public lifetime fixture', 'mainnet');
    store.open(workspace, 'public test password');
    const previous = store.getUnlocked(workspace.id)!;
    await previous.lock();
    store.open(workspace, 'public test password');
    const current = store.getUnlocked(workspace.id)!;
    current.edit((data) => ({ ...data, name: 'Current user edit' }));
    const update = vi.fn((data) => ({ ...data, name: 'Stale edit' }));
    previous.edit(update);
    previous.undo();
    previous.redo();
    previous.pauseAutosave(true);
    await previous.persist();
    await previous.lock();
    expect(update).not.toHaveBeenCalled();
    expect(store.getUnlocked(workspace.id)).toMatchObject({
      data: { name: 'Current user edit' },
      autosavePaused: false,
      locking: false,
    });
    expect(current.fetchScope.closed).toBe(false);
    expect(persistence.save).toHaveBeenCalledOnce();
    current.undo();
    expect(store.getUnlocked(workspace.id)!.data.name).toBe(workspace.name);
  });
});
