import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  applyReviewDecisions,
  buildWalletReview,
  pruneWalletReviews,
  reviewKey,
  spendGuidance,
  type WalletReviewItem,
} from '../src/domain/walletReview';
import { newWorkspace, parseWorkspace } from '../src/domain/workspace';
import type { Transaction, Wallet, Workspace } from '../src/domain/types';
import { addressToScriptHash } from '../src/lib/wallet';
import type { WalletUtxoRecord } from '../src/domain/walletRecords';

const mine = (fill: number) => bitcoinAddress.toBech32(new Uint8Array(20).fill(fill), 0, 'bc');
const MINE_A = mine(1);
const MINE_B = mine(2);
const THEIRS = mine(9);
const script = (address: string) => bytesToHex(bitcoinAddress.toOutputScript(address));
const id = (n: number) => n.toString(16).padStart(64, '0');

const wallet: Wallet = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Old wallet',
  key: '',
  color: '#27c4a7',
  scriptType: 'p2wpkh',
  addresses: [MINE_A, MINE_B].map((address, index) => ({
    address,
    scripthash: addressToScriptHash(address, 'mainnet'),
    path: `account/0/${index}`,
    branch: 0 as const,
    index,
    history: [{ tx_hash: id(1), height: 800000 }],
  })),
  scannedAt: '2026-09-08T10:00:00.000Z',
  scanComplete: true,
};

// receipt(1) pays MINE_A; spend(2) consumes it into MINE_B plus a payment to THEIRS.
const receipt: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: script(MINE_A) } }],
  blockHeight: 800000,
};
const spend: Transaction = {
  txid: id(2),
  vin: [{ txid: id(1), vout: 0 }],
  vout: [
    { n: 0, value: 0.6, scriptPubKey: { hex: script(MINE_B) } },
    { n: 1, value: 0.39, scriptPubKey: { hex: script(THEIRS) } },
  ],
  blockHeight: 800001,
};
const utxo: WalletUtxoRecord = {
  txid: id(2),
  vout: 0,
  valueSats: 60_000_000,
  height: 800001,
  address: MINE_B,
  scripthash: addressToScriptHash(MINE_B, 'mainnet'),
};

function fixture(overrides: Partial<Workspace> = {}): Workspace {
  return {
    ...newWorkspace('Review fixture', 'mainnet'),
    wallets: [wallet],
    transactions: { [receipt.txid]: receipt, [spend.txid]: spend },
    ...overrides,
  };
}
const build = (workspace: Workspace, utxos: WalletUtxoRecord[] = [utxo]) =>
  buildWalletReview(workspace, workspace.wallets[0], {
    utxos,
    utxoCheckedAt: '2026-09-09T00:00:00.000Z',
    utxoCheckedAddresses: 2,
    utxoTotalAddresses: 2,
  });
const find = (items: WalletReviewItem[], reason: string) =>
  items.filter((item) => item.reason === reason);

