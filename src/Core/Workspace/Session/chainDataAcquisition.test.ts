import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../createWorkspace';
import { createWorkspacePersistence, parseWorkspace } from '../Persistence';
import { WorkspaceStore } from './WorkspaceStore';
import { createChainDataAcquisition } from './chainDataAcquisition';
import { RECEIVE_ADDRESS, SECOND_ADDRESS, PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';

const txid = 'a'.repeat(64);
function fixture() {
  const store = new WorkspaceStore(createWorkspacePersistence());
  const workspace = createWorkspace('Public observation fixture', 'mainnet');
  const transaction = {
    txid,
    vin: [{ txid: 'b'.repeat(64), vout: 0 }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  };
  workspace.chainData.transactions[txid] = {
    ...transaction,
    status: { kind: 'confirmed', confirmations: 1 },
  };
  workspace.view.inputContext = { [txid]: [0] };
  store.open(workspace, 'public fixture password');
  const session = store.getUnlocked(workspace.id)!;
  const acquisition = createChainDataAcquisition({
    activeWorkspace: workspace,
    getUnlocked: store.getUnlocked,
    fetchScope: session.fetchScope,
  });
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: RequestInfo | URL, options?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = options?.signal;
          const abort = () => reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
          if (signal?.aborted) {
            abort();
            return;
          }
          signal?.addEventListener('abort', abort, { once: true });
          pending.push((response) => {
            signal?.removeEventListener('abort', abort);
            resolve(response);
          });
        }),
    ),
  );
  const reply = (index: number, confirmations: number, enrich = false) =>
    pending[index](
      new Response(
        JSON.stringify({
          result: {
            ...transaction,
            confirmations,
            ...(enrich && {
              vin: [{ ...transaction.vin[0], prevout: { value: 2, scriptPubKey: { hex: '51' } } }],
            }),
          },
        }),
      ),
    );
  const current = () => store.getUnlocked(workspace.id)!.data;
  return { store, workspace, session, acquisition, pending, reply, current };
}
afterEach(() => vi.unstubAllGlobals());

