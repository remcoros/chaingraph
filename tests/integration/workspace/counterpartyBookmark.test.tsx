// @vitest-environment jsdom
import { useLayoutEffect, useMemo, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceStore } from '../../../src/Core/Workspace/Session/WorkspaceStore';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { createChainDataAcquisition } from '../../../src/Core/Workspace/Session/chainDataAcquisition';
import { saveCounterparty } from '../../../src/Core/Workspace/Counterparties/counterparties';
import { emptyAnnotation } from '../../../src/Core/Workspace/Annotations/emptyAnnotation';
import { useWorkspaces } from '../../../src/App/Workspace/useWorkspaces';
import { useWorkspace, type WorkspaceController } from '../../../src/App/Workspace/useWorkspace';
import type { AppState } from '../../../src/App/useAppState';
import { EntitiesPanel } from '../../../src/App/Workspace/Workbenches/Graph/EntitiesPanel/EntitiesPanel';
import { WalletWorkbench } from '../../../src/App/Workspace/Workbenches/Wallet/WalletWorkbench';
import { PUBLIC_ZPUB, TX_FUNDING, TX_SPENDING, transactions } from '../../fixtures/bitcoin';
import { deriveAddresses } from '../../../src/Core/Workspace/Wallets/walletDerivation';

const partyId = '40000000-0000-4000-8000-000000000001';
const selectedWalletId = '30000000-0000-4000-8000-000000000002';
const stores: WorkspaceStore[] = [];
beforeEach(() => {
  localStorage.setItem('chaingraph.tour.seen', '1');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0))
    for (const session of store.getSnapshot().unlocked) session.fetchScope.close();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function fixture() {
  const store = new WorkspaceStore({
    initialError: '',
    list: () => [],
    assertCurrent: () => {},
    save: vi.fn(async () => []),
    load: vi.fn(),
    remove: vi.fn(),
    readFile: vi.fn(),
    exportFile: vi.fn(),
  });
  stores.push(store);
  const initial = createWorkspace('Shared bookmark handoff', 'mainnet');
  const first = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'First wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2),
  };
  initial.wallets.definitions = [
    first,
    { ...first, id: selectedWalletId, name: 'Selected wallet' },
  ];
  initial.chainData.transactions = structuredClone(transactions);
  initial.view = {
    ...initial.view,
    workbench: 'graph',
    selectedWallet: selectedWalletId,
    graphNodeIds: [`tx:${TX_SPENDING}`],
    selectionId: `tx:${TX_SPENDING}`,
    panels: { left: { tab: 'bookmarks' } },
    wallet: {
      [selectedWalletId]: {
        activeTab: 'review',
        tabs: { counterparties: { query: 'a different contact' } },
      },
    },
  };
  const workspace = saveCounterparty(
    initial,
    { id: partyId, name: 'Public contact' },
    {
      kind: 'wallet-transaction',
      walletId: selectedWalletId,
      transactionId: TX_FUNDING,
      direction: 'received',
      walletOutputIds: [`out:${TX_FUNDING}:0`],
    },
  );
  workspace.annotations.entities[`party:${partyId}`] = {
    ...workspace.annotations.entities[`party:${partyId}`],
    bookmarked: true,
  };
  workspace.annotations.entities[`tx:${TX_FUNDING}`] = {
    ...emptyAnnotation,
    label: 'Public transaction',
    bookmarked: true,
  };
  store.open(workspace, 'public test password');
  return { store, workspace };
}

