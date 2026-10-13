// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGraphLookup } from './useGraphLookup';
import { useGraphLookupState } from './useGraphLookupState';
import { useWorkspaceOperation } from '../../../useWorkspaceOperation';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import type { WorkspaceCore } from '../../../workspaceCore';
import type { WorkspaceSelection } from '../../../Selection/useWorkspaceSelection';
import type { ChainDataAcquisition } from '../../../../../Core/Workspace/Session/chainDataAcquisition';
import type { useAddressEvidence } from '../Address/useAddressEvidence';
import { PUBLIC_ZPUB, TX_FUNDING, transactions } from '../../../../../../tests/fixtures/bitcoin';
import { deriveAddresses } from '../../../../../Core/Workspace/Wallets/walletDerivation';

afterEach(cleanup);

function fixture(cached = false, canLoadChainData = true) {
  const workspace = createWorkspace('Foreground lookup', 'mainnet');
  if (cached) workspace.chainData.transactions = structuredClone(transactions);
  const core = {
    activeWorkspace: workspace,
    activeWorkspaceRef: { current: workspace },
    setOperation: vi.fn(),
    setError: vi.fn(),
    setNotice: vi.fn(),
    workspaces: { getUnlocked: () => ({ data: workspace }) },
  } as unknown as WorkspaceCore;
  const read = vi.fn(async () => transactions[TX_FUNDING]);
  const observe = vi.fn();
  const reveal = vi.fn();
  const addressHistory = vi.fn();
  const selection = { generation: { current: 0 } } as unknown as WorkspaceSelection;
  const view = renderHook(() => {
    const operation = useWorkspaceOperation(core);
    const state = useGraphLookupState(workspace);
    const lookup = useGraphLookup({
      core,
      selection,
      state,
      operation,
      transactions: {
        read: { transaction: read },
        observe: { transactions: observe },
      } as unknown as ChainDataAcquisition,
      addressEvidence: {
        startAddressHistoryLoad: addressHistory,
      } as unknown as ReturnType<typeof useAddressEvidence>,
      canLoadChainData,
      prefetchDepth: 0,
      reveal,
    });
    return { operation, lookup, state };
  });
  return { ...view, read, observe, reveal, addressHistory, core, selection };
}

it.each([
  { kind: 'transaction', text: TX_FUNDING, expected: `tx:${TX_FUNDING}`, cached: false },
  { kind: 'output', text: `${TX_FUNDING}:0`, expected: `out:${TX_FUNDING}:0`, cached: false },
  { kind: 'loaded transaction', text: TX_FUNDING, expected: `tx:${TX_FUNDING}`, cached: true },
  { kind: 'loaded output', text: `${TX_FUNDING}:0`, expected: `out:${TX_FUNDING}:0`, cached: true },
  {
    kind: 'address',
    text: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address.toUpperCase(),
    expected: `addr:${deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address}`,
    cached: false,
  },
])('preempts automatic refresh for a $kind lookup', async ({ text, expected, cached }) => {
  const f = fixture(cached);
  let background!: Promise<void>;
  let backgroundSignal!: AbortSignal;
  await act(async () => {
    background = f.result.current.operation.run(
      async (signal) => {
        backgroundSignal = signal;
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
      { background: true },
    );
  });
  expect(f.core.setOperation).not.toHaveBeenCalled();
  await act(async () => {
    await f.result.current.lookup.submit(text);
    await background;
  });
  expect(backgroundSignal.aborted).toBe(true);
  expect(f.reveal).toHaveBeenCalledWith(expected);
  expect(f.result.current.state.resetToken).toBe(1);
  if (expected.startsWith('addr:'))
    expect(f.addressHistory).toHaveBeenCalledWith(text.toLowerCase());
  else {
    expect(f.read).toHaveBeenCalledTimes(cached ? 0 : 1);
    expect(f.observe).toHaveBeenCalledWith(
      expect.any(String),
      cached ? [] : [transactions[TX_FUNDING]],
      { promotionIds: [TX_FUNDING] },
    );
  }
});

it('keeps a cached lookup from changing selection during another foreground operation', async () => {
  const f = fixture(true);
  let release!: () => void;
  let foreground!: Promise<void>;
  await act(async () => {
    foreground = f.result.current.operation.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
  });
  await act(() => f.result.current.lookup.submit(TX_FUNDING));
  expect(f.reveal).not.toHaveBeenCalled();
  expect(f.observe).not.toHaveBeenCalled();
  expect(f.result.current.state.resetToken).toBe(0);
  release();
  await act(() => foreground);
});

it('still opens loaded evidence while live lookups are unavailable', async () => {
  const f = fixture(true, false);
  await act(() => f.result.current.lookup.submit(TX_FUNDING));
  expect(f.reveal).toHaveBeenCalledWith(`tx:${TX_FUNDING}`);
  expect(f.read).not.toHaveBeenCalled();
});

it('drops a lookup if selection changes while automatic work is yielding', async () => {
  const f = fixture(true);
  let release!: () => void;
  let background!: Promise<void>;
  await act(async () => {
    background = f.result.current.operation.run(
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      { background: true },
    );
  });
  let lookup!: Promise<void>;
  await act(async () => {
    lookup = f.result.current.lookup.submit(TX_FUNDING);
    f.selection.generation.current++;
    release();
    await background;
    await lookup;
  });
  expect(f.reveal).not.toHaveBeenCalled();
  expect(f.observe).not.toHaveBeenCalled();
});