describe('fresh transaction observation acceptance', () => {
  it('retains a completed watched-address check when a later address is cancelled', async () => {
    const f = fixture();
    f.session.edit((current) => ({
      ...current,
      chainData: {
        ...current.chainData,
        watchedAddresses: [RECEIVE_ADDRESS, SECOND_ADDRESS],
      },
    }));
    const controller = new AbortController();
    const result = f.acquisition.observe.watchedAddresses([RECEIVE_ADDRESS, SECOND_ADDRESS], {
      signal: controller.signal,
    });
    const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    f.pending[0](new Response(JSON.stringify({ result: [] })));
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    controller.abort();
    await cancelled;
    expect(f.current().chainData.addressHistories?.[RECEIVE_ADDRESS]).toMatchObject({
      history: [],
      scannedAt: expect.any(String),
    });
    expect(f.current().chainData.addressHistories?.[SECOND_ADDRESS]).toBeUndefined();
  });

  it('does not retain a watched-address result after its watch source was removed', async () => {
    const f = fixture();
    f.session.edit((current) => ({
      ...current,
      chainData: { ...current.chainData, watchedAddresses: [RECEIVE_ADDRESS] },
    }));
    const result = f.acquisition.observe.watchedAddresses([RECEIVE_ADDRESS]);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    f.session.edit((current) => ({
      ...current,
      chainData: { ...current.chainData, watchedAddresses: [] },
    }));
    f.pending[0](new Response(JSON.stringify({ result: [] })));
    await result;
    expect(f.current().chainData.addressHistories?.[RECEIVE_ADDRESS]).toBeUndefined();
  });

  it.each(['close', 'replace'] as const)(
    'rejects a wallet scan after its session or binding changes: %s',
    async (change) => {
      const f = fixture();
      const wallet = {
        id: '30000000-0000-4000-8000-000000000001',
        name: 'Public wallet',
        key: PUBLIC_ZPUB,
        scriptType: 'p2wpkh' as const,
        color: '#27c4a7',
        addresses: [],
      };
      f.session.edit((current) => ({
        ...current,
        wallets: { ...current.wallets, definitions: [wallet] },
      }));
      const result = f.acquisition.observe.walletScan(wallet, { gap: 1, maxIndex: 1 });
      const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(f.pending).toHaveLength(2));
      if (change === 'close') f.session.fetchScope.close();
      else {
        f.session.edit((current) => ({
          ...current,
          wallets: { ...current.wallets, definitions: [{ ...wallet, scriptType: 'p2pkh' }] },
        }));
        for (const reply of f.pending) reply(new Response(JSON.stringify({ result: [] })));
      }
      await cancelled;
      expect(f.current().wallets.definitions[0].scannedAt).toBeUndefined();
    },
  );
  it('refreshes loaded data and keeps newer placement when completions reverse, retaining older input enrichment', async () => {
    const f = fixture();
    const older = f.acquisition.observe.refreshTransaction(txid);
    const newer = f.acquisition.observe.refreshTransaction(txid);
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.reply(1, 3);
    expect(await newer).toBe(true);
    const newestStatus = f.current().chainData.transactions[txid].status;
    f.reply(0, 2, true);
    expect(await older).toBe(true);
    const current = f.current();
    expect(current.chainData.transactions[txid].status).toBe(newestStatus);
    expect(newestStatus).toMatchObject({
      kind: 'confirmed',
      confirmations: 3,
      observation: { source: 'core', observedAt: expect.any(String) },
    });
    expect(current.chainData.transactions[txid].vin[0].prevout?.value).toBe(2);
    expect(current.view.inputContext).toEqual(f.workspace.view.inputContext);
    expect(f.store.getUnlocked(current.id)!.history).toHaveLength(0);
    const restored = parseWorkspace(current);
    expect(restored.chainData.transactions[txid]).toEqual(current.chainData.transactions[txid]);
    expect(JSON.stringify(restored)).not.toMatch(/sequence|observationOrder/);
  });

  it('does not let a failed newer request suppress a useful earlier response or fabricate freshness', async () => {
    const f = fixture();
    const older = f.acquisition.observe.refreshTransaction(txid);
    const newer = f.acquisition.observe.refreshTransaction(txid);
    const failed = expect(newer).rejects.toThrow();
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.pending[1](new Response(JSON.stringify({ error: 'Synthetic limit' }), { status: 429 }));
    await failed;
    expect(f.current().chainData.transactions[txid].status?.observation).toBeUndefined();
    f.reply(0, 2);
    expect(await older).toBe(true);
    expect(f.current().chainData.transactions[txid].status?.confirmations).toBe(2);
  });

  it('does not resurrect a transaction removed while refresh was pending', async () => {
    const f = fixture();
    const result = f.acquisition.observe.refreshTransaction(txid);
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    f.store.update(f.workspace.id, (current) => ({
      ...current,
      chainData: { ...current.chainData, transactions: {} },
      view: { ...current.view, inputContext: undefined },
    }));
    f.reply(0, 2);
    expect(await result).toBe(false);
    expect(f.current().chainData.transactions[txid]).toBeUndefined();
  });

  it('keeps accepted placement through undo/redo even after an older result arrives', async () => {
    const f = fixture();
    f.store.update(f.workspace.id, (current) => ({ ...current, name: 'User edit' }));
    const older = f.acquisition.observe.refreshTransaction(txid);
    const newer = f.acquisition.observe.refreshTransaction(txid);
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.reply(1, 3);
    await newer;
    f.store.undo(f.workspace.id);
    f.reply(0, 2);
    await older;
    expect(f.current().name).toBe(f.workspace.name);
    expect(f.current().chainData.transactions[txid].status?.confirmations).toBe(3);
    f.store.redo(f.workspace.id);
    expect(f.current().name).toBe('User edit');
    expect(f.current().chainData.transactions[txid].status?.confirmations).toBe(3);
  });
});

