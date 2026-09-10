import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { decryptWorkspace } from '../../src/lib/crypto';
import { mockBitcoin } from '../fixtures/bitcoin';

const password = 'public overflow browser fixture';
for (const mode of ['large', 'quota', 'without-web-locks'] as const) {
  test(`encrypted ${mode} backing survives browser reload, editing, export and deletion`, async ({
    page,
  }) => {
    await mockBitcoin(page);
    if (mode === 'without-web-locks') {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'locks', { value: undefined }),
      );
    }
    await page.addInitScript(() => localStorage.setItem('chaingraph.tour.seen', '1'));
    await page.goto('/');
    const seeded = await page.evaluate(
      async ({ mode, password }) => {
        const storeModule = '/src/lib/useWorkspaces.ts',
          workspaceModule = '/src/domain/workspace.ts';
        const { WorkspaceSessionStore, STORAGE_KEY } = await import(storeModule);
        const { newWorkspace } = await import(workspaceModule);
        const workspace = newWorkspace('IndexedDB browser fixture', 'mainnet');
        workspace.description = 'Encrypted original description';
        if (mode !== 'quota') {
          for (let i = 0; i < 120; i++)
            workspace.annotations[`tx:${i.toString(16).padStart(64, '0')}`] = {
              label: '',
              // Synthetic noise keeps this storage fixture large after gzip.
              note:
                'private annotation ' +
                btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(6750)))),
              bookmarked: false,
              icon: '',
            };
        }
        const storage =
          mode === 'quota'
            ? {
                getItem: (key: string) => localStorage.getItem(key),
                setItem: (key: string, value: string) => {
                  if (value.length > 500)
                    throw new DOMException('Synthetic quota', 'QuotaExceededError');
                  localStorage.setItem(key, value);
                },
              }
            : undefined;
        const store = new WorkspaceSessionStore({ storage });
        store.open(workspace, password);
        await store.lock(workspace.id);
        return {
          id: workspace.id,
          index: localStorage.getItem(STORAGE_KEY)!,
          annotations: Object.keys(workspace.annotations).length,
        };
      },
      { mode, password },
    );
    expect(seeded.index).toContain('envelopeRef');
    expect(seeded.index).not.toContain('ciphertext');
    expect(seeded.index).not.toContain('Encrypted original description');
    expect(seeded.index.length).toBeLessThan(500);
    await page.reload();
    await page.locator('.saved-row').click();
    const unlock = page.getByRole('dialog', { name: 'Unlock workspace' });
    await unlock.getByLabel('Password', { exact: true }).fill(password);
    await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.locator('.workspace-description')).toContainText(
      'Encrypted original description',
    );
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Workspace details', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Workspace details' });
    await details.getByLabel('Workspace description').fill('Latest encrypted description');
    await details.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export encrypted workspace', exact: true }).click();
    const downloaded = await downloadPromise;
    const envelope = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
    const exported = (await decryptWorkspace(envelope, password)) as {
      id: string;
      description: string;
      annotations: object;
    };
    expect(exported.id).toBe(seeded.id);
    expect(exported.description).toBe('Latest encrypted description');
    expect(Object.keys(exported.annotations)).toHaveLength(seeded.annotations);
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
    await expect(page.locator('.saved-row')).toHaveCount(1);
    await page.reload();
    await page.locator('.saved-row').click();
    await unlock.getByLabel('Password', { exact: true }).fill(password);
    await unlock.getByRole('button', { name: 'Unlock workspace', exact: true }).click();
    await expect(page.locator('.workspace-description')).toContainText(
      'Latest encrypted description',
    );
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
    await page.getByRole('button', { name: 'Lock workspace', exact: true }).click();
    await expect(page.locator('.saved-row')).toHaveCount(1);
    await page
      .getByRole('button', {
        name: 'Delete saved workspace IndexedDB browser fixture',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Delete from this browser', exact: true }).click();
    await expect(page.locator('.saved-row')).toHaveCount(0);
    const count = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('chaingraph.encrypted-envelopes.v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error('Fixture database unavailable'));
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const tx = db.transaction('envelopes', 'readonly');
          const request = tx.objectStore('envelopes').count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error('Fixture count failed'));
        });
      } finally {
        db.close();
      }
    });
    expect(count).toBe(0);
  });
}

