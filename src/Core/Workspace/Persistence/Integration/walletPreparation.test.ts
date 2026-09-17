import { describe, expect, it } from 'vitest';
import { WalletPreparationCache } from '../../Wallets/walletPreparation';
import { largeWalletFixture } from '../../../../../tests/fixtures/wallet-performance';
import type { WalletUtxoCheck } from '../../Wallets/WalletUtxos/walletUtxoCheck';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WalletWorkbenchView,
  type WalletWorkbenchViewProps,
} from '../../../../App/Workspace/Workbenches/Wallet/WalletWorkbench';

describe('session wallet preparation', () => {
  it('renders a remounted warm wallet immediately, including after pagination', () => {
    const workspace = largeWalletFixture(2, 2);
    const wallet = workspace.wallets.definitions[0];
    const preparationCache = new WalletPreparationCache();
    const noop = () => {};
    const props: WalletWorkbenchViewProps = {
      workspace,
      wallet,
      preparationCache,
      active: true,
      canLoadChainData: false,
      busy: false,
      walletUtxos: { loading: false, error: '', check: async () => {} },
      onSelectWallet: noop,
      onAddWallet: noop,
      onChange: noop,
      onRefresh: noop,
      onShowInGraph: noop,
      onIsolateInGraph: noop,
      onShowSelection: noop,
      onInspect: noop,
      onAnalyze: noop,
      updateEvidence: noop,
    };
    expect(renderToStaticMarkup(createElement(WalletWorkbenchView, props))).toContain(
      'Preparing wallet',
    );
    preparationCache.prepare(workspace, wallet, undefined, 2);
    const html = renderToStaticMarkup(createElement(WalletWorkbenchView, props));
    expect(html).not.toContain('Preparing wallet');
    expect(html).toContain('aria-label="Wallet sections"');
  });
  it('reuses a prepared wallet across view changes and visits to another wallet', () => {
    const workspace = largeWalletFixture(3, 2);
    const first = workspace.wallets.definitions[0];
    const second = {
      ...first,
      id: 'second-wallet',
      name: 'Second wallet',
      addresses: first.addresses.slice(1),
    };
    workspace.wallets.definitions.push(second);
    const cache = new WalletPreparationCache();
    const prepared = cache.prepare(workspace, first);
    const other = cache.prepare(workspace, second);
    expect(other.selectionIndex).toBe(prepared.selectionIndex);
    expect(other.relationships).not.toBe(prepared.relationships);
    const afterNavigation = {
      ...workspace,
      view: { ...workspace.view, workbench: 'graph' as const },
    };
    expect(cache.peek(afterNavigation, first)).toBe(prepared);
    expect(cache.prepare(afterNavigation, first)).toBe(prepared);
  });

  it('updates labels and decisions without rebuilding chain relationships', () => {
    const workspace = largeWalletFixture(3, 2);
    const wallet = workspace.wallets.definitions[0];
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet);
    const item = before.review.items[0];
    const edited = {
      ...workspace,
      annotations: {
        ...workspace.annotations,
        entities: {
          ...workspace.annotations.entities,
          [item.nodeId]: { label: 'Recognized receipt', note: '', icon: '', bookmarked: false },
        },
      },
      wallets: {
        ...workspace.wallets,
        reviews: {
          [item.key]: {
            status: 'reviewed' as const,
            evidence: item.evidence,
            at: '2026-09-11T12:00:00.000Z',
          },
        },
      },
    };
    expect(cache.peek(edited, wallet)).toBeUndefined();
    const after = cache.prepare(edited, wallet);
    expect(after.selectionIndex).toBe(before.selectionIndex);
    expect(after.relationships).toBe(before.relationships);
    expect(after.review.items.find((entry) => entry.key === item.key)).toMatchObject({
      label: 'Recognized receipt',
      status: 'reviewed',
    });
    const undone = cache.prepare(workspace, wallet);
    expect(undone.review.items.find((entry) => entry.key === item.key)?.status).toBe('open');
  });

  it('invalidates review decoration for tags and findings', () => {
    const workspace = largeWalletFixture(2, 2);
    const wallet = workspace.wallets.definitions[0];
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet);
    for (const changed of [
      {
        ...workspace,
        annotations: { ...workspace.annotations, tags: [...(workspace.annotations.tags ?? [])] },
      },
      {
        ...workspace,
        analysis: { ...workspace.analysis, findings: [...workspace.analysis.findings] },
      },
    ]) {
      expect(cache.peek(changed, wallet)).toBeUndefined();
      const after = cache.prepare(changed, wallet);
      expect(after.review).not.toBe(before.review);
      expect(after.relationships).toBe(before.relationships);
    }
  });

  it('rebuilds evidence for changed transactions or network', () => {
    const workspace = largeWalletFixture(2, 2);
    const wallet = workspace.wallets.definitions[0];
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet);
    const emptied = { ...workspace, chainData: { ...workspace.chainData, transactions: {} } };
    expect(cache.peek(emptied, wallet)).toBeUndefined();
    const after = cache.prepare(emptied, wallet);
    expect(after.selectionIndex).not.toBe(before.selectionIndex);
    expect(after.selectionIndex.transactions.size).toBe(0);
    const testnet = { ...workspace, network: 'testnet4' as const };
    const otherNetwork = cache.prepare(testnet, wallet);
    expect(otherNetwork.walletAddresses.addresses.size).toBe(0);
    expect(otherNetwork.relationships).not.toBe(before.relationships);
  });

  it('rebuilds wallet association when its discovered addresses change', () => {
    const workspace = largeWalletFixture(3, 2);
    const wallet = workspace.wallets.definitions[0];
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet);
    const changed = { ...wallet, addresses: [] };
    const after = cache.prepare(
      { ...workspace, wallets: { ...workspace.wallets, definitions: [changed] } },
      changed,
    );
    expect(after.selectionIndex).toBe(before.selectionIndex);
    expect(after.relationships).not.toBe(before.relationships);
    expect(after.walletAddresses.addresses.size).toBe(0);
    expect(after.review.items).toHaveLength(0);
  });

  it('keeps a return view without treating previous UTXO checks as current', () => {
    const workspace = largeWalletFixture(2, 2);
    const wallet = workspace.wallets.definitions[0];
    const cache = new WalletPreparationCache();
    const beforeCheck = cache.prepare(workspace, wallet);
    const utxos: WalletUtxoCheck = {
      records: [],
      checkedAt: '2026-09-11T12:00:00.000Z',
      checkedAddresses: 2,
      totalAddresses: 2,
      failed: 0,
    };
    const checked = cache.prepare(workspace, wallet, utxos);
    expect(checked.review.coverage.utxoCount).toBe(0);
    expect(cache.prepare(workspace, wallet)).toBe(beforeCheck);
    expect(beforeCheck.review.coverage.utxoCount).toBeUndefined();
    expect(cache.prepare(workspace, wallet, utxos)).toBe(checked);
    const refreshed = cache.prepare(workspace, wallet, {
      ...utxos,
      checkedAt: '2026-09-11T12:01:00.000Z',
    });
    expect(refreshed.review).not.toBe(checked.review);
    expect(refreshed.relationships).toBe(checked.relationships);
    expect(cache.peek(workspace, wallet, undefined, 2)).toBeUndefined();
    cache.prepare(workspace, wallet, undefined, 2);
    expect(cache.peek(workspace, wallet)).toBe(beforeCheck);
  });

  it('retains separate unlocked sessions, clears on lock, and survives a failed save', async () => {
    let failSave = true;
    const store = createBrowserWorkspaceStore({
      storage: {
        getItem: () => null,
        setItem: () => {
          if (failSave) throw new Error('Storage unavailable');
        },
      },
    });
    const first = largeWalletFixture(1, 1);
    const second = largeWalletFixture(1, 1);
    store.open(first, 'public fixture password');
    const session = store.getUnlocked(first.id)!;
    const prepared = session.walletPreparation.prepare(first, first.wallets.definitions[0]);
    store.open(second, 'public fixture password');
    store.setActiveId(first.id);
    expect(
      store.getUnlocked(first.id)?.walletPreparation.peek(first, first.wallets.definitions[0]),
    ).toBe(prepared);
    expect(
      store.getUnlocked(second.id)?.walletPreparation.peek(second, second.wallets.definitions[0]),
    ).toBeUndefined();
    await expect(store.lock(first.id)).rejects.toThrow();
    expect(session.walletPreparation.peek(first, first.wallets.definitions[0])).toBe(prepared);
    failSave = false;
    await store.lock(first.id);
    expect(store.getUnlocked(first.id)).toBeUndefined();
    expect(session.walletPreparation.peek(first, first.wallets.definitions[0])).toBeUndefined();
    expect(() => session.walletPreparation.prepare(first, first.wallets.definitions[0])).toThrow(
      'closed',
    );
    store.open(first, 'public fixture password');
    expect(store.getUnlocked(first.id)?.walletPreparation).not.toBe(session.walletPreparation);
  });
});