describe('wallet review queue', () => {
  it('prioritises current UTXOs, then the receipts that funded them', () => {
    const review = build(fixture());
    expect(review.items[0].reason).toBe('current-utxo');
    expect(review.items[0].nodeId).toBe(`out:${id(2)}:0`);
    expect(review.items[0].amountSats).toBe(60_000_000);
    const sources = find(review.items, 'source');
    expect(sources).toHaveLength(1);
    expect(sources[0].nodeId).toBe(`out:${id(1)}:0`);
    expect(sources[0].detail).toContain('1 current UTXO');
    expect(review.coverage.utxoBalanceSats).toBe(60_000_000);
    expect(review.coverage.utxoCount).toBe(1);
    expect(review.coverage.utxoPartial).toBe(false);
  });

  it('only offers counterparties from transactions this wallet funded', () => {
    const review = build(fixture());
    const counterparties = find(review.items, 'counterparty');
    expect(counterparties.map((item) => item.nodeId)).toEqual([`out:${id(2)}:1`]);
    // An incoming batch that merely paid this wallet does not make its other
    // outputs my counterparties.
    const batch: Transaction = {
      txid: id(3),
      vin: [{ txid: id(8), vout: 0 }],
      vout: [
        { n: 0, value: 0.1, scriptPubKey: { hex: script(MINE_A) } },
        { n: 1, value: 5, scriptPubKey: { hex: script(THEIRS) } },
      ],
    };
    const withBatch = build(
      fixture({
        transactions: { [receipt.txid]: receipt, [spend.txid]: spend, [batch.txid]: batch },
      }),
    );
    expect(find(withBatch.items, 'counterparty').map((item) => item.nodeId)).toEqual([
      `out:${id(2)}:1`,
    ]);
  });

  it('reports unloaded UTXO sources instead of inventing them', () => {
    const review = buildWalletReview(fixture({ transactions: {} }), wallet, { utxos: [utxo] });
    expect(review.missingSourceTransactions).toBe(1);
    expect(find(review.items, 'source')).toHaveLength(0);
    expect(review.coverage.utxoCount).toBe(1);
  });

  it('excludes UTXO observations that disagree with a loaded transaction', () => {
    const review = build(fixture(), [{ ...utxo, valueSats: 1 }]);
    expect(find(review.items, 'current-utxo')).toHaveLength(0);
    expect(review.coverage.utxoCount).toBe(0);
  });

  it('leaves the queue empty of UTXO items when no check has run', () => {
    const review = buildWalletReview(fixture(), wallet);
    expect(find(review.items, 'current-utxo')).toHaveLength(0);
    expect(review.coverage.utxoCount).toBeUndefined();
    // Counterparty and new-activity items still come from loaded observations.
    expect(find(review.items, 'counterparty')).toHaveLength(1);
  });

  it('surfaces only active findings that cover verified wallet outputs', () => {
    const finding = {
      id: 'cioh:aa',
      algorithm: 'cioh-v2',
      title: 'Tentative input group 1',
      description: 'Co-spent outputs',
      nodeIds: [`out:${id(1)}:0`],
      txids: [id(2)],
      createdAt: '2026-09-08T10:00:00.000Z',
      kind: 'hypothesis' as const,
    };
    expect(find(build(fixture({ findings: [finding] })).items, 'link')).toHaveLength(1);
    expect(
      find(build(fixture({ findings: [{ ...finding, stale: true }] })).items, 'link'),
    ).toHaveLength(0);
    expect(
      find(build(fixture({ findings: [{ ...finding, excluded: true }] })).items, 'link'),
    ).toHaveLength(0);
    expect(
      find(
        build(fixture({ findings: [{ ...finding, nodeIds: [`out:${id(7)}:0`] }] })).items,
        'link',
      ),
    ).toHaveLength(0);
  });
});