function Fixture({
  store,
  onController,
}: {
  store: WorkspaceStore;
  onController?: (controller: WorkspaceController) => void;
}) {
  const workspaces = useWorkspaces(store);
  const activeWorkspace = workspaces.active?.data;
  const activeWorkspaceRef = useRef(activeWorkspace);
  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  });
  const fetchScope = workspaces.active?.fetchScope;
  const chainDataAcquisition = useMemo(
    () =>
      createChainDataAcquisition({
        activeWorkspace,
        getUnlocked: store.getUnlocked,
        fetchScope,
      }),
    [activeWorkspace, store, fetchScope],
  );
  const callbacks = useMemo(
    () => ({
      setError: vi.fn(),
      setNotice: vi.fn(),
      setNoticeSequence: vi.fn(),
      setExamplesOpen: vi.fn(),
      setPendingGraphWorkspace: vi.fn(),
      registerGraphSnapshotFlush: vi.fn(),
      flushActiveGraph: () => activeWorkspaceRef.current?.id,
    }),
    [],
  );
  const controller = useWorkspace({
    ...callbacks,
    workspaces,
    activeWorkspace,
    activeWorkspaceRef,
    fetchScope,
    chainDataAcquisition,
    getUnlockedWorkspace: store.getUnlocked,
    workspaceId: activeWorkspace?.id,
    networks: ['mainnet'],
    connected: false,
    unsupportedNetwork: false,
    discoveryError: '',
    displayNetwork: 'mainnet',
  } as unknown as AppState);
  const { graphWorkspaceRef, shownWorkbench } = controller;
  useLayoutEffect(() => {
    onController?.(controller);
  }, [controller, onController]);
  return (
    <>
      <nav aria-label="Test workbench navigation">
        <button onClick={() => controller.switchWorkbench('wallet')}>Open Wallet</button>
        <button onClick={() => controller.switchWorkbench('graph')}>Open Graph</button>
        {controller.returnWorkbench && (
          <button
            onClick={() =>
              controller.switchWorkbench(controller.returnWorkbench!, { interaction: 'return' })
            }
          >
            Return to origin
          </button>
        )}
      </nav>
      <section
        ref={graphWorkspaceRef}
        hidden={shownWorkbench !== 'graph'}
        tabIndex={-1}
        aria-label="Graph workspace"
      >
        <EntitiesPanel workspace={controller} />
      </section>
      <WalletWorkbench workspace={controller} />
    </>
  );
}

it.each(['import', 'export'] as const)(
  'opens wallet metadata %s for the selected wallet without changing annotations',
  async (direction) => {
    const f = fixture();
    let controller!: WorkspaceController;
    render(
      <Fixture
        store={f.store}
        onController={(value) => {
          controller = value;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Wallet' }));
    await screen.findByRole('navigation', { name: 'Wallet sections' });
    const before = f.store.getUnlocked(f.workspace.id)!.data.annotations;
    fireEvent.click(screen.getByRole('button', { name: 'Wallet actions' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: new RegExp(`${direction} wallet metadata`, 'i') }),
    );
    expect(controller.annotations.labelTransfer).toMatchObject({
      kind: direction,
      workspaceId: f.workspace.id,
      options: { scope: { kind: 'wallet', walletId: selectedWalletId } },
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(f.store.getUnlocked(f.workspace.id)!.data.annotations).toBe(before);
    act(() => controller.annotations.closeLabelTransfer());
    expect(controller.annotations.labelTransfer).toBeUndefined();
  },
);

it.each([false, true])(
  'hands a counterparty bookmark to Wallet with its identity selected (Wallet already mounted: %s)',
  async (warm) => {
    const f = fixture();
    render(<Fixture store={f.store} />);
    if (warm) {
      fireEvent.click(screen.getByRole('button', { name: 'Open Wallet' }));
      await screen.findByRole('navigation', { name: 'Wallet sections' });
      fireEvent.click(screen.getByRole('button', { name: 'Open Graph' }));
    }
    const graph = screen.getByRole('region', { name: 'Graph workspace' });
    const bookmark = within(graph).getByRole('button', { name: /Public contact/ });
    bookmark.focus();
    fireEvent.click(bookmark);
    const records = await screen.findByRole('list', { name: 'Counterparty records' });
    expect(
      within(records).getByRole('link', { name: 'Public contact' }).getAttribute('aria-current'),
    ).toBe('true');
    const party = screen.getByRole('region', { name: 'Counterparty details' });
    expect(within(party).getByRole('heading', { name: 'Public contact' })).toBeTruthy();
    expect(
      (screen.getByRole('searchbox', { name: 'Find counterparties' }) as HTMLInputElement).value,
    ).toBe('');
    expect(
      screen.getByRole('button', { name: 'Counterparties' }).getAttribute('aria-pressed'),
    ).toBe('true');
    const data = () => f.store.getUnlocked(f.workspace.id)!.data;
    expect(data().view.selectedWallet).toBe(selectedWalletId);
    expect(data().view.selectionId).toBe(`tx:${TX_SPENDING}`);
    expect(data().view.graphNodeIds).toEqual([`tx:${TX_SPENDING}`]);
    fireEvent.click(screen.getByRole('button', { name: 'Return to origin' }));
    expect(screen.getByRole('region', { name: 'Graph workspace' })).toBeTruthy();
    // Factual bookmarks still take the established Graph selection path.
    fireEvent.click(screen.getByRole('button', { name: /Public transaction/ }));
    expect(data().view.selectionId).toBe(`tx:${TX_FUNDING}`);
    expect(data().view.workbench).toBe('graph');
    expect(data().view.graphNodeIds).toContain(`tx:${TX_FUNDING}`);
  },
);
