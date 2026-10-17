// @vitest-environment jsdom
import { useLayoutEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DeepLinkBanner } from '../../../src/App/DeepLinkBanner';
import { ToastNotification } from '../../../src/App/Controls/ToastNotification';
import { useAppState } from '../../../src/App/useAppState';
import { useWorkspace } from '../../../src/App/Workspace/useWorkspace';
import { appServices } from '../../../src/App/appServices';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseVerboseTransaction } from '../../../src/Core/ChainData/verboseTransaction';
import {
  addressReference,
  outpointReference,
  transactionReference,
} from '../../../src/Core/Workspace/entityReferences';
import type { WorkbenchMode } from '../../../src/App/Workspace/workbenchTypes';
import {
  PUBLIC_ZPUB,
  RECEIVE_ADDRESS,
  TX_FUNDING,
  TX_SPENDING,
  transactions,
} from '../../fixtures/bitcoin';
import { installDomStubs } from '../../domStubs';

installDomStubs();
const policy = vi.hoisted(() => ({ connected: true, demo: false }));
vi.mock('../../../src/buildMode', () => ({
  get DEMO_MODE() {
    return policy.demo;
  },
}));
vi.mock('../../../src/App/useBackendNetworks', () => ({
  useBackendNetworks: () => ({
    networks: ['mainnet', 'testnet4'],
    statuses: {
      mainnet: { network: 'mainnet', connected: policy.connected },
      testnet4: { network: 'testnet4', connected: policy.connected },
    },
    discoveryError: '',
  }),
}));
vi.mock('../../../src/App/appServices', async () => {
  const { WorkspaceStore } = await import('../../../src/Core/Workspace/Session/WorkspaceStore');
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
  return { appServices: { persistence, workspaceStore: new WorkspaceStore(persistence) } };
});

let current: { app: ReturnType<typeof useAppState>; workspace: ReturnType<typeof useWorkspace> };
function Harness() {
  const app = useAppState();
  const workspace = useWorkspace(app);
  useLayoutEffect(() => {
    current = { app, workspace };
  });
  return (
    <>
      <DeepLinkBanner app={app} workspace={workspace} />
      <ToastNotification app={app} workspace={workspace} />
    </>
  );
}

