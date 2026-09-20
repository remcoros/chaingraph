// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useEffect: () => {} };
});

import { useWalletUtxos } from './useWalletUtxos';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import { createWorkspacePersistence, parseWorkspace } from '../../../../Core/Workspace/Persistence';
import { createChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import { WorkspaceStore } from '../../../../Core/Workspace/Session/WorkspaceStore';
import { deriveAddresses } from '../../../../Core/Workspace/Wallets/walletDerivation';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';

function fixture() {
  const workspace = createWorkspace('Public UTXO scope fixture', 'mainnet');
  const addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1);
  workspace.wallets.definitions = [
    {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'First wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses,
    },
    {
      id: '30000000-0000-4000-8000-000000000002',
      name: 'Second wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses,
    },
  ];
  const store = new WorkspaceStore(createWorkspacePersistence());
  store.open(parseWorkspace(workspace), 'public fixture password');
  const acquisition = createChainDataAcquisition({
    activeWorkspace: workspace,
    getUnlocked: store.getUnlocked,
    fetchScope: store.getUnlocked(workspace.id)!.fetchScope,
  });
  return { acquisition, store, workspace };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('wallet UTXO scope guard', () => {
  it('rejects a prior wallet completion while passive scope effects are deferred', async () => {
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
    const setup = fixture();
    const view = renderHook(
      ({ walletIndex }) => {
        const current = setup.store.getUnlocked(setup.workspace.id)!.data;
        return useWalletUtxos({
          workspace: current,
          wallet: current.wallets.definitions[walletIndex],
          transactions: setup.acquisition,
          enabled: true,
        });
      },
      { initialProps: { walletIndex: 0 } },
    );
    const pending = view.result.current.check();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    view.rerender({ walletIndex: 1 });
    await act(async () => {
      resolve(new Response(JSON.stringify({ result: [] })));
      await pending;
    });
    expect(
      setup.store.getUnlocked(setup.workspace.id)!.data.chainData.addressUtxos,
    ).toBeUndefined();
  });
});
