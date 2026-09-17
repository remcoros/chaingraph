import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../createWorkspace';
import { validateWorkspace } from '../workspace';
import type { ScanRun } from '../ConnectionScan/connectionScans';
import { createWorkspacePersistence, parseWorkspace } from '../Persistence';
import { WorkspacePersistenceImplementation } from './workspacePersistence';
import { encryptWorkspace, decryptWorkspace } from './Codec/encryptedEnvelope';
import { legacyWorkspace } from '../../../../tests/fixtures/legacyWorkspace';

const password = 'public persistence facade fixture';

afterEach(() => vi.unstubAllGlobals());

function runningWorkspace() {
  const workspace = createWorkspace('Public scan fixture', 'mainnet');
  const run: ScanRun = {
    id: 'public-run',
    source: `tx:${'a'.repeat(64)}`,
    targetIds: [],
    settings: {
      direction: 'both',
      targetScope: 'custom',
      maxHops: 3,
      maxTransactions: 200,
      maxMilliseconds: 30_000,
      fanOut: 1000,
    },
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    examined: 0,
    stopReasons: [],
    results: [],
  };
  workspace.connectionScans = { runs: [run], evidence: {} };
  return workspace;
}

describe('public workspace persistence facade', () => {
  it('exports and opens files without touching unavailable browser storage', async () => {
    const storage = vi.fn(() => {
      throw new Error('Public fixture storage denied');
    });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: storage });
    try {
      const persistence = createWorkspacePersistence();
      const workspace = createWorkspace('Public file fixture', 'testnet4');
      const file = await persistence.exportFile(workspace, password);
      expect(await persistence.readFile(new Blob([file.contents]), password)).toEqual(workspace);
      expect(parseWorkspace(workspace)).toEqual(workspace);
      expect(storage).not.toHaveBeenCalled();
      expect(persistence.initialError).toContain('unreadable');
      expect(storage).toHaveBeenCalledOnce();
      // Even after a storage failure, portable file operations remain usable.
      expect(await persistence.readFile(new Blob([file.contents]), password)).toEqual(workspace);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it.each(['mainnet', 'testnet4'] as const)(
    'uses one legacy document pipeline for parsing, file reads and browser loads on %s',
    async (network) => {
      const current = createWorkspace('Public legacy fixture', network);
      const legacy = legacyWorkspace(current, 4);
      const before = structuredClone(legacy);
      const envelope = await encryptWorkspace(legacy, password);
      const entry = { id: current.id, publicName: current.name, savedAt: current.createdAt };
      const raw = JSON.stringify([{ ...entry, envelope }]);
      const persistence = new WorkspacePersistenceImplementation({
        storage: {
          getItem: () => raw,
          setItem: () => {
            throw new Error('Unexpected write');
          },
        },
      });
      expect(parseWorkspace(legacy)).toEqual(current);
      expect(await persistence.readFile(new Blob([JSON.stringify(envelope)]), password)).toEqual(
        current,
      );
      expect(await persistence.load(persistence.list()[0], password)).toEqual(current);
      expect(legacy).toEqual(before);
    },
  );

  it('preserves running scans in model validation and save/export, and interrupts only on reopening', async () => {
    const workspace = runningWorkspace();
    const persistence = createWorkspacePersistence();
    expect(validateWorkspace(workspace).connectionScans?.runs[0].status).toBe('running');
    const file = await persistence.exportFile(workspace, password);
    expect(await decryptWorkspace(JSON.parse(file.contents), password)).toMatchObject({
      connectionScans: { runs: [{ status: 'running' }] },
    });
    expect(parseWorkspace(workspace).connectionScans?.runs[0].status).toBe('interrupted');
    expect(
      (await persistence.readFile(new Blob([file.contents]), password)).connectionScans?.runs[0]
        .status,
    ).toBe('interrupted');
    expect(workspace.connectionScans?.runs[0].status).toBe('running');
  });

  it('rejects an aborted file read without making browser storage part of cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createWorkspacePersistence().readFile(new Blob(['invalid']), password, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