test('simultaneous browser tabs without Web Locks preserve the winning index and unsaved losing edits', async ({
  page,
}) => {
  const other = await page.context().newPage();
  try {
    for (const target of [page, other]) {
      await mockBitcoin(target);
      await target.addInitScript(() => {
        Object.defineProperty(navigator, 'locks', { value: undefined });
        localStorage.setItem('chaingraph.tour.seen', '1');
      });
      await target.goto('/');
    }
    const ids = await page.evaluate(async (password) => {
      const storeModule = '/src/lib/useWorkspaces.ts',
        workspaceModule = '/src/domain/workspace.ts';
      const { WorkspaceSessionStore } = await import(storeModule);
      const { newWorkspace } = await import(workspaceModule);
      const store = new WorkspaceSessionStore({
        storage: {
          getItem: (key: string) => localStorage.getItem(key),
          setItem: (key: string, value: string) => {
            if (value.length > 700) throw new DOMException('Synthetic quota', 'QuotaExceededError');
            localStorage.setItem(key, value);
          },
        },
      });
      const first = newWorkspace('First original', 'mainnet'),
        second = newWorkspace('Second original', 'testnet4');
      store.open(first, password);
      store.open(second, password);
      await store.lock(first.id);
      await store.lock(second.id);
      return [first.id, second.id];
    }, password);
    type RaceWindow = Window & {
      storageTestReady?: boolean;
      storageTestRelease?: () => void;
      storageTestOutcome?: Promise<{ status: 'saved' | 'conflict'; dirty: boolean; error: string }>;
    };
    await Promise.all(
      [page, other].map((target, index) =>
        target.evaluate(
          async ({ id, password, index }) => {
            const storeModule = '/src/lib/useWorkspaces.ts',
              cryptoModule = '/src/lib/crypto.ts';
            const { WorkspaceSessionStore } = await import(storeModule);
            const { encryptWorkspace } = await import(cryptoModule);
            const state = window as RaceWindow;
            const store = new WorkspaceSessionStore({
              encrypt: async (data: unknown, key: string) => {
                const envelope = await encryptWorkspace(data, key);
                await new Promise<void>((resolve) => {
                  state.storageTestRelease = resolve;
                  state.storageTestReady = true;
                });
                return envelope;
              },
            });
            const entry = store
              .getSnapshot()
              .saved.find((saved: { id: string }) => saved.id === id);
            await store.unlock(entry, password);
            store.update(id, (data: object) => ({
              ...data,
              name: `${index === 0 ? 'First' : 'Second'} edited`,
            }));
            const result = (status: 'saved' | 'conflict') => {
              const snapshot = store.getSnapshot(),
                session = snapshot.sessions[0];
              return {
                status,
                dirty: session.revision !== session.savedRevision,
                error: snapshot.storageError,
              };
            };
            state.storageTestOutcome = store.persist(id).then(
              () => result('saved'),
              () => result('conflict'),
            );
          },
          { id: ids[index], password, index },
        ),
      ),
    );
    for (const target of [page, other]) {
      await expect
        .poll(() => target.evaluate(() => (window as RaceWindow).storageTestReady))
        .toBe(true);
    }
    await Promise.all(
      [page, other].map((target) =>
        target.evaluate(() => (window as RaceWindow).storageTestRelease!()),
      ),
    );
    const results = await Promise.all(
      [page, other].map((target) =>
        target.evaluate(() => (window as RaceWindow).storageTestOutcome!),
      ),
    );
    expect(results.filter((result) => result.status === 'saved')).toHaveLength(1);
    const loser = results.find((result) => result.status === 'conflict')!;
    expect(loser.dirty).toBe(true);
    expect(loser.error).toContain('another tab');
    const restored = await page.evaluate(async (password) => {
      const modulePath = '/src/lib/useWorkspaces.ts';
      const { WorkspaceSessionStore } = await import(modulePath);
      const store = new WorkspaceSessionStore();
      for (const entry of store.getSnapshot().saved) await store.unlock(entry, password);
      return store
        .getSnapshot()
        .sessions.map((session: { data: { id: string; name: string } }) => ({
          id: session.data.id,
          name: session.data.name,
        }));
    }, password);
    expect(restored.map((entry: { id: string }) => entry.id).sort()).toEqual([...ids].sort());
    expect(
      restored.filter((entry: { name: string }) => entry.name.endsWith('edited')),
    ).toHaveLength(1);
  } finally {
    await other.close();
  }
});
