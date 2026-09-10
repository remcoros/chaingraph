import { describe, expect, it } from 'vitest';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { newWorkspace } from '../src/domain/workspace';
import { deriveAddresses } from '../src/lib/wallet';
import { addressNodeId, type Wallet } from '../src/domain/types';
import { applyReviewDecisions, buildWalletReview, reviewKey } from '../src/domain/walletReview';
import { walletReviewCategories } from '../src/domain/walletReviewCategories';
import { matchesWalletStatus, reviewRow } from '../src/domain/walletWorkbenchRows';
import { walletReviewGuidance, walletSubjectTitle } from '../src/domain/walletReviewGuidance';
import { PUBLIC_ZPUB, transactions, TX_FUNDING, TX_SPENDING } from './fixtures/bitcoin';

function fixture() {
  const workspace = newWorkspace('Public review guidance', 'mainnet');
  const addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 3);
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Everyday wallet',
    key: PUBLIC_ZPUB,
    color: '#27c4a7',
    scriptType: 'p2wpkh',
    addresses,
  };
  workspace.wallets = [wallet];
  workspace.transactions = structuredClone(transactions);
  const sender = bitcoinAddress.toBech32(new Uint8Array(20).fill(17), 0, 'bc');
  workspace.transactions[TX_FUNDING].vin = [
    {
      txid: 'c'.repeat(64),
      vout: 0,
      prevout: {
        value: 2.0001,
        scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(sender)) },
      },
    },
  ];
  const options = {
    utxos: [
      {
        txid: TX_SPENDING,
        vout: 0,
        valueSats: 149_990_000,
        height: 800000,
        address: addresses[0].address,
        scripthash: addresses[0].scripthash,
      },
    ],
  };
  return { workspace, wallet, addresses, options };
}

describe('guided wallet review', () => {
  it('reviews used own addresses without adding unused gap addresses or acknowledging UTXOs', () => {
    const { workspace, wallet, addresses, options } = fixture();
    const initial = buildWalletReview(workspace, wallet, options);
    const own = initial.items.filter((item) => item.reason === 'wallet-address');
    expect(own.map((item) => item.nodeId).sort()).toEqual(
      addresses
        .slice(0, 2)
        .map((entry) => addressNodeId(entry.address))
        .sort(),
    );
    expect(initial.items[0].reason).toBe('current-utxo');
    const target = own.find((item) => item.address === addresses[0].address)!;
    const reviewed = applyReviewDecisions(workspace, wallet, [target], 'reviewed');
    expect(Object.keys(reviewed.walletReviews!)).toEqual([target.key]);
    reviewed.annotations[target.nodeId] = {
      label: 'Savings receipts',
      note: '',
      icon: '',
      bookmarked: false,
    };
    reviewed.transactions['d'.repeat(64)] = {
      txid: 'd'.repeat(64),
      vin: [{ coinbase: '00' }],
      vout: [
        {
          n: 0,
          value: 0.1,
          scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(addresses[0].address)) },
        },
      ],
    };
    const next = buildWalletReview(reviewed, wallet, options);
    expect(next.items.find((item) => item.key === target.key)).toMatchObject({
      status: 'reviewed',
      changed: false,
    });
    expect(next.items.find((item) => item.reason === 'current-utxo')?.status).toBe('open');
  });

  it('offers address counterparties, not new individual funding or destination-output tasks', () => {
    const { workspace, wallet, options } = fixture();
    const review = buildWalletReview(workspace, wallet, options);
    expect(review.items.some((item) => item.reason === 'source-address')).toBe(true);
    expect(review.items.some((item) => item.reason === 'destination-address')).toBe(true);
    expect(
      review.items.some(
        (item) => item.reason === 'counterparty' || item.reason === 'funding-source',
      ),
    ).toBe(false);
    const categories = walletReviewCategories(workspace, review.items);
    expect(
      categories.some((item) => item.id === 'counterparty' || item.id === 'funding-source'),
    ).toBe(false);
    expect(categories.some((item) => item.id === 'wallet-address')).toBe(true);
  });

  it('retains compatible saved output decisions as history without copying them to addresses', () => {
    const { workspace, wallet, options } = fixture();
    const key = reviewKey(wallet.id, 'counterparty', `${TX_SPENDING}:1`);
    workspace.walletReviews = {
      [key]: { status: 'unknown', at: '2026-09-09T10:00:00Z', evidence: 'old' },
    };
    const legacy = buildWalletReview(workspace, wallet, options).items.find(
      (item) => item.key === key,
    )!;
    workspace.walletReviews[key].evidence = legacy.evidence;
    const review = buildWalletReview(workspace, wallet, options);
    expect(review.items.find((item) => item.key === key)).toMatchObject({
      status: 'unknown',
      changed: false,
    });
    const legacyRow = reviewRow(review.items.find((item) => item.key === key)!);
    expect(matchesWalletStatus({ ...legacyRow, changed: true }, 'open')).toBe(false);
    expect(matchesWalletStatus({ ...legacyRow, changed: true }, 'decided')).toBe(true);
    expect(walletReviewGuidance(legacyRow, { tagCount: 0 })).toContain('Saved output decision');
    expect(review.items.find((item) => item.reason === 'destination-address')?.status).toBe('open');
    expect(
      walletReviewCategories(workspace, []).find(
        (category) => category.id === 'saved-output-reviews',
      )?.count,
    ).toBe(0);
  });

  it('explains source, destination, own-address and UTXO tasks with an actionable sentence', () => {
    const { workspace, wallet, options } = fixture();
    const items = buildWalletReview(workspace, wallet, options).items;
    const source = reviewRow(items.find((item) => item.reason === 'source-address')!);
    expect(source.ownership).toBe('external');
    expect(walletSubjectTitle(source)).toBe('Source address');
    expect(walletReviewGuidance(source, { tagCount: 0 })).toContain('sender or source');
    expect(walletReviewGuidance(source, { tagCount: 1 })).not.toContain('has no label or tags');
    expect(walletReviewGuidance(source, { label: 'Exchange', tagCount: 0 })).toContain(
      'Mark reviewed',
    );
    const destination = reviewRow(items.find((item) => item.reason === 'destination-address')!);
    expect(walletReviewGuidance(destination, { tagCount: 0 })).toContain('recipient or purpose');
    const own = reviewRow(items.find((item) => item.reason === 'wallet-address')!);
    expect(walletReviewGuidance(own, { tagCount: 0 })).toContain('what you use it for');
    const utxo = reviewRow(items.find((item) => item.reason === 'current-utxo')!);
    expect(walletReviewGuidance(utxo, { tagCount: 0 })).toContain('where you received it');
  });

  it('does not tell users to label completed or deferred decisions as if they were new', () => {
    const { workspace, wallet, options } = fixture();
    const row = reviewRow(buildWalletReview(workspace, wallet, options).items[0]);
    expect(walletReviewGuidance({ ...row, status: 'unknown' }, { tagCount: 0 })).toContain(
      'Previously reviewed',
    );
    expect(walletReviewGuidance({ ...row, status: 'later' }, { tagCount: 0 })).toContain(
      'Set aside',
    );
    expect(walletReviewGuidance({ ...row, changed: true }, { tagCount: 0 })).toContain(
      'details changed',
    );
  });
});