describe('session-owned address observations', () => {
  it('publishes balance and UTXOs together without losing either, and carries them through undo', async () => {
    const f = fixture();
    f.store.update(f.workspace.id, (current) => ({ ...current, name: 'User edit' }));
    const balanceRequest = f.acquisition.read.addressBalance(RECEIVE_ADDRESS);
    const utxoRequest = f.acquisition.read.addressUtxos(RECEIVE_ADDRESS);
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.pending[0](new Response(JSON.stringify({ result: { confirmed: 100, unconfirmed: 0 } })));
    f.pending[1](
      new Response(
        JSON.stringify({ result: [{ tx_hash: txid, tx_pos: 0, value: 100, height: 1 }] }),
      ),
    );
    const [balance, utxos] = await Promise.all([balanceRequest, utxoRequest]);
    expect(
      f.acquisition.observe.addresses({
        addressBalances: { [RECEIVE_ADDRESS]: balance },
        addressUtxos: { [RECEIVE_ADDRESS]: utxos },
      }),
    ).toBe(true);
    expect(f.current().chainData.addressBalances?.[RECEIVE_ADDRESS]).toBe(balance);
    expect(f.current().chainData.addressUtxos?.[RECEIVE_ADDRESS]).toBe(utxos);
    f.store.undo(f.workspace.id);
    expect(f.current().name).toBe(f.workspace.name);
    expect(f.current().chainData.addressBalances?.[RECEIVE_ADDRESS]).toBe(balance);
    expect(f.current().chainData.addressUtxos?.[RECEIVE_ADDRESS]).toBe(utxos);
    const restored = parseWorkspace(JSON.parse(JSON.stringify(f.current())));
    expect(restored.chainData.addressUtxos?.[RECEIVE_ADDRESS]).toEqual(utxos);
  });

  it('orders accepted address responses by request, not completion or wall clock', async () => {
    const f = fixture();
    const older = f.acquisition.read.addressBalance(RECEIVE_ADDRESS);
    const newer = f.acquisition.read.addressBalance(RECEIVE_ADDRESS);
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.pending[1](new Response(JSON.stringify({ result: { confirmed: 200, unconfirmed: 0 } })));
    const latest = await newer;
    f.acquisition.observe.addresses({ addressBalances: { [RECEIVE_ADDRESS]: latest } });
    const revision = f.store.getUnlocked(f.workspace.id)!.revision;
    f.pending[0](new Response(JSON.stringify({ result: { confirmed: 100, unconfirmed: 0 } })));
    f.acquisition.observe.addresses({ addressBalances: { [RECEIVE_ADDRESS]: await older } });
    expect(f.current().chainData.addressBalances?.[RECEIVE_ADDRESS]).toBe(latest);
    expect(f.store.getUnlocked(f.workspace.id)!.revision).toBe(revision);
  });

  it('does not let a failed newer check erase useful prior data or suppress a successful older request', async () => {
    const f = fixture();
    const older = f.acquisition.read.addressUtxos(RECEIVE_ADDRESS);
    const newer = f.acquisition.read.addressUtxos(RECEIVE_ADDRESS);
    const failure = expect(newer).rejects.toThrow();
    await vi.waitFor(() => expect(f.pending).toHaveLength(2));
    f.pending[1](new Response(JSON.stringify({ error: 'Synthetic failure' }), { status: 429 }));
    await failure;
    expect(f.current().chainData.addressUtxos).toBeUndefined();
    f.pending[0](new Response(JSON.stringify({ result: [] })));
    const useful = await older;
    f.acquisition.observe.addresses({ addressUtxos: { [RECEIVE_ADDRESS]: useful } });
    expect(f.current().chainData.addressUtxos?.[RECEIVE_ADDRESS]).toBe(useful);
  });

  it('retains observed history and completed detail checkpoints when cancelled', async () => {
    const f = fixture();
    const controller = new AbortController();
    const first = 'c'.repeat(64),
      second = 'd'.repeat(64);
    const operation = f.acquisition.observe.addressHistory(RECEIVE_ADDRESS, {
      signal: controller.signal,
    });
    const cancelled = expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.pending).toHaveLength(1));
    f.pending[0](
      new Response(
        JSON.stringify({
          result: [
            { tx_hash: first, height: 0 },
            { tx_hash: second, height: 0 },
          ],
        }),
      ),
    );
    await vi.waitFor(() => expect(f.pending).toHaveLength(3));
    expect(f.current().chainData.addressHistories?.[RECEIVE_ADDRESS]?.history).toHaveLength(2);
    f.pending[1](
      new Response(
        JSON.stringify({
          result: {
            txid: first,
            vin: [{ coinbase: '00' }],
            vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
            confirmations: 0,
          },
        }),
      ),
    );
    await vi.waitFor(() => expect(f.current().chainData.transactions[first]).toBeDefined());
    controller.abort();
    await cancelled;
    expect(f.current().chainData.transactions[first]).toBeDefined();
    expect(f.current().chainData.transactions[second]).toBeUndefined();
  });

  it('rejects cross-network values and rejects publication while locking', () => {
    const f = fixture();
    const observation = {
      network: 'testnet4' as const,
      confirmedSats: 0,
      unconfirmedSats: 0,
      checkedAt: new Date().toISOString(),
    };
    expect(() =>
      f.acquisition.observe.addresses({ addressBalances: { [RECEIVE_ADDRESS]: observation } }),
    ).toThrow('different network');
    f.store.getUnlocked(f.workspace.id)!.locking = true;
    expect(f.acquisition.observe.addresses({})).toBe(false);
  });
});
