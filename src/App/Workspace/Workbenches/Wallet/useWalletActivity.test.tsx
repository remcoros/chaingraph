// @vitest-environment jsdom
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWalletActivity } from './useWalletActivity';
import { useWorkspaceOperation } from '../../useWorkspaceOperation';
import type { WorkspaceCore } from '../../workspaceCore';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import { WorkspaceStore } from '../../../../Core/Workspace/Session/WorkspaceStore';
import { createChainDataAcquisition } from '../../../../Core/Workspace/Session/chainDataAcquisition';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';
import { WalletReviewPanel } from './Review/WalletReviewPanel';
import type { AnalysisScan } from '../../../../Core/Workspace/Analysis/analysisScan';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('clears a retried refresh notice without reviving a same-name manual analysis failure', async () => {
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
  // Hold automatic work so the test drives the actual foreground Retry path.
  const view = fixture({ ready: true, busy: true, walletId: firstId });
  await act(async () =>
    view.store.getUnlocked(view.workspace.id)!.edit((current) => ({
      ...current,
      wallets: {
        ...current.wallets,
        definitions: current.wallets.definitions.map((wallet) => ({
          ...wallet,
          name: 'Public shared name',
        })),
      },
    })),
  );
  const manual: AnalysisScan = {
    scope: {
      kind: 'wallet',
      label: 'Wallet Public shared name',
      explanation: 'Public fixture',
      txids: [],
    },
    options: {},
    reports: [{ toolId: 'fee-rate', status: 'error', message: 'Retained manual scan failure' }],
    findings: [],
    runAt: '2026-10-01T10:00:00.000Z',
  };
  const current = () => view.store.getUnlocked(view.workspace.id)!.data;
  const panel = (walletId: string) => {
    const workspace = current();
    const wallet = workspace.wallets.definitions.find((wallet) => wallet.id === walletId)!;
    return (
      <WalletReviewPanel
        workspace={workspace}
        wallet={wallet}
        active
        busy={view.result.current.refresh.loading}
        canLoadChainData
        refresh={view.result.current.refresh}
        sessionAnalysis={manual}
        walletUtxos={{ loading: false, error: '', check: vi.fn() }}
        onChange={(update) => view.store.getUnlocked(workspace.id)!.edit(update)}
        updateEvidence={(_id, update) => view.store.getUnlocked(workspace.id)!.edit(update, false)}
        onSelectWallet={vi.fn()}
        onAddWallet={vi.fn()}
        onRefresh={() => void view.result.current.run(wallet)}
        onShowInGraph={vi.fn()}
        onIsolateInGraph={vi.fn()}
        onShowSelection={vi.fn()}
        onInspect={vi.fn()}
      />
    );
  };
  const failure = 'Synthetic wallet refresh failure';
  view.refresh.mockRejectedValueOnce(new Error(failure));
  await act(async () => view.result.current.run(current().wallets.definitions[0]));
  const consumer = render(panel(firstId));
  const header = () =>
    screen.getByRole('combobox', { name: /selected wallet/i }).closest('header')!;
  expect(within(header()).getByText(failure)).toBeDefined();
  consumer.rerender(panel(secondId));
  expect(within(header()).queryByRole('status')).toBeNull();
  consumer.rerender(panel(firstId));
  fireEvent.click(within(header()).getByRole('button', { name: /retry/i }));
  await waitFor(() => expect(view.result.current.refresh.error).toBe(''));
  expect(view.refresh).toHaveBeenCalledTimes(2);
  expect(view.refresh.mock.calls[1][0].id).toBe(firstId);
  consumer.rerender(panel(firstId));
  expect(within(header()).queryByRole('status')).toBeNull();
  expect(manual.reports[0].status).toBe('error');
});
const firstId = '30000000-0000-4000-8000-000000000001';
const secondId = '30000000-0000-4000-8000-000000000002';
const importedId = '30000000-0000-4000-8000-000000000003';

