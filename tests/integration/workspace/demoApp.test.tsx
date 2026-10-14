// @vitest-environment jsdom
import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../../src/App/App';
import { appServices } from '../../../src/App/appServices';
import { useAppState } from '../../../src/App/useAppState';
import { useWorkspace } from '../../../src/App/Workspace/useWorkspace';
import { createTemplateWorkspace } from '../../../src/App/Examples/workspaceTemplates';
import { listWalletTransactions } from '../../../src/Core/Workspace/Wallets/walletRecords';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import {
  outpointReference,
  transactionReference,
} from '../../../src/Core/Workspace/entityReferences';
import { transactionNodeIds } from '../../../src/App/Workspace/GraphState/visibility';
import { installDomStubs } from '../../domStubs';

installDomStubs();

const buildPolicy = vi.hoisted(() => ({ demo: true }));
vi.mock('../../../src/buildMode', () => ({
  get DEMO_MODE() {
    return buildPolicy.demo;
  },
}));
vi.mock('../../../src/App/Workspace/Workbenches/Graph/GraphView', () => ({ default: () => null }));
vi.mock('../../../src/App/Examples/templateWorkspace', () => ({
  loadTemplateWorkspace: (id: string, name: string, description: string) =>
    createTemplateWorkspace(id, name, description),
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
beforeEach(() => {
  buildPolicy.demo = true;
  vi.stubEnv('SSR', true);
  localStorage.setItem('chaingraph.tour.seen', '1');
  vi.stubGlobal('__APP_VERSION__', 'test');
  vi.stubGlobal('__SOURCE_URL__', '');
  vi.stubGlobal('__DEMO_MODE__', true);
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
afterEach(async () => {
  cleanup();
  for (const session of appServices.workspaceStore.getSnapshot().unlocked) await session.lock();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('routes New workspace through the explanation and example picker to password creation', async () => {
  localStorage.removeItem('chaingraph.tour.seen');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  fireEvent.click(screen.getAllByRole('button', { name: /new workspace/i })[0]);
  const explanation = screen.getByRole('dialog');
  fireEvent.click(within(explanation).getByRole('button', { name: /choose an example/i }));
  const picker = screen.getByRole('dialog');
  expect(within(picker).getAllByRole('button', { name: /^create .* workspace$/i })).toHaveLength(3);
  fireEvent.click(
    within(picker).getByRole('button', { name: /create five equal outputs workspace/i }),
  );
  const creation = screen.getByRole('dialog');
  fireEvent.change(within(creation).getByRole('textbox', { name: /^name/i }), {
    target: { value: 'My saved example' },
  });
  fireEvent.change(within(creation).getByLabelText(/^password$/i), {
    target: { value: 'public test password' },
  });
  fireEvent.change(within(creation).getByLabelText(/^confirm password$/i), {
    target: { value: 'public test password' },
  });
  await act(async () => {
    fireEvent.click(within(creation).getByRole('button', { name: /^create workspace$/i }));
  });
  await waitFor(() => expect(appServices.workspaceStore.getSnapshot().unlocked).toHaveLength(1));
  const opened = appServices.workspaceStore.getSnapshot().unlocked[0];
  expect(opened.data.name).toBe('My saved example');
  expect(opened.password).toBe('public test password');
  expect(opened.data.demo).toBe(false);
  expect(Object.keys(opened.data.chainData.transactions)).toHaveLength(2);
  expect(screen.getByRole('dialog', { name: /guided tour/i })).toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([true, false])(
  'offers the first-use tour, dismisses it on workspace changes and permits manual restart (demo=%s)',
  async (demo) => {
    buildPolicy.demo = demo;
    localStorage.removeItem('chaingraph.tour.seen');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    const store = appServices.workspaceStore;
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();
    expect(localStorage.getItem('chaingraph.tour.seen')).toBeNull();

    const first = createWorkspace('First tour workspace', 'mainnet');
    await act(() => store.open(first, 'public test password'));
    expect(screen.getByRole('dialog', { name: /guided tour/i })).toBeDefined();
    expect(localStorage.getItem('chaingraph.tour.seen')).toBe('1');

    const second = createWorkspace('Second tour workspace', 'mainnet');
    await act(() => store.open(second, 'public test password'));
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /First tour workspace/i }));
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /help and samples/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /show guided tour/i }));
    expect(screen.getByRole('dialog', { name: /guided tour/i })).toBeDefined();
    await act(() => store.setActiveId(undefined));
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /First tour workspace/i }));
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();

    cleanup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.queryByRole('dialog', { name: /guided tour/i })).toBeNull();
  },
);

