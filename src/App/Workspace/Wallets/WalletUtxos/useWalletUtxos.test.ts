// @vitest-environment jsdom
import { useSyncExternalStore } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalletUtxoBatch } from '../../../../Core/Workspace/Wallets/WalletUtxos/fetchWalletUtxos';
import { useWalletUtxos } from './useWalletUtxos';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import { createWorkspacePersistence, parseWorkspace } from '../../../../Core/Workspace/Persistence';
import { WorkspaceStore } from '../../../../Core/Workspace/Session/WorkspaceStore';
import { createChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import { deriveAddresses } from '../../../../Core/Workspace/Wallets/walletDerivation';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';

const oldTime = '2026-09-01T10:00:00.000Z';
function fixture(count = 1, saved = false, refreshed = false) {
  const workspace = createWorkspace('Public UTXO hook fixture', 'mainnet');
  const wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Public wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, count),
  };
  workspace.wallets.definitions = [wallet];
  if (saved)
    workspace.chainData.addressUtxos = Object.fromEntries(
      wallet.addresses.map((address) => [
        address.address,
        { network: 'mainnet', checkedAt: oldTime, utxos: [] },
      ]),
    );
  const store = new WorkspaceStore(createWorkspacePersistence());
  store.open(parseWorkspace(workspace), 'public fixture password');
  const acquisition = createChainDataAcquisition({
    activeWorkspace: workspace,
    getUnlocked: store.getUnlocked,
    fetchScope: store.getUnlocked(workspace.id)!.fetchScope,
  });
  const batch: WalletUtxoBatch = {
    walletId: wallet.id,
    network: 'mainnet',
    records: [],
    observations: {},
    checkedAt: oldTime,
    totalAddresses: count,
    checkedAddresses: Math.min(count, 100),
    successfulAddresses: Math.min(count, 100),
    nextCursor: count > 100 ? 100 : undefined,
    errors: [
      {
        address: wallet.addresses[0].address,
        message: 'Could not verify the UTXO response for this address. Retry the check.',
      },
    ],
  };
  const completedCheck = refreshed
    ? { wallet: store.getUnlocked(workspace.id)!.data.wallets.definitions[0], coins: batch }
    : undefined;
  const hook = renderHook(
    ({ enabled, completedCheck }) => {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
      const current = snapshot.unlocked[0].data;
      return useWalletUtxos({
        workspace: current,
        wallet: current.wallets.definitions[0],
        transactions: acquisition,
        enabled,
        completedCheck,
      });
    },
    { initialProps: { enabled: true, completedCheck } },
  );
  return { ...hook, store, workspace, wallet, completedCheck };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('retained wallet UTXO request state', () => {
  it('keeps the latest refresh continuation visible despite complete older coverage, without renewing its date', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: [] }))),
    );
    const view = fixture(101, true, true);
    expect(fetch).not.toHaveBeenCalled();
    expect(view.result.current.utxos).toMatchObject({
      nextCursor: 100,
      checkedAt: oldTime,
      failed: 1,
    });
    await act(() => view.result.current.check(100));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(view.result.current.utxos).toMatchObject({
      nextCursor: undefined,
      checkedAt: oldTime,
      failed: 1,
    });
    view.rerender({
      enabled: true,
      completedCheck: {
        ...view.completedCheck!,
        coins: { ...view.completedCheck!.coins, nextCursor: 100 },
      },
    });
    expect(view.result.current.utxos?.nextCursor).toBe(100);
  });
  it('ignores a completed refresh summary whose discovered address snapshot is obsolete', async () => {
    const view = fixture(101, true, true);
    await act(async () =>
      view.store.getUnlocked(view.workspace.id)!.edit(
        (current) => ({
          ...current,
          wallets: {
            ...current.wallets,
            definitions: current.wallets.definitions.map((entry) => ({
              ...entry,
              addresses: [...entry.addresses],
            })),
          },
        }),
        false,
      ),
    );
    expect(view.result.current.utxos).toMatchObject({
      nextCursor: undefined,
      checkedAt: oldTime,
      failed: 0,
    });
    expect(view.result.current.error).toBe('');
  });
  it('reopens a dated successful empty check without silently refreshing it, and retains it on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    const view = fixture(1, true);
    expect(fetch).not.toHaveBeenCalled();
    expect(view.result.current.utxos).toMatchObject({
      records: [],
      checkedAt: oldTime,
      checkedAddresses: 1,
    });
    await act(() => view.result.current.check());
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.error).toContain('Previous observations were retained');
    expect(view.result.current.utxos?.checkedAt).toBe(oldTime);
    expect(view.result.current.utxos?.failed).toBe(1);
  });

  it('keeps bounded continuation and publishes successful empty observations into the workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: [] }))),
    );
    const view = fixture(101);
    await act(() => view.result.current.check());
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(100);
    expect(view.result.current.utxos).toMatchObject({
      checkedAddresses: 100,
      totalAddresses: 101,
      nextCursor: 100,
    });
    const firstTime = view.result.current.utxos!.checkedAt;
    await act(() => view.result.current.check(100));
    expect(fetch).toHaveBeenCalledTimes(101);
    expect(view.result.current.utxos).toMatchObject({
      checkedAddresses: 101,
      nextCursor: undefined,
      checkedAt: firstTime,
    });
    const restored = parseWorkspace(view.store.getUnlocked(view.workspace.id)!.data);
    expect(Object.keys(restored.chainData.addressUtxos!)).toHaveLength(101);
  });

  it('does not publish a late batch after the controlling UI is disabled', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const view = fixture();
    act(() => {
      void view.result.current.check();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    view.rerender({ enabled: false, completedCheck: undefined });
    await act(async () => {
      resolve(new Response(JSON.stringify({ result: [] })));
    });
    expect(view.result.current.loading).toBe(false);
    expect(view.store.getUnlocked(view.workspace.id)!.data.chainData.addressUtxos).toBeUndefined();
  });
});