function fixture(initial = { ready: true, busy: false, walletId: firstId }) {
  const workspace = createWorkspace('Public activity fixture', 'mainnet');
  workspace.wallets.definitions = [firstId, secondId].map((id) => ({
    id,
    name: id,
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: [],
    scannedAt: '2026-09-01T10:00:00.000Z',
    scanComplete: true,
  }));
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
  store.open(workspace, 'public fixture password');
  const acquisition = createChainDataAcquisition({
    activeWorkspace: workspace,
    getUnlocked: store.getUnlocked,
    fetchScope: store.getUnlocked(workspace.id)!.fetchScope,
  });
  const refresh = vi
    .spyOn(acquisition.observe, 'walletRefresh')
    .mockImplementation(async (wallet) => ({
      wallet,
      transactions: [],
      truncated: false,
      snapshot: store.getUnlocked(workspace.id)!.data,
      coins: {
        walletId: wallet.id,
        network: 'mainnet',
        records: [],
        observations: {},
        checkedAt: '2026-10-01T10:00:00.000Z',
        totalAddresses: 0,
        checkedAddresses: 0,
        successfulAddresses: 0,
        errors: [],
      },
    }));
  const setNotice = vi.fn();
  const setError = vi.fn();
  const view = renderHook(
    ({ ready, busy, walletId }) => {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
      const current = state.unlocked.find((entry) => entry.data.id === state.activeId)?.data;
      const currentRef = useRef(current);
      useLayoutEffect(() => {
        currentRef.current = current;
      });
      const [status, setOperation] = useState('');
      const core = {
        activeWorkspace: current,
        activeWorkspaceRef: currentRef,
        workspaceId: current?.id,
        workspaces: { getUnlocked: store.getUnlocked },
        edit: store.getUnlocked(workspace.id)?.edit ?? (() => {}),
        setNotice,
        setError,
        setOperation,
      } as unknown as WorkspaceCore;
      const operation = useWorkspaceOperation(core);
      return useWalletActivity({
        core,
        transactions: acquisition,
        operation,
        canLoadChainData: ready,
        fitAll: vi.fn(),
        automatic: { ready, busy: busy || !!status, walletId },
      });
    },
    { initialProps: initial },
  );
  return { ...view, store, workspace, acquisition, refresh };
}

describe('automatic wallet refresh', () => {
  it('refreshes every wallet sequentially with the selected wallet first, and does not repeat on presentation edits', async () => {
    const view = fixture({ ready: true, busy: false, walletId: secondId });
    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(2));
    expect(view.refresh.mock.calls.map(([wallet]) => wallet.id)).toEqual([secondId, firstId]);
    await act(async () =>
      view.store
        .getUnlocked(view.workspace.id)!
        .edit((current) => ({ ...current, name: 'Renamed workspace' }), false),
    );
    view.rerender({ ready: true, busy: false, walletId: firstId });
    expect(view.refresh).toHaveBeenCalledTimes(2);
  });
  it('waits for readiness and foreground work, without consuming attempts', async () => {
    const view = fixture({ ready: false, busy: true, walletId: secondId });
    expect(view.refresh).not.toHaveBeenCalled();
    view.rerender({ ready: true, busy: true, walletId: secondId });
    expect(view.refresh).not.toHaveBeenCalled();
    view.rerender({ ready: true, busy: false, walletId: secondId });
    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(2));
  });
  it('respects the encrypted toggle and refreshes newly imported wallets even when periodic work is disabled', async () => {
    const view = fixture({ ready: true, busy: true, walletId: firstId });
    await act(async () => view.result.current.setMonitorActivity(false));
    expect(view.store.getUnlocked(view.workspace.id)!.data.view.automaticWalletRefresh).toBe(false);
    view.rerender({ ready: true, busy: false, walletId: firstId });
    expect(view.refresh).not.toHaveBeenCalled();
    await act(async () =>
      view.store.getUnlocked(view.workspace.id)!.edit((current) => ({
        ...current,
        wallets: {
          ...current.wallets,
          definitions: [
            ...current.wallets.definitions,
            { ...current.wallets.definitions[0], id: importedId, scannedAt: undefined },
          ],
        },
      })),
    );
    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(1));
    expect(view.refresh.mock.calls[0][0].id).toBe(importedId);
  });
  it('pauses hidden tabs and resumes when visible without overlapping runs', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const view = fixture();
    expect(view.refresh).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(2));
    visibility.mockRestore();
  });
  it('drops prior summaries at lock and refreshes on a fresh unlocked session', async () => {
    const view = fixture();
    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(2));
    view.rerender({ ready: false, busy: false, walletId: firstId });
    const previous = view.store.getUnlocked(view.workspace.id)!.fetchScope;
    await act(async () => {
      await view.store.getUnlocked(view.workspace.id)!.lock();
      view.store.open(view.workspace, 'public fixture password');
    });
    expect(previous.closed).toBe(true);
    expect(view.result.current.coinChecks).toEqual({});
    view.rerender({ ready: true, busy: false, walletId: firstId });
    await waitFor(() => expect(view.refresh).toHaveBeenCalledTimes(4));
  });
});

it('uses a 60-second cadence and applies a saved interval without overlapping or restarting completed work', async () => {
  vi.useFakeTimers();
  const view = fixture();
  await act(async () => {});
  expect(view.refresh).toHaveBeenCalledTimes(2);
  expect(view.result.current.refreshIntervalSeconds).toBe(60);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_999);
  });
  expect(view.refresh).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.refresh).toHaveBeenCalledTimes(4);
  await act(async () => view.result.current.setRefreshIntervalSeconds(120));
  expect(view.store.getUnlocked(view.workspace.id)!.data.view.walletRefreshIntervalSeconds).toBe(
    120,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(119_999);
  });
  expect(view.refresh).toHaveBeenCalledTimes(4);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.refresh).toHaveBeenCalledTimes(6);
});