it.each([true, false])(
  'keeps the first-use tour open with an already active workspace under StrictMode (demo=%s)',
  (demo) => {
    buildPolicy.demo = demo;
    localStorage.removeItem('chaingraph.tour.seen');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    appServices.workspaceStore.open(
      createWorkspace('Initially active workspace', 'mainnet'),
      'public test password',
    );
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole('dialog', { name: /guided tour/i })).toBeDefined();
  },
);

it.each(['getItem', 'setItem'] as const)(
  'still offers the first-use tour when localStorage.%s fails',
  (method) => {
    localStorage.removeItem('chaingraph.tour.seen');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, method).mockImplementation(function (
      this: Storage,
      key: string,
      value = '',
    ) {
      if (key === 'chaingraph.tour.seen') throw new DOMException('Storage denied', 'SecurityError');
      return method === 'getItem'
        ? originalGet.call(this, key)
        : originalSet.call(this, key, value);
    });
    appServices.workspaceStore.open(
      createWorkspace('Storage restricted workspace', 'mainnet'),
      'public test password',
    );
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    expect(screen.getByRole('dialog', { name: /guided tour/i })).toBeDefined();
  },
);

it.each([true, false])(
  'keeps default Wallet background work silent and follows saved funding and spending outside the canvas (demo=%s)',
  async (demo) => {
    buildPolicy.demo = demo;
    vi.stubGlobal('__DEMO_MODE__', demo);
    const data = await createTemplateWorkspace('demo-public-wallet');
    const store = appServices.workspaceStore;
    store.open(data, 'public test password');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    vi.useFakeTimers();
    const view = renderHook(() => {
      const app = useAppState();
      return { app, workspace: useWorkspace(app) };
    });
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(view.result.current.workspace.canLoadChainData).toBe(false);
    expect(view.result.current.workspace.wallet.utxos.utxos?.checkedAddresses).toBe(20);
    expect(fetch.mock.calls.every(([url]) => !demo && url === '/api/networks')).toBe(true);
    const path = await createTemplateWorkspace('demo-branching-path');
    await act(async () => {
      store.open(path, 'public test password');
    });
    const start = path.view.selectionId!;
    const startTx = path.chainData.transactions[start.slice(3)];
    const child = Object.values(path.chainData.transactions).find((tx) =>
      tx.vin.some((input) => input.txid === startTx.txid),
    )!;
    expect(path.view.graphNodeIds).not.toContain(`tx:${child.txid}`);
    await act(() => view.result.current.workspace.graph.navigation.expand('spending', start));
    expect(store.getUnlocked(path.id)!.data.view.graphNodeIds).toContain(`tx:${child.txid}`);
    await act(() =>
      view.result.current.workspace.graph.navigation.expand('funding', `tx:${child.txid}`),
    );
    expect(store.getUnlocked(path.id)!.data.view.graphNodeIds).toContain(start);
    expect(fetch.mock.calls.every(([url]) => !demo && url === '/api/networks')).toBe(true);
    view.unmount();
  },
);