function response(result: unknown) {
  return new Response(JSON.stringify({ result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
function rpcCall(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
}

beforeEach(() => {
  policy.connected = true;
  policy.demo = false;
  vi.stubEnv('SSR', true);
  window.history.replaceState(null, '', '/');
  localStorage.setItem('chaingraph.tour.seen', '1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const call = rpcCall(init);
      if (call.method === 'getrawtransaction')
        return response(transactions[call.params[0] as keyof typeof transactions]);
      if (
        call.method === 'blockchain.scripthash.get_history' ||
        call.method === 'blockchain.scripthash.listunspent'
      )
        return response([]);
      if (call.method === 'blockchain.scripthash.get_balance')
        return response({ confirmed: 0, unconfirmed: 0 });
      throw new Error('Unexpected synthetic RPC request');
    }),
  );
});
afterEach(async () => {
  cleanup();
  for (const session of appServices.workspaceStore.getSnapshot().unlocked) await session.lock();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

function setup({
  cached = false,
  workbench = 'graph',
  wallet = false,
}: {
  cached?: boolean;
  workbench?: WorkbenchMode;
  wallet?: boolean;
} = {}) {
  const data = createWorkspace('Linked lookup fixture', 'mainnet');
  data.view.workbench = workbench;
  if (cached)
    data.chainData.transactions[TX_FUNDING] = parseVerboseTransaction(transactions[TX_FUNDING]);
  if (wallet || workbench === 'wallet')
    data.wallets.definitions = [
      {
        id: '30000000-0000-4000-8000-000000000001',
        name: 'Public vector wallet',
        key: PUBLIC_ZPUB,
        scriptType: 'p2wpkh',
        color: '#27c4a7',
        addresses: [],
        scannedAt: '2026-10-01T10:00:00.000Z',
        scanComplete: true,
      },
    ];
  appServices.workspaceStore.open(data, 'public test password');
  const view = render(<Harness />);
  return { ...view, id: data.id };
}
function receive(ref: string) {
  act(() => {
    window.history.pushState(null, '', `/#?s=${ref}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('');
}
async function clickReference() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('deep-link-banner-ref'));
  });
}
function expectSelection(id: string, selected: string) {
  expect(current.workspace.selection.selectedId).toBe(selected);
  expect(appServices.workspaceStore.getUnlocked(id)!.data.view.graphNodeIds).toContain(selected);
}
function delayTransaction() {
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((input, init) =>
    rpcCall(init).method === 'getrawtransaction' ? pending : normalFetch(input, init),
  );
  return () => release(response(transactions[TX_FUNDING]));
}

const references = [
  { kind: 'transaction', ref: TX_FUNDING, selected: transactionReference(TX_FUNDING) },
  { kind: 'output', ref: `${TX_FUNDING}:0`, selected: outpointReference(TX_FUNDING, 0) },
  {
    kind: 'address',
    ref: RECEIVE_ADDRESS.toUpperCase(),
    selected: addressReference(RECEIVE_ADDRESS),
  },
];

it.each(references)(
  'dismisses after adding a new $kind through the lookup owner',
  async ({ ref, selected }) => {
    const view = setup();
    receive(ref);
    await clickReference();
    expectSelection(view.id, selected);
    expect(screen.queryByTestId('deep-link-banner')).toBeNull();
    if (!selected.startsWith('addr:'))
      expect(
        appServices.workspaceStore.getUnlocked(view.id)!.data.chainData.transactions[TX_FUNDING],
      ).toBeDefined();
  },
);

it.each([false, true])('opens loaded references without live lookup (demo=%s)', async (demo) => {
  policy.demo = demo;
  policy.connected = false;
  const view = setup({ cached: true });
  for (const { ref, selected } of references) {
    receive(ref);
    await clickReference();
    expectSelection(view.id, selected);
    expect(screen.queryByTestId('deep-link-banner')).toBeNull();
  }
  expect(fetch).not.toHaveBeenCalled();
});

it.each(references)(
  'reports an unavailable $kind and allows retry after reconnection',
  async ({ ref, selected }) => {
    policy.connected = false;
    const view = setup();
    receive(ref);
    await clickReference();
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
    expect(current.workspace.selection.selectedId).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    policy.connected = true;
    view.rerender(<Harness />);
    await clickReference();
    expectSelection(view.id, selected);
    expect(screen.queryByTestId('deep-link-banner')).toBeNull();
  },
);

it('keeps a cached reference when foreground work declines the lookup, then retries', async () => {
  const view = setup({ cached: true });
  receive(TX_FUNDING);
  let release!: () => void;
  let foreground!: Promise<void>;
  await act(async () => {
    foreground = current.workspace.operation.run(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
  });
  try {
    await clickReference();
    expect(current.workspace.selection.selectedId).toBeUndefined();
    expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
  } finally {
    release();
    await act(() => foreground);
  }
  await clickReference();
  expectSelection(view.id, transactionReference(TX_FUNDING));
  expect(screen.queryByTestId('deep-link-banner')).toBeNull();
});

it('preempts the default automatic wallet refresh and completes the linked lookup', async () => {
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  let aborted = 0;
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (rpcCall(init).method !== 'blockchain.scripthash.get_history')
      return normalFetch(input, init);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener(
        'abort',
        () => {
          aborted++;
          reject(new DOMException('Synthetic refresh aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  });
  const view = setup({ wallet: true });
  await waitFor(() => expect(current.workspace.wallet.discovery.refresh.loading).toBe(true));
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([, init]) => rpcCall(init).method === 'blockchain.scripthash.get_history',
        ),
    ).toBe(true),
  );
  expect(current.workspace.wallet.discovery.monitorActivity).toBe(true);
  receive(TX_FUNDING);
  await clickReference();
  expect(aborted).toBeGreaterThan(0);
  expectSelection(view.id, transactionReference(TX_FUNDING));
  expect(screen.queryByTestId('deep-link-banner')).toBeNull();
});

it('retains a newer fragment after an earlier network lookup completes', async () => {
  const release = delayTransaction();
  const view = setup();
  receive(TX_FUNDING);
  await clickReference();
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  receive(TX_SPENDING);
  await act(async () => {
    release();
  });
  await waitFor(() => expectSelection(view.id, transactionReference(TX_FUNDING)));
  expect(current.app.deepLinkRef).toBe(TX_SPENDING);
  expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
});

it.each(['cancel', 'switch workspace'] as const)(
  'retains the reference after a pending lookup is interrupted: %s',
  async (action) => {
    const release = delayTransaction();
    const view = setup();
    receive(TX_FUNDING);
    await clickReference();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    act(() => {
      if (action === 'cancel') current.workspace.operation.cancel();
      else
        appServices.workspaceStore.open(
          createWorkspace('Other workspace', 'testnet4'),
          'public test password',
        );
    });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(current.workspace.operation.isActive()).toBe(false));
    expect(
      appServices.workspaceStore.getUnlocked(view.id)!.data.chainData.transactions[TX_FUNDING],
    ).toBeUndefined();
    expect(current.app.deepLinkRef).toBe(TX_FUNDING);
    expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
  },
);

it('retains a failed lookup and completes a subsequent retry', async () => {
  const view = setup();
  receive(TX_FUNDING);
  const normalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockRejectedValue(new Error('Synthetic unavailable backend'));
  await clickReference();
  expect(screen.getByRole('alert').textContent).toBeTruthy();
  expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
  expect(current.workspace.selection.selectedId).toBeUndefined();
  vi.mocked(fetch).mockImplementation(normalFetch);
  await clickReference();
  expectSelection(view.id, transactionReference(TX_FUNDING));
  expect(screen.queryByTestId('deep-link-banner')).toBeNull();
});

it.each(
  (['wallet', 'analysis'] as const).flatMap((workbench) =>
    [false, true].map((cached) => ({ workbench, cached })),
  ),
)(
  'opens Graph after a successful lookup from $workbench (cached=$cached) and retains the return route',
  async ({ workbench, cached }) => {
    policy.connected = !cached;
    const view = setup({ cached, workbench });
    expect(current.workspace.workbench).toBe(workbench);
    receive(TX_FUNDING);
    await clickReference();
    expectSelection(view.id, transactionReference(TX_FUNDING));
    expect(current.workspace.workbench).toBe('graph');
    expect(current.workspace.returnWorkbench).toBe(workbench);
    expect(current.workspace.workbenchEntry?.target).toBe('stage');
    expect(appServices.workspaceStore.getUnlocked(view.id)!.data.view.workbench).toBe('graph');
    expect(screen.queryByTestId('deep-link-banner')).toBeNull();
  },
);

it('completes ancestor loading before opening Graph from Analysis', async () => {
  const view = setup({ workbench: 'analysis' });
  act(() => current.workspace.setPrefetchDepth(1));
  receive(TX_SPENDING);
  await clickReference();
  expectSelection(view.id, transactionReference(TX_SPENDING));
  expect(
    appServices.workspaceStore.getUnlocked(view.id)!.data.chainData.transactions[TX_FUNDING],
  ).toBeDefined();
  expect(current.workspace.workbench).toBe('graph');
  expect(current.workspace.returnWorkbench).toBe('analysis');
  expect(screen.queryByTestId('deep-link-banner')).toBeNull();
});

it('stays in Analysis when the linked lookup cannot complete', async () => {
  policy.connected = false;
  setup({ workbench: 'analysis' });
  receive(TX_FUNDING);
  await clickReference();
  expect(current.workspace.workbench).toBe('analysis');
  expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toBeTruthy();
});

it('consumes the startup fragment, preserves anchors and can dismiss without an unlocked workspace', async () => {
  window.history.replaceState(null, '', `/?keep=1#?s=${TX_FUNDING}`);
  render(<Harness />);
  expect(window.location.hash).toBe('');
  expect(window.location.search).toBe('?keep=1');
  expect(current.app.deepLinkRef).toBe(TX_FUNDING);
  await clickReference();
  expect(current.app.notice).toBeDefined();
  expect(screen.queryByTestId('deep-link-banner')).not.toBeNull();
  act(() => {
    window.history.pushState(null, '', '/#main-workspace');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  expect(window.location.hash).toBe('#main-workspace');
  expect(current.app.deepLinkRef).toBe(TX_FUNDING);
  fireEvent.click(screen.getByRole('button', { name: /dismiss linked lookup/i }));
  expect(screen.queryByTestId('deep-link-banner')).toBeNull();
});
