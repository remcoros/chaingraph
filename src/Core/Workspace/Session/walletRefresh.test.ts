import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../createWorkspace';
import { createWorkspacePersistence } from '../Persistence';
import { WorkspaceStore } from './WorkspaceStore';
import { createChainDataAcquisition } from './chainDataAcquisition';
import { deriveAddresses } from '../Wallets/walletDerivation';
import { PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';
import * as staleness from '../Analysis/findingStaleness';
import * as analysis from '../Analysis/analysisScan';
import { scanWallet } from '../Wallets/scanning';

vi.mock('../Wallets/scanning', () => ({ scanWallet: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture() {
  const store = new WorkspaceStore(createWorkspacePersistence());
  const workspace = createWorkspace('Public batch refresh', 'mainnet');
  const wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Public wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: [],
  };
  workspace.wallets.definitions = [wallet];
  store.open(workspace, 'public fixture password');
  const session = store.getUnlocked(workspace.id)!;
  const addresses = deriveAddresses(wallet.key, workspace.network, wallet.scriptType, 0, 0, 125);
  const txid = 'a'.repeat(64);
  vi.mocked(scanWallet).mockImplementation(async () => ({
    wallet: { ...wallet, addresses, scannedAt: new Date().toISOString(), scanComplete: true },
    transactions: [
      {
        txid,
        vin: [{ coinbase: '00' }],
        vout: [{ n: 0, value: 1, scriptPubKey: { address: addresses[0].address } }],
      },
    ],
    truncated: false,
  }));
  const acquisition = createChainDataAcquisition({
    activeWorkspace: workspace,
    getUnlocked: store.getUnlocked,
    fetchScope: session.fetchScope,
  });
  return { store, session, wallet, addresses, acquisition, txid };
}
describe('complete wallet refresh', () => {
  it('continues beyond the first 100 addresses and only reruns analysis when material support changes', async () => {
    const f = fixture();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: [] })));
    vi.stubGlobal('fetch', fetch);
    const scan = vi.spyOn(analysis, 'scanAnalysis');
    const first = await f.acquisition.observe.walletRefresh(f.wallet, { gap: 20, maxIndex: 200 });
    expect(fetch).toHaveBeenCalledTimes(125);
    expect(first.coins.nextCursor).toBeUndefined();
    expect(first.coins.successfulAddresses).toBe(125);
    expect(Object.keys(first.snapshot.chainData.addressUtxos!)).toHaveLength(125);
    expect(scan).toHaveBeenCalledOnce();
    expect(first.wallet.refreshedAt).toBeDefined();
    expect(first.snapshot.wallets.definitions[0].refreshedAt).toBe(first.wallet.refreshedAt);
    expect(first.analysis?.scope.txids).toEqual([f.txid]);
    const invalidate = vi.spyOn(staleness, 'invalidateFindings');
    const second = await f.acquisition.observe.walletRefresh(first.wallet, {
      gap: 20,
      maxIndex: 200,
    });
    expect(second.analysis).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledOnce();
    // A new amount is new support; dates and immutable wrapper replacements above were not.
    vi.mocked(scanWallet).mockResolvedValueOnce({
      wallet: second.wallet,
      transactions: [
        {
          ...second.snapshot.chainData.transactions[f.txid],
          vout: [{ n: 0, value: 2, scriptPubKey: { address: f.addresses[0].address } }],
        },
      ],
      truncated: false,
    });
    await f.acquisition.observe.walletRefresh(second.wallet, { gap: 20, maxIndex: 200 });
    expect(scan).toHaveBeenCalledTimes(2);
  });
  it('keeps a completed first batch when cancellation interrupts a later batch', async () => {
    const f = fixture();
    const controller = new AbortController();
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, options?: RequestInit) => {
        if (++reads <= 100) return new Response(JSON.stringify({ result: [] }));
        return new Promise<Response>((_resolve, reject) =>
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          ),
        );
      }),
    );
    const refresh = f.acquisition.observe.walletRefresh(f.wallet, {
      gap: 20,
      maxIndex: 200,
      signal: controller.signal,
    });
    const rejected = expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(reads).toBeGreaterThan(100));
    expect(
      Object.keys(f.store.getUnlocked(f.session.data.id)!.data.chainData.addressUtxos!),
    ).toHaveLength(100);
    controller.abort();
    await rejected;
    expect(f.session.data.wallets.definitions[0].refreshedAt).toBeUndefined();
    expect(
      Object.keys(f.store.getUnlocked(f.session.data.id)!.data.chainData.addressUtxos!),
    ).toHaveLength(100);
  });
  it.each(['history', 'coins', 'analysis'] as const)(
    'retains the last complete refresh date after a partial %s stage',
    async (stage) => {
      const f = fixture();
      const refreshedAt = '2026-09-01T10:00:00.000Z';
      f.session.edit(
        (current) => ({
          ...current,
          wallets: {
            ...current.wallets,
            definitions: current.wallets.definitions.map((wallet) => ({ ...wallet, refreshedAt })),
          },
        }),
        false,
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          stage === 'coins'
            ? new Response('{}', { status: 429 })
            : new Response(JSON.stringify({ result: [] })),
        ),
      );
      if (stage === 'history') {
        const discovered = await scanWallet(f.wallet, 'mainnet', {}, { gap: 20, maxIndex: 200 });
        vi.mocked(scanWallet).mockResolvedValueOnce({
          ...discovered,
          wallet: { ...discovered.wallet, scanComplete: false },
        });
      }
      if (stage === 'analysis') {
        const scanAnalysis = analysis.scanAnalysis;
        vi.spyOn(analysis, 'scanAnalysis').mockImplementationOnce(async (...args) => {
          const scan = await scanAnalysis(...args);
          return {
            ...scan,
            reports: scan.reports.map((report, index) =>
              index === 0 ? { ...report, status: 'error' as const } : report,
            ),
          };
        });
      }
      const result = await f.acquisition.observe.walletRefresh(f.wallet, {
        gap: 20,
        maxIndex: 200,
      });
      expect(result.wallet.refreshedAt).toBe(refreshedAt);
      expect(result.snapshot.wallets.definitions[0].refreshedAt).toBe(refreshedAt);
      if (stage === 'coins') expect(result.coins.errors).toHaveLength(125);
      if (stage === 'analysis') expect(result.analysis?.reports[0].status).toBe('error');
    },
  );
});