it('opens the captured Wallet default records and their flows without fetching missing details', async () => {
  const data = await createTemplateWorkspace('demo-public-wallet');
  appServices.workspaceStore.open(data, 'public test password');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
  render(<App />);
  const records = await screen.findByRole(
    'list',
    { name: /transactions records/i },
    { timeout: 10_000 },
  );
  const latest = listWalletTransactions(data, data.wallets.definitions[0])[0];
  fireEvent.click(within(records).getByRole('link', { name: new RegExp(latest.txid.slice(0, 8)) }));
  const inspector = screen.getByRole('article', { name: /selected wallet item/i });
  expect(within(inspector).getByRole('figure', { name: /wallet transaction flow/i })).toBeDefined();
  expect(
    within(inspector).getByLabelText(
      `${latest.transaction!.vin.length} inputs, ${latest.transaction!.vout.length} outputs`,
    ),
  ).toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(
  [true, false].flatMap((demo) =>
    (['transaction', 'output'] as const).map((kind) => ({ demo, kind })),
  ),
)(
  'reveals an off-canvas saved spender through the $kind Inspector action (demo=$demo)',
  async ({ demo, kind }) => {
    buildPolicy.demo = demo;
    const data = await createTemplateWorkspace('demo-branching-path');
    const start = data.chainData.transactions[data.view.selectionId!.slice(3)];
    const child = Object.values(data.chainData.transactions).find((tx) =>
      tx.vin.some((input) => input.txid === start.txid),
    )!;
    const input = child.vin.find((input) => input.txid === start.txid)!;
    const connector = outpointReference(start.txid, input.vout!);
    const childId = transactionReference(child.txid);
    data.view.selectionId = kind === 'output' ? connector : transactionReference(start.txid);
    expect(data.view.graphNodeIds).not.toContain(childId);
    const store = appServices.workspaceStore;
    store.open(data, 'public test password');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    render(<App />);

    const spending = screen.getByRole('button', { name: /find spending txs/i });
    expect((spending as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(spending);
    await waitFor(() =>
      expect(store.getUnlocked(data.id)!.data.view.graphNodeIds).toContain(childId),
    );
    expect(store.getUnlocked(data.id)!.data.view.graphNodeIds).toContain(connector);
    if (kind === 'output')
      await waitFor(() => expect(store.getUnlocked(data.id)!.data.view.selectionId).toBe(childId));
    expect(fetch.mock.calls.every(([url]) => !demo && url === '/api/networks')).toBe(true);
  },
);

it.each([true, false])(
  'reveals saved funding through the transaction Inspector despite uncaptured sibling inputs (demo=%s)',
  async (demo) => {
    buildPolicy.demo = demo;
    const data = await createTemplateWorkspace('demo-branching-path');
    const parentId = data.view.selectionId!;
    const parent = data.chainData.transactions[parentId.slice(3)];
    const child = Object.values(data.chainData.transactions).find((tx) =>
      tx.vin.some((input) => input.txid === parent.txid),
    )!;
    data.view.selectionId = transactionReference(child.txid);
    data.view.graphNodeIds = [
      data.view.selectionId,
      ...transactionNodeIds(child, 'inputs'),
      ...transactionNodeIds(child, 'outputs'),
    ];
    expect(data.view.graphNodeIds).not.toContain(parentId);
    expect(child.vin.some((input) => input.txid && !data.chainData.transactions[input.txid])).toBe(
      true,
    );
    const store = appServices.workspaceStore;
    store.open(data, 'public test password');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    render(<App />);

    const funding = screen.getByRole('button', { name: /load previous txs/i });
    expect((funding as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(funding);
    await waitFor(() =>
      expect(store.getUnlocked(data.id)!.data.view.graphNodeIds).toContain(parentId),
    );
    const input = child.vin.find((input) => input.txid === parent.txid)!;
    expect(store.getUnlocked(data.id)!.data.view.graphNodeIds).toContain(
      outpointReference(parent.txid, input.vout!),
    );
    expect(Object.keys(store.getUnlocked(data.id)!.data.chainData.transactions).sort()).toEqual(
      Object.keys(data.chainData.transactions).sort(),
    );
    expect(fetch.mock.calls.every(([url]) => !demo && url === '/api/networks')).toBe(true);
  },
);

it.each([true, false])(
  'keeps unsaved directions unavailable and opens the saved creator of a different output (demo=%s)',
  async (demo) => {
    buildPolicy.demo = demo;
    const data = await createTemplateWorkspace('demo-branching-path');
    const startId = data.view.selectionId!;
    const start = data.chainData.transactions[startId.slice(3)];
    const other = start.vout.find(
      (output) =>
        !Object.values(data.chainData.transactions).some((tx) =>
          tx.vin.some((input) => input.txid === start.txid && input.vout === output.n),
        ),
    )!;
    data.view.selectionId = outpointReference(start.txid, other.n);
    const store = appServices.workspaceStore;
    store.open(data, 'public test password');
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    render(<App />);
    const spending = screen.getByRole('button', { name: /find spending txs/i });
    expect((spending as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('button', { name: /check current utxo status/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const creating = screen.getByRole('button', { name: /open creating tx$/i });
    expect((creating as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(creating);
    await waitFor(() => expect(store.getUnlocked(data.id)!.data.view.selectionId).toBe(startId));
    expect(
      (screen.getByRole('button', { name: /load previous txs/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(fetch.mock.calls.every(([url]) => !demo && url === '/api/networks')).toBe(true);
  },
);
