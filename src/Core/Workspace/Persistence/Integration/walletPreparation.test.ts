import { afterEach, describe, expect, it, vi } from 'vitest';
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
import * as walletRecords from '../../Wallets/walletRecords';
import * as reviewEvidence from '../../Wallets/walletReviewEvidence';
import * as walletReview from '../../Wallets/walletReview';
import { saveCounterparty } from '../../Counterparties/counterparties';
import { walletTransactionCounterpartySubject } from '../../Counterparties/walletCounterpartySubjects';

afterEach(() => vi.restoreAllMocks());

describe('session wallet preparation', () => {
  it('updates and undoes counterparty context without recalculating accounting or finding support', () => {
    const workspace = largeWalletFixture(3, 2);
    const wallet = workspace.wallets.definitions[0];
    const txid = wallet.addresses[0].history![1].tx_hash;
    workspace.analysis.findings = [
      {
        id: 'spending-finding',
        algorithm: 'value-flow-v1',
        title: 'Spending finding',
        description: 'Public fixture',
        txids: [txid],
        nodeIds: [`tx:${txid}`],
        subjects: [`tx:${txid}`],
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ];
    const accounting = vi.spyOn(walletRecords, 'listWalletTransactions');
    const evidence = vi.spyOn(reviewEvidence, 'walletFindingEvidence');
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet);
    const subject = walletTransactionCounterpartySubject(workspace, wallet, txid, 'sent')!;
    const edited = saveCounterparty(
      workspace,
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Public shop',
      },
      subject,
    );
    const after = cache.prepare(edited, wallet);
    expect(after.transactionRecords).toBe(before.transactionRecords);
    expect(after.addressRecords).toBe(before.addressRecords);
    expect(
      after.review.items.find((item) => item.goal === 'counterparty-context' && item.txid === txid),
    ).toMatchObject({ satisfied: true, status: 'resolved' });
    expect(after.review.items.find((item) => item.kind === 'finding')?.evidence).toBe(
      before.review.items.find((item) => item.kind === 'finding')?.evidence,
    );
    const undone = cache.prepare(workspace, wallet);
    expect(
      undone.review.items.find(
        (item) => item.goal === 'counterparty-context' && item.txid === txid,
      ),
    ).toMatchObject({ satisfied: false, status: 'open' });
    expect(accounting).toHaveBeenCalledTimes(1);
    expect(evidence).toHaveBeenCalledTimes(1);

    const transaction = workspace.chainData.transactions[txid];
    const changed = {
      ...workspace,
      chainData: {
        ...workspace.chainData,
        transactions: {
          ...workspace.chainData.transactions,
          [txid]: {
            ...transaction,
            vout: [{ ...transaction.vout[0], value: 0.8 }, transaction.vout[1]],
          },
        },
      },
    };
    const refreshed = cache.prepare(changed, wallet);
    expect(refreshed.transactionRecords).not.toBe(before.transactionRecords);
    expect(refreshed.review.items.find((item) => item.kind === 'finding')?.evidence).not.toBe(
      before.review.items.find((item) => item.kind === 'finding')?.evidence,
    );
    expect(accounting).toHaveBeenCalledTimes(2);
    expect(evidence).toHaveBeenCalledTimes(2);
  });

  it('invalidates wallet-intersection support when another wallet changes its derivation anchors', () => {
    const workspace = largeWalletFixture(2, 2);
    const wallet = workspace.wallets.definitions[0];
    const other = { ...wallet, id: 'other-wallet', addresses: wallet.addresses.slice(1) };
    workspace.wallets.definitions.push(other);
    const txid = wallet.addresses[0].history![1].tx_hash;
    workspace.analysis.findings = [
      {
        id: 'wallet-match',
        algorithm: 'wallet-intersections-v1',
        title: 'Wallet match',
        description: 'Public fixture',
        txids: [txid],
        nodeIds: [`tx:${txid}`],
        subjects: [`tx:${txid}`],
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ];
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet);
    const renamed = {
      ...workspace,
      wallets: { ...workspace.wallets, definitions: [wallet, { ...other, name: 'Renamed' }] },
    };
    expect(cache.prepare(renamed, wallet)).toBe(before);
    const changed = {
      ...workspace,
      wallets: { ...workspace.wallets, definitions: [wallet, { ...other, addresses: [] }] },
    };
    expect(cache.peek(changed, wallet)).toBeUndefined();
    const after = cache.prepare(changed, wallet);
    expect(after.transactionRecords).toBe(before.transactionRecords);
    expect(after.review.items.find((item) => item.kind === 'finding')?.evidence).not.toBe(
      before.review.items.find((item) => item.kind === 'finding')?.evidence,
    );
  });

  it('prepares only the checked projection when the first render already has a coin check', () => {
    const workspace = largeWalletFixture(2, 2);
    const wallet = workspace.wallets.definitions[0];
    const review = vi.spyOn(walletReview, 'buildWalletReview');
    const cache = new WalletPreparationCache();
    const checked = cache.prepare(workspace, wallet, {
      records: [],
      checkedAt: '2026-10-01T10:00:00.000Z',
      checkedAddresses: 2,
      totalAddresses: 2,
      failed: 0,
    });
    expect(checked.review.coverage.utxoCount).toBe(0);
    expect(review).toHaveBeenCalledTimes(1);
    const unchecked = cache.prepare(workspace, wallet);
    expect(unchecked.review.coverage.utxoCount).toBeUndefined();
    expect(unchecked.transactionRecords).toBe(checked.transactionRecords);
    expect(review).toHaveBeenCalledTimes(2);
  });
  it('renders a remounted warm wallet immediately', () => {
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
      updateEvidence: noop,
    };
    expect(renderToStaticMarkup(createElement(WalletWorkbenchView, props))).toContain(
      'Preparing wallet',
    );
    preparationCache.prepare(workspace, wallet);
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
            kind: 'annotation-goal' as const,
            status: 'later' as const,
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
      status: 'resolved',
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
      { ...workspace, counterparties: { definitions: [], links: [] } },
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
  });

  it('reuses material review data on quiet refreshes while updating observation dates', () => {
    const workspace = largeWalletFixture(3, 2);
    const wallet = workspace.wallets.definitions[0];
    const cache = new WalletPreparationCache();
    const check: WalletUtxoCheck = {
      records: [],
      checkedAt: '2026-10-01T12:00:00.000Z',
      checkedAddresses: 2,
      totalAddresses: 2,
      failed: 0,
    };
    const before = cache.prepare(workspace, wallet, check);
    const refreshedWallet = { ...wallet, scannedAt: '2026-10-01T12:01:00.000Z' };
    const refreshedWorkspace = {
      ...workspace,
      wallets: {
        ...workspace.wallets,
        definitions: [refreshedWallet],
      },
    };
    const after = cache.prepare(refreshedWorkspace, refreshedWallet, {
      ...check,
      records: [...check.records],
      checkedAt: '2026-10-01T12:01:00.000Z',
    });
    expect(after.review.items).toBe(before.review.items);
    expect(after.review.groups).toBe(before.review.groups);
    expect(after.selectionIndex).toBe(before.selectionIndex);
    expect(after.review.coverage.scannedAt).toBe(refreshedWallet.scannedAt);
    expect(after.review.coverage.utxoCheckedAt).toBe('2026-10-01T12:01:00.000Z');
    expect(
      cache.peek(refreshedWorkspace, refreshedWallet, {
        ...check,
        failed: 1,
      }),
    ).toBeUndefined();
  });

  it('compares accepted coin evidence independently of immutable check wrappers', () => {
    const workspace = largeWalletFixture(1, 1);
    const wallet = workspace.wallets.definitions[0];
    const transaction = Object.values(workspace.chainData.transactions)[0];
    const address = wallet.addresses[0];
    const record = {
      txid: transaction.txid,
      vout: 0,
      valueSats: Math.round(transaction.vout[0].value * 100_000_000),
      height: 100,
      address: address.address,
      scripthash: address.scripthash,
    };
    const check: WalletUtxoCheck = {
      records: [record],
      checkedAt: '2026-10-01T12:00:00.000Z',
      checkedAddresses: 1,
      totalAddresses: 1,
      failed: 0,
    };
    const cache = new WalletPreparationCache();
    const before = cache.prepare(workspace, wallet, check);
    const renewed = { ...check, records: [{ ...record }], checkedAt: '2026-10-01T12:01:00.000Z' };
    const after = cache.prepare(workspace, wallet, renewed);
    expect(after.currentUtxos).toBe(before.currentUtxos);
    expect(after.review.items).toBe(before.review.items);
    for (const changed of [
      { ...record, valueSats: record.valueSats + 1 },
      { ...record, height: 101 },
      { ...record, scripthash: 'a'.repeat(64) },
    ]) {
      expect(cache.peek(workspace, wallet, { ...renewed, records: [changed] })).toBeUndefined();
    }
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