describe('review decisions', () => {
  it('records one undoable update and keeps decisions across a rebuild', () => {
    const workspace = fixture();
    const review = build(workspace);
    const decided = applyReviewDecisions(workspace, wallet, review.items.slice(0, 2), 'reviewed');
    expect(Object.keys(decided.walletReviews ?? {})).toHaveLength(2);
    const again = build(decided);
    expect(again.items[0].status).toBe('reviewed');
    expect(again.items[0].changed).toBe(false);
    expect(again.items.filter((item) => item.status === 'open').length).toBeGreaterThan(0);
  });

  it('treats an unknown source as a completed review, not a failure', () => {
    const workspace = fixture();
    const item = build(workspace).items[0];
    const decided = applyReviewDecisions(workspace, wallet, [item], 'unknown');
    expect(decided.walletReviews?.[item.key].status).toBe('unknown');
    expect(build(decided).items[0].status).toBe('unknown');
  });

  it('requires review again when the evidence behind a decision changes', () => {
    const workspace = fixture();
    const source = find(build(workspace).items, 'source')[0];
    const decided = applyReviewDecisions(workspace, wallet, [source], 'reviewed');
    // A second current UTXO now traces back to the same receipt.
    const extraSpend: Transaction = {
      txid: id(4),
      vin: [{ txid: id(1), vout: 0 }],
      vout: [{ n: 0, value: 0.2, scriptPubKey: { hex: script(MINE_B) } }],
    };
    const refreshed = {
      ...decided,
      transactions: { ...decided.transactions, [extraSpend.txid]: extraSpend },
    };
    const rebuilt = buildWalletReview(refreshed, wallet, {
      utxos: [utxo, { ...utxo, txid: id(4), vout: 0, valueSats: 20_000_000 }],
    });
    const changed = find(rebuilt.items, 'source')[0];
    expect(changed.status).toBe('reviewed');
    expect(changed.changed).toBe(true);
    // Reopening drops the decision entirely.
    const reopened = applyReviewDecisions(refreshed, wallet, [changed], 'reopen');
    expect(reopened.walletReviews?.[changed.key]).toBeUndefined();
  });

  it('does not reset unrelated decisions when new activity arrives', () => {
    const workspace = fixture();
    const first = build(workspace).items[0];
    const decided = applyReviewDecisions(workspace, wallet, [first], 'reviewed');
    const withActivity: Workspace = {
      ...decided,
      wallets: [{ ...wallet, unreviewedTransactionIds: [id(2)] }],
    };
    const rebuilt = build(withActivity);
    expect(rebuilt.items.find((item) => item.key === first.key)?.status).toBe('reviewed');
    const activity = find(rebuilt.items, 'new-activity');
    expect(activity).toHaveLength(1);
    expect(activity[0].status).toBe('open');
    // Deciding an activity item also acknowledges the wallet's unreviewed queue.
    const acknowledged = applyReviewDecisions(withActivity, wallet, activity, 'reviewed');
    expect(acknowledged.wallets[0].unreviewedTransactionIds).toEqual([]);
    expect(acknowledged.walletReviews?.[first.key].status).toBe('reviewed');
  });

  it('keeps decisions scoped to their wallet and prunes removed wallets', () => {
    const workspace = fixture();
    const item = build(workspace).items[0];
    expect(item.key.startsWith(`${wallet.id}|`)).toBe(true);
    const other: Wallet = { ...wallet, id: '20000000-0000-4000-8000-000000000002', name: 'Other' };
    const decided = applyReviewDecisions(
      { ...workspace, wallets: [wallet, other] },
      wallet,
      [item],
      'reviewed',
    );
    const otherReview = buildWalletReview(decided, other, { utxos: [utxo] });
    expect(otherReview.items[0].status).toBe('open');
    expect(otherReview.items[0].key).not.toBe(item.key);
    const pruned = pruneWalletReviews({ ...decided, wallets: [other] });
    expect(pruned.walletReviews).toBeUndefined();
  });

  it('round-trips review decisions through workspace validation', () => {
    const workspace = fixture();
    const item = build(workspace).items[0];
    // The synthetic wallet key is not derivable, so validate the stored record itself.
    const decided = { ...applyReviewDecisions(workspace, wallet, [item], 'later'), wallets: [] };
    expect(parseWorkspace(decided, false).walletReviews?.[item.key].status).toBe('later');
    expect(() =>
      parseWorkspace(
        { ...decided, walletReviews: { bad: { status: 'done', at: '', evidence: '' } } },
        false,
      ),
    ).toThrow();
    // Older workspaces without the field still load.
    expect(parseWorkspace({ ...fixture(), wallets: [] }, false).walletReviews).toBeUndefined();
  });

  it('builds stable keys that do not collide between reasons', () => {
    expect(reviewKey(wallet.id, 'current-utxo', 'a')).not.toBe(reviewKey(wallet.id, 'source', 'a'));
  });
});

describe('spend guidance', () => {
  it('warns only when the selected outputs carry different recorded sources', () => {
    const workspace = fixture({
      annotations: {
        [`out:${id(1)}:0`]: { label: 'Exchange A', note: '', icon: '', bookmarked: false },
        [`out:${id(2)}:0`]: { label: 'Salary', note: '', icon: '', bookmarked: false },
      },
    });
    expect(spendGuidance(workspace, [`out:${id(1)}:0`])).toBeUndefined();
    expect(spendGuidance(workspace, [`out:${id(1)}:0`, `out:${id(2)}:0`])).toContain(
      'different source labels',
    );
    expect(spendGuidance(workspace, [`out:${id(1)}:0`, `out:${id(2)}:1`])).toContain(
      'no recorded source',
    );
    expect(spendGuidance(fixture(), [`out:${id(1)}:0`, `out:${id(2)}:0`])).toBeUndefined();
  });
});
