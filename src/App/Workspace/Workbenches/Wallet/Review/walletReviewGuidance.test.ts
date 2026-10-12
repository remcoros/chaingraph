import { describe, expect, it } from 'vitest';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { deriveAddresses } from '../../../../../Core/Workspace/Wallets/walletDerivation';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';

import {
  applyReviewDecisions,
  buildWalletReview,
  reviewKey,
} from '../../../../../Core/Workspace/Wallets/walletReview';
import { walletReviewCategories } from './reviewCategories';
import { matchesWalletStatus, reviewRow } from '../walletRows';
import { walletSubjectTitle } from './walletReviewGuidance';
import {
  PUBLIC_ZPUB,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
} from '../../../../../../tests/fixtures/bitcoin';

function fixture() {
  const workspace = createWorkspace('Public review guidance', 'mainnet');
  const addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 3);
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Everyday wallet',
    key: PUBLIC_ZPUB,
    color: '#27c4a7',
    scriptType: 'p2wpkh',
    addresses,
  };
  workspace.wallets.definitions = [wallet];
  workspace.chainData.transactions = structuredClone(transactions);
  const sender = bitcoinAddress.toBech32(new Uint8Array(20).fill(17), 0, 'bc');
  workspace.chainData.transactions[TX_FUNDING].vin = [
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
  it('uses activity and coin intentions without mandatory receive/change address tasks', () => {
    const { workspace, wallet, options } = fixture();
    const initial = buildWalletReview(workspace, wallet, options);
    expect(initial.items.some((item) => item.reason === 'wallet-address')).toBe(false);
    const activity = initial.items.find((item) => item.goal === 'activity-context')!;
    const coin = initial.items.find((item) => item.goal === 'coin-context')!;
    expect(activity).toBeDefined();
    expect(coin).toBeDefined();
    const deferred = applyReviewDecisions(workspace, wallet, [activity], 'later');
    deferred.annotations.entities[activity.nodeId] = {
      label: 'Public receipt',
      note: '',
      icon: '',
      bookmarked: false,
    };
    const next = buildWalletReview(deferred, wallet, options);
    expect(next.items.find((item) => item.key === activity.key)).toMatchObject({
      status: 'resolved',
      satisfied: true,
      changed: false,
    });
    expect(deferred.wallets.reviews?.[activity.key].status).toBe('later');
    expect(Object.keys(deferred.wallets.reviews!)).toEqual([activity.key]);
  });

  it('asks about receipt and payment relationships without legacy acknowledgments or field-completeness obligations', () => {
    const { workspace, wallet, options } = fixture();
    const review = buildWalletReview(workspace, wallet, options);
    const parties = review.items.filter((item) => item.goal === 'counterparty-context');
    expect(parties.map((item) => item.reason).sort()).toEqual([
      'destination-address',
      'source-address',
    ]);
    expect(parties.every((item) => item.nodeId.startsWith('tx:'))).toBe(true);
    expect(parties.find((item) => item.reason === 'source-address')?.title).toBe('Who sent this?');
    expect(parties.find((item) => item.reason === 'destination-address')?.title).toBe(
      'Who received this?',
    );
    expect(
      parties.every((item) =>
        item.detail.includes('does not identify every input or output address'),
      ),
    ).toBe(true);
    const categories = walletReviewCategories(workspace, review.items);
    expect(
      categories.some((item) =>
        [
          'counterparty',
          'funding-source',
          'wallet-address',
          'utxo-missing-tags',
          'utxo-missing-label',
        ].includes(item.id),
      ),
    ).toBe(false);
  });

  it('retains saved output decisions in read-only history without copying them into active relationships', () => {
    const { workspace, wallet, options } = fixture();
    const key = reviewKey(wallet.id, 'counterparty', `${TX_SPENDING}:1`);
    workspace.wallets.reviews = {
      [key]: { status: 'unknown', at: '2026-09-09T10:00:00Z', evidence: 'old' },
    };
    const review = buildWalletReview(workspace, wallet, options);
    expect(review.items.some((item) => item.key === key)).toBe(false);
    expect(review.legacyDecisions).toContainEqual({
      key,
      status: 'unknown',
      at: '2026-09-09T10:00:00Z',
      evidence: 'old',
    });
    expect(review.items.find((item) => item.reason === 'destination-address')).toMatchObject({
      status: 'open',
      satisfied: false,
    });
    expect(
      walletReviewCategories(workspace, []).some(
        (category) => category.id === 'saved-output-reviews',
      ),
    ).toBe(false);
    expect(workspace.wallets.reviews[key].evidence).toBe('old');
  });

  it('describes the task without requiring blanket acknowledgment of human context', () => {
    const { workspace, wallet, options } = fixture();
    const items = buildWalletReview(workspace, wallet, options).items;
    const activity = items.find((item) => item.goal === 'activity-context')!;
    const coin = items.find((item) => item.goal === 'coin-context')!;
    expect(activity.detail).toContain('label, note or tag');
    expect(activity.detail).not.toContain('counterparty');
    expect(activity.detail).not.toContain('Mark reviewed');
    expect(coin.detail).toContain('Where this coin came from');
    const party = items.find((item) => item.reason === 'source-address')!;
    expect(walletSubjectTitle(reviewRow(party))).toBe('Transaction');
    expect(party.detail).toContain('cannot identify it or need no annotation');
    expect(party.detail).not.toContain('has no label or tags');
  });

  it('keeps completed, unknown and deferred outcomes distinct from changed finding evidence', () => {
    const { workspace, wallet, options } = fixture();
    const item = buildWalletReview(workspace, wallet, options).items.find(
      (item) => item.goal === 'activity-context',
    )!;
    const unknown = applyReviewDecisions(workspace, wallet, [item], 'cannot-identify');
    const projection = buildWalletReview(unknown, wallet, options).items.find(
      (entry) => entry.key === item.key,
    )!;
    const row = reviewRow(projection);
    expect(matchesWalletStatus(row, 'decided')).toBe(true);
    expect(matchesWalletStatus(row, 'open')).toBe(false);
    expect(projection.satisfied).toBe(false);
    const later = reviewRow({ ...projection, status: 'later' });
    expect(matchesWalletStatus(later, 'later')).toBe(true);
    const finding = reviewRow({
      ...projection,
      kind: 'finding',
      reason: 'link',
      status: 'reviewed',
      changed: true,
    });
    expect(matchesWalletStatus(finding, 'open')).toBe(true);
  });
});
