import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  applyReviewDecisions,
  buildWalletReview,
  isCompletedReview,
  pruneWalletReviews,
  reviewKey,
  spendGuidance,
  type WalletReviewItem,
} from '../../../src/Core/Workspace/Wallets/walletReview';
import { MAX_WALLET_REVIEWS, type Wallet } from '../../../src/Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../src/Core/Workspace/workspace';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import type { Transaction } from '../../../src/Core/ChainData';

import { addressToScriptHash } from '../../../src/Core/Bitcoin';
import type { WalletUtxoRecord } from '../../../src/Core/Workspace/Wallets/walletRecords';
import {
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
} from '../../../src/Core/Workspace/Annotations/batchMetadata';
import { walletReviewCategories } from '../../../src/App/Workspace/Workbenches/Wallet/Review/reviewCategories';
import { groupWalletRelationships } from '../../../src/Core/Workspace/Wallets/walletRelationships';

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
  status: { kind: 'confirmed' as const, blockHeight: 800000 },
};
const spend: Transaction = {
  txid: id(2),
  vin: [{ txid: id(1), vout: 0 }],
  vout: [
    { n: 0, value: 0.6, scriptPubKey: { hex: script(MINE_B) } },
    { n: 1, value: 0.39, scriptPubKey: { hex: script(THEIRS) } },
  ],
  status: { kind: 'confirmed' as const, blockHeight: 800001 },
};
const utxo: WalletUtxoRecord = {
  txid: id(2),
  vout: 0,
  valueSats: 60_000_000,
  height: 800001,
  address: MINE_B,
  scripthash: addressToScriptHash(MINE_B, 'mainnet'),
};

function fixture(
  overrides: Omit<Partial<Workspace>, 'chainData' | 'wallets'> & {
    chainData?: Partial<Workspace['chainData']>;
    wallets?: Partial<Workspace['wallets']>;
  } = {},
): Workspace {
  const base = createWorkspace('Review fixture', 'mainnet');
  return {
    ...base,
    ...overrides,
    wallets: { ...base.wallets, definitions: [wallet], ...overrides.wallets },
    chainData: {
      ...base.chainData,
      transactions: { [receipt.txid]: receipt, [spend.txid]: spend },
      ...overrides.chainData,
    },
  };
}
const build = (workspace: Workspace, utxos: WalletUtxoRecord[] = [utxo]) =>
  buildWalletReview(workspace, workspace.wallets.definitions[0], {
    utxos,
    utxoCheckedAt: '2026-09-09T00:00:00.000Z',
    utxoCheckedAddresses: 2,
    utxoTotalAddresses: 2,
  });
const find = (items: WalletReviewItem[], reason: string) =>
  items.filter((item) => item.reason === reason);
const destination = (items: WalletReviewItem[], address = THEIRS) =>
  find(items, 'destination-address').find((item) => item.address === address)!;

describe('wallet review queue', () => {
  it('drops only current-UTXO recommendations with loaded spenders while retaining the dated record and review decision', () => {
    const original = fixture();
    const item = find(build(original).items, 'current-utxo')[0];
    const reviewed = applyReviewDecisions(original, wallet, [item], 'reviewed');
    reviewed.chainData.addressUtxos = {
      [MINE_B]: {
        network: 'mainnet',
        checkedAt: '2026-09-09T00:00:00.000Z',
        utxos: [
          { txid: utxo.txid, vout: utxo.vout, valueSats: utxo.valueSats, height: utxo.height },
        ],
      },
    };
    const later = {
      ...reviewed,
      chainData: {
        ...reviewed.chainData,
        transactions: {
          ...reviewed.chainData.transactions,
          [id(3)]: { txid: id(3), vin: [{ txid: utxo.txid, vout: utxo.vout }], vout: [] },
        },
      },
    };
    const result = build(later);
    expect(find(result.items, 'current-utxo')).toEqual([]);
    expect(result.coverage).toMatchObject({
      utxoCount: 0,
      utxoLoadedSpenders: 1,
      utxoCheckedAt: '2026-09-09T00:00:00.000Z',
    });
    expect(later.wallets.reviews?.[item.key]).toEqual(reviewed.wallets.reviews?.[item.key]);
    expect(later.chainData.addressUtxos).toBe(reviewed.chainData.addressUtxos);
    const rechecked = buildWalletReview(reviewed, wallet, {
      utxos: [utxo],
      utxoCheckedAt: '2026-09-17T00:00:00.000Z',
    });
    expect(find(rechecked.items, 'current-utxo')[0]).toMatchObject({
      status: 'reviewed',
      changed: false,
    });
    expect(rechecked.coverage.utxoCheckedAt).toBe('2026-09-17T00:00:00.000Z');
  });
  it('preserves golden current UTXO, earlier-receipt and counterparty fingerprints', () => {
    const key = reviewKey(wallet.id, 'counterparty', `${id(2)}:1`);
    const items = build(
      fixture({
        wallets: {
          reviews: {
            [key]: {
              status: 'unknown',
              at: '2026-09-09T00:00:00.000Z',
              evidence: 'd1b509083c3c21da',
            },
          },
        },
      }),
    ).items;
    expect(find(items, 'current-utxo')[0].evidence).toBe('a9e1087be63746be');
    expect(find(items, 'source')[0].evidence).toBe('1d8ef8abec682cb1');
    expect(find(items, 'counterparty')[0].evidence).toBe('d1b509083c3c21da');
    expect(find(items, 'funding-source')).toEqual([]);
    expect(find(items, 'source')[0].relationshipKinds).toContain('source');
  });

  it('makes direct incoming funding inputs reviewable without calling them earlier wallet receipts', () => {
    const predecessor: Transaction = {
      txid: id(8),
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 3, scriptPubKey: { hex: script(THEIRS) } }],
    };
    const receiving = {
      ...receipt,
      vin: [
        { txid: id(8), vout: 0 },
        { txid: id(9), vout: 2 },
      ],
    };
    const workspace = fixture({
      chainData: { transactions: { [id(8)]: predecessor, [id(1)]: receiving, [id(2)]: spend } },
    });
    const items = build(workspace).items;
    const funding = [
      find(items, 'source-address').find((item) => item.address === THEIRS)!,
      ...find(items, 'funding-source'),
    ];
    expect(funding).toHaveLength(1);
    expect(funding[0]).toMatchObject({
      key: reviewKey(wallet.id, 'source-address', `addr:${THEIRS}`),
      nodeId: `addr:${THEIRS}`,
      nodeIds: [`addr:${THEIRS}`],
      outpointIds: [`out:${id(8)}:0`],
      amountSats: 300_000_000,
      transactionIds: [id(1)],
      walletOutputIds: [`out:${id(1)}:0`],
      relationshipKinds: ['source'],
      status: 'open',
    });
    expect(funding[0].detail).toContain('not a flow allocation');
    expect(find(items, 'funding-source')).toEqual([]);
    expect(groupWalletRelationships(workspace, wallet).sourceExceptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `out:${id(9)}:2`, amountSats: undefined }),
      ]),
    );
    expect(find(items, 'source')).toHaveLength(1);
    const reviewed = applyReviewDecisions(workspace, wallet, funding, 'unknown');
    reviewed.annotations.entities[funding[0].nodeId] = {
      label: 'Recorded context',
      note: '',
      icon: '',
      bookmarked: false,
    };
    for (const entry of find(build(reviewed).items, 'source-address').filter(
      (item) => item.address === THEIRS,
    )) {
      expect(entry.status).toBe('unknown');
      expect(entry.changed).toBe(false);
    }
    expect(build(reviewed).items.find((entry) => entry.key === funding[0].key)).toMatchObject({
      status: 'unknown',
      changed: false,
    });
    const labelledOnly = {
      ...workspace,
      annotations: { ...workspace.annotations, entities: reviewed.annotations.entities },
    };
    expect(
      find(build(labelledOnly).items, 'source-address').find((item) => item.address === THEIRS)
        ?.status,
    ).toBe('open');
  });

  it('reopens an existing missing-output decision when the actual previous-output evidence loads', () => {
    const receiving = { ...receipt, vin: [{ txid: id(9), vout: 0 }] };
    const workspace = fixture({ chainData: { transactions: { [id(1)]: receiving } } });
    workspace.wallets.reviews = {
      [reviewKey(wallet.id, 'funding-source', `${id(9)}:0`)]: {
        status: 'reviewed',
        at: '2026-09-09T00:00:00Z',
        evidence: 'previously-saved',
      },
    };
    const item = find(build(workspace, []).items, 'funding-source')[0];
    const decided = applyReviewDecisions(workspace, wallet, [item], 'reviewed');
    decided.chainData.transactions = {
      ...decided.chainData.transactions,
      [id(9)]: {
        txid: id(9),
        vin: [{ coinbase: '00' }],
        vout: [{ n: 0, value: 1, scriptPubKey: { hex: script(THEIRS) } }],
      },
    };
    const next = find(build(decided, []).items, 'funding-source')[0];
    expect(next.key).toBe(item.key);
    expect(next.changed).toBe(true);
    expect(next.decidedAt).toBeDefined();
  });

  it('does not mix a different wallet UTXO observation into this wallet review', () => {
    const foreign = {
      ...utxo,
      txid: id(8),
      address: THEIRS,
      scripthash: addressToScriptHash(THEIRS, 'mainnet'),
    };
    expect(find(build(fixture(), [foreign]).items, 'current-utxo')).toEqual([]);
    expect(build(fixture(), [foreign]).coverage.utxoCount).toBe(0);
  });

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
    const counterparties = find(review.items, 'destination-address');
    expect(counterparties.map((item) => item.nodeId).sort()).toEqual([`addr:${THEIRS}`]);
    expect(destination(review.items).outpointIds).toEqual([`out:${id(2)}:1`]);
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
        chainData: {
          transactions: { [receipt.txid]: receipt, [spend.txid]: spend, [batch.txid]: batch },
        },
      }),
    );
    expect(destination(withBatch.items).outpointIds).toEqual([`out:${id(2)}:1`]);
  });

  it('decodes source and counterparty addresses from raw scripts without changing review evidence', () => {
    const workspace = fixture();
    const original = build(workspace);
    const source = find(original.items, 'source')[0];
    const counterparty = destination(original.items);
    expect(source.address).toBe(MINE_A);
    expect(counterparty.address).toBe(THEIRS);
    const decided = applyReviewDecisions(workspace, wallet, [source, counterparty], 'reviewed');
    // Imported display claims must not alter script-derived address identity.
    decided.chainData.transactions = structuredClone(decided.chainData.transactions);
    decided.chainData.transactions[id(1)].vout[0].scriptPubKey.address = THEIRS;
    decided.chainData.transactions[id(2)].vout[1].scriptPubKey.address = MINE_A;
    const rebuilt = build(decided);
    for (const before of [source, counterparty]) {
      const after = rebuilt.items.find((item) => item.key === before.key)!;
      expect(after.address).toBe(before.address);
      expect(after.evidence).toBe(before.evidence);
      expect(after.status).toBe('reviewed');
      expect(after.changed).toBe(false);
    }
  });

  it('decodes network-neutral raw scripts into testnet4 review addresses', () => {
    const testAddress = (fill: number) =>
      bitcoinAddress.toBech32(new Uint8Array(20).fill(fill), 0, 'tb');
    const testWallet = {
      ...wallet,
      addresses: wallet.addresses.map((entry, index) => ({
        ...entry,
        address: testAddress(index + 1),
        scripthash: addressToScriptHash(testAddress(index + 1), 'testnet4'),
      })),
    };
    const workspace = fixture({ network: 'testnet4', wallets: { definitions: [testWallet] } });
    const review = build(workspace, [{ ...utxo, address: testAddress(2) }]);
    expect(find(review.items, 'source')[0].address).toBe(testAddress(1));
    expect(destination(review.items, testAddress(9)).address).toBe(testAddress(9));
  });

  it.each(['broken', '6a00'])(
    'does not fall back from raw script %s to a claimed counterparty address',
    (hex) => {
      const workspace = fixture();
      workspace.chainData.transactions = structuredClone(workspace.chainData.transactions);
      workspace.chainData.transactions[id(2)].vout[1].scriptPubKey = { hex, address: THEIRS };
      workspace.wallets.reviews = {
        [reviewKey(wallet.id, 'counterparty', `${id(2)}:1`)]: {
          status: 'unknown',
          at: '2026-09-09T00:00:00Z',
          evidence: 'previously-saved',
        },
      };
      expect(find(build(workspace).items, 'counterparty')[0].address).toBeUndefined();
      expect(find(build(workspace).items, 'destination-address')).toEqual([]);
    },
  );

  it('uses a validated address-only fallback and rejects a different network', () => {
    const workspace = fixture();
    workspace.chainData.transactions = structuredClone(workspace.chainData.transactions);
    workspace.chainData.transactions[id(1)].vout[0].scriptPubKey = { addresses: [MINE_A] };
    workspace.chainData.transactions[id(2)].vout[1].scriptPubKey = { address: THEIRS };
    expect(find(build(workspace).items, 'source')[0].address).toBe(MINE_A);
    expect(destination(build(workspace).items).address).toBe(THEIRS);
    workspace.chainData.transactions[id(2)].vout[1].scriptPubKey = {
      address: bitcoinAddress.toBech32(new Uint8Array(20).fill(9), 0, 'tb'),
    };
    workspace.wallets.reviews = {
      [reviewKey(wallet.id, 'counterparty', `${id(2)}:1`)]: {
        status: 'unknown',
        at: '2026-09-09T00:00:00Z',
        evidence: 'previously-saved',
      },
    };
    expect(find(build(workspace).items, 'counterparty')[0].address).toBeUndefined();
    expect(find(build(workspace).items, 'destination-address')).toEqual([]);
  });

  it('reports unloaded UTXO sources instead of inventing them', () => {
    const review = buildWalletReview(fixture({ chainData: { transactions: {} } }), wallet, {
      utxos: [utxo],
    });
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
    // Address reviews still come from loaded observations, without a UTXO check.
    expect(find(review.items, 'destination-address')).toHaveLength(1);
  });

  it('projects active findings by explicit factual subjects and keeps one linked decision', () => {
    const finding = {
      id: 'cioh:aa',
      algorithm: 'cioh-v2',
      title: 'Tentative input group 1',
      description: 'Co-spent outputs',
      nodeIds: [`out:${id(1)}:0`],
      txids: [id(2)],
      subjects: [`out:${id(1)}:0`, `tx:${id(2)}`, `addr:${MINE_A}`, `addr:${THEIRS}`],
      createdAt: '2026-09-08T10:00:00.000Z',
      kind: 'hypothesis' as const,
    };
    const projected = find(build(fixture({ analysis: { findings: [finding] } })).items, 'link');
    expect(projected.map((item) => item.scope)).toEqual([
      'utxos',
      'transactions',
      'addresses',
      'relationships',
    ]);
    expect(new Set(projected.map((item) => item.key))).toEqual(
      new Set([reviewKey(wallet.id, 'link', finding.id)]),
    );
    expect(projected.find((item) => item.scope === 'relationships')?.subjectIds).toEqual([
      `addr:${THEIRS}`,
    ]);
    const decided = applyReviewDecisions(
      fixture({ analysis: { findings: [finding] } }),
      wallet,
      projected,
      'reviewed',
    );
    expect(Object.keys(decided.wallets.reviews ?? {})).toEqual([projected[0].key]);
    const many = fixture({
      analysis: {
        findings: Array.from({ length: 45 }, (_, index) => ({
          ...finding,
          id: `cioh:${index}`,
          subjects: [`out:${id(1)}:0`],
        })),
      },
    });
    const manyItems = build(many).items;
    expect(find(manyItems, 'link')).toHaveLength(45);
    expect(
      walletReviewCategories(many, manyItems).find((category) => category.id === 'heuristic:cioh')
        ?.count,
    ).toBe(45);
    expect(
      find(build(fixture({ analysis: { findings: [{ ...finding, stale: true }] } })).items, 'link'),
    ).toHaveLength(0);
    expect(
      find(
        build(fixture({ analysis: { findings: [{ ...finding, excluded: true }] } })).items,
        'link',
      ),
    ).toHaveLength(0);
    expect(
      find(
        build(fixture({ analysis: { findings: [{ ...finding, subjects: undefined }] } })).items,
        'link',
      ),
    ).toHaveLength(0);
    expect(
      find(
        build(fixture({ analysis: { findings: [{ ...finding, subjects: [`tx:${id(7)}`] }] } }))
          .items,
        'link',
      ),
    ).toHaveLength(0);
  });
});

describe('address-level relationship reviews', () => {
  it('excludes wallet-matched address reviews without changing their stored decisions or old output reviews', () => {
    const workspace = fixture({
      wallets: {
        reviews: {
          [reviewKey(wallet.id, 'source-address', `addr:${MINE_A}`)]: {
            status: 'unknown',
            at: '2026-09-09T00:00:00.000Z',
            evidence: 'saved-address-review',
          },
          [reviewKey(wallet.id, 'destination-address', `addr:${MINE_B}`)]: {
            status: 'later',
            at: '2026-09-09T00:00:00.000Z',
            evidence: 'saved-own-destination',
          },
        },
      },
    });
    const before = structuredClone(workspace.wallets.reviews);
    const items = build(workspace).items;
    expect(find(items, 'source-address')).toEqual([]);
    expect(find(items, 'destination-address').map((item) => item.address)).toEqual([THEIRS]);
    expect(find(items, 'source')).toHaveLength(1);
    expect(find(items, 'current-utxo')).toHaveLength(1);
    expect(destination(items).status).toBe('open');
    expect(workspace.wallets.reviews).toEqual(before);
    expect(
      walletReviewCategories(workspace, items).find((entry) => entry.id === 'unidentified-sources')
        ?.count,
    ).toBe(0);
  });

  const addressFixture = () =>
    fixture({
      chainData: {
        transactions: {
          [id(8)]: {
            txid: id(8),
            vin: [{ coinbase: '00' }],
            vout: [
              { n: 0, value: 3, scriptPubKey: { hex: script(THEIRS) } },
              { n: 1, value: 2, scriptPubKey: { hex: script(THEIRS) } },
            ],
          },
          [id(1)]: {
            ...receipt,
            vin: [
              { txid: id(8), vout: 0 },
              { txid: id(8), vout: 1 },
            ],
          },
          [id(2)]: spend,
        },
      },
    });
  const sourceAddress = (workspace: Workspace) =>
    find(build(workspace).items, 'source-address').find((item) => item.address === THEIRS)!;

  it('uses one address edit/review target for multiple direct outputs, with direction-specific keys', () => {
    const workspace = addressFixture();
    const item = sourceAddress(workspace);
    expect(item).toMatchObject({
      key: reviewKey(wallet.id, 'source-address', `addr:${THEIRS}`),
      nodeId: `addr:${THEIRS}`,
      nodeIds: [`addr:${THEIRS}`],
      outpointIds: [`out:${id(8)}:0`, `out:${id(8)}:1`],
      amountSats: 500_000_000,
      transactionIds: [id(1)],
      status: 'open',
    });
    expect(item.txid).toBeUndefined();
    expect(find(build(workspace).items, 'funding-source')).toEqual([]);
    expect(find(build(workspace).items, 'counterparty')).toEqual([]);
    const outgoing = destination(build(workspace).items);
    expect(outgoing.nodeId).toBe(item.nodeId);
    expect(outgoing.key).not.toBe(item.key);
    const decided = applyReviewDecisions(workspace, wallet, [item], 'reviewed');
    expect(sourceAddress(decided)).toMatchObject({ status: 'reviewed', changed: false });
    expect(destination(build(decided).items).status).toBe('open');
    const anotherWallet = { ...wallet, id: '20000000-0000-4000-8000-000000000099' };
    expect(
      find(buildWalletReview(decided, anotherWallet).items, 'source-address').find(
        (entry) => entry.address === THEIRS,
      ),
    ).toMatchObject({ status: 'open', changed: false });
  });

  it('decorates and edits only address metadata without completing a review or changing evidence', () => {
    const workspace = addressFixture();
    const outputId = `out:${id(8)}:0`;
    workspace.annotations.entities[outputId] = {
      label: 'Only this output',
      note: '',
      icon: 'coin',
      bookmarked: false,
    };
    workspace.annotations.tags = [
      { id: 'fixture-tag', name: 'Context', color: '#27c4a7', nodeIds: [outputId] },
    ];
    const item = sourceAddress(workspace);
    expect(item.label).toBe('');
    expect(item.tags).toEqual([]);
    const labelled = applyBatchLabel(workspace, item.nodeIds, 'Address context');
    const icon = applyBatchIcon(labelled, item.nodeIds, 'gift');
    const tagged = applyBatchTag(icon, item.nodeIds, 'fixture-tag', true);
    expect(tagged.annotations.entities[outputId]).toEqual(workspace.annotations.entities[outputId]);
    expect(Object.keys(tagged.annotations.entities).sort()).toEqual([outputId, item.nodeId].sort());
    expect(tagged.annotations.entities[item.nodeId]).toMatchObject({
      label: 'Address context',
      icon: 'gift',
    });
    expect(tagged.annotations.tags![0].nodeIds).toEqual([outputId, item.nodeId]);
    expect(sourceAddress(tagged)).toMatchObject({
      label: 'Address context',
      tags: ['Context'],
      status: 'open',
      changed: false,
      evidence: item.evidence,
    });
    expect(tagged.wallets.reviews).toBeUndefined();
  });

  it.each(['unknown', 'reviewed', 'later'] as const)(
    'retains a legacy %s funding-output decision without applying it to other address constituents',
    (status) => {
      const workspace = addressFixture();
      const key = reviewKey(wallet.id, 'funding-source', `${id(8)}:0`);
      workspace.wallets.reviews = {
        [key]: { status, at: '2026-09-09T00:00:00.000Z', evidence: 'fixture-before-refresh' },
      };
      const oldOutput = find(build(workspace).items, 'funding-source')[0];
      const saved = applyReviewDecisions(
        workspace,
        wallet,
        [oldOutput],
        status,
        '2026-09-09T00:00:00.000Z',
      );
      const records = structuredClone(saved.wallets.reviews);
      const items = build(saved).items;
      expect(find(items, 'funding-source')[0]).toMatchObject({
        key,
        status,
        changed: false,
        legacyOutputReview: true,
        nodeId: `out:${id(8)}:0`,
      });
      expect(sourceAddress(saved)).toMatchObject({ status: 'open', changed: false });
      expect(sourceAddress(saved).outpointIds).toHaveLength(2);
      expect(saved.wallets.reviews).toEqual(records);
      const counts = walletReviewCategories(saved, items);
      expect(counts.find((entry) => entry.id === 'unidentified-sources')?.count).toBe(
        find(items, 'source-address').length,
      );
    },
  );

  it('preserves a golden unknown destination-output decision without completing its larger address group', () => {
    const key = reviewKey(wallet.id, 'counterparty', `${id(2)}:1`);
    const decision = {
      status: 'unknown' as const,
      at: '2026-09-09T00:00:00.000Z',
      evidence: 'd1b509083c3c21da',
    };
    const workspace = fixture({ wallets: { reviews: { [key]: decision } } });
    workspace.chainData.transactions[id(2)] = {
      ...spend,
      vout: [...spend.vout, { n: 2, value: 0.1, scriptPubKey: { hex: script(THEIRS) } }],
    };
    const items = build(workspace).items;
    expect(find(items, 'counterparty')[0]).toMatchObject({
      status: 'unknown',
      changed: false,
      legacyOutputReview: true,
      evidence: decision.evidence,
    });
    expect(destination(items)).toMatchObject({
      status: 'open',
      outpointIds: [`out:${id(2)}:1`, `out:${id(2)}:2`],
    });
    expect(workspace.wallets.reviews).toEqual({ [key]: decision });
    expect(
      walletReviewCategories(workspace, items).find(
        (entry) => entry.id === 'unidentified-destinations',
      )?.count,
    ).toBe(1);
    expect(items.find((entry) => entry.key === key)).toMatchObject({
      status: 'unknown',
      changed: false,
    });
  });

  it.each(['outpoint', 'context'] as const)(
    'reopens an address review when a new %s observation joins its group',
    (change) => {
      const workspace = addressFixture();
      const first = sourceAddress(workspace);
      const decided = applyReviewDecisions(workspace, wallet, [first], 'unknown');
      const reordered = {
        ...decided,
        chainData: {
          ...decided.chainData,
          transactions: Object.fromEntries(
            Object.entries(decided.chainData.transactions).reverse(),
          ),
        },
      };
      expect(sourceAddress(reordered).evidence).toBe(first.evidence);
      const refreshed = {
        ...decided,
        chainData: {
          ...decided.chainData,
          transactions: structuredClone(decided.chainData.transactions),
        },
      };
      if (change === 'outpoint') {
        refreshed.chainData.transactions[id(8)].vout.push({
          n: 2,
          value: 1,
          scriptPubKey: { hex: script(THEIRS) },
        });
        refreshed.chainData.transactions[id(1)].vin.push({ txid: id(8), vout: 2 });
      } else {
        refreshed.chainData.transactions[id(4)] = {
          ...receipt,
          txid: id(4),
          vin: [{ txid: id(8), vout: 0 }],
        };
      }
      const next = sourceAddress(refreshed);
      expect(next.key).toBe(first.key);
      expect(next.evidence).not.toBe(first.evidence);
      expect(next).toMatchObject({
        status: 'unknown',
        changed: true,
        decidedAt: decided.wallets.reviews![first.key].at,
      });
    },
  );

  it('changes only the address decision key, without changing transaction or output reviews', () => {
    const workspace = addressFixture();
    const items = build(workspace).items;
    const prior = applyReviewDecisions(
      workspace,
      workspace.wallets.definitions[0],
      [find(items, 'current-utxo')[0], find(items, 'wallet-transaction')[0]],
      'later',
    );
    const item = sourceAddress(prior);
    const decided = applyReviewDecisions(prior, prior.wallets.definitions[0], [item], 'reviewed');
    expect(decided.wallets.definitions).toBe(prior.wallets.definitions);
    for (const [key, decision] of Object.entries(prior.wallets.reviews!))
      expect(decided.wallets.reviews![key]).toEqual(decision);
    expect(
      Object.keys(decided.wallets.reviews!).filter((key) => !prior.wallets.reviews![key]),
    ).toEqual([item.key]);
  });

  it('rejects any new decision at the limit rather than pruning older decisions', () => {
    const workspace = addressFixture();
    const item = find(build(workspace).items, 'wallet-transaction')[0];
    workspace.wallets.reviews = Object.fromEntries(
      Array.from({ length: MAX_WALLET_REVIEWS }, (_, index) => [
        reviewKey(wallet.id, 'source', `${id(index)}:0`),
        { status: 'unknown', at: '2026-09-09T00:00:00.000Z', evidence: 'saved' },
      ]),
    );
    expect(() => applyReviewDecisions(workspace, wallet, [item], 'reviewed')).toThrow('20,000');
    expect(Object.keys(workspace.wallets.reviews)).toHaveLength(MAX_WALLET_REVIEWS);
    expect(workspace.wallets.reviews[item.key]).toBeUndefined();
  });
});

describe('review decisions', () => {
  it.each(['open', 'later', 'reviewed', 'unknown'] as const)(
    'keeps source and counterparty items %s when labels and tags change',
    (status) => {
      const workspace = fixture();
      const items = build(workspace).items;
      const candidates = [find(items, 'source')[0], destination(items)];
      expect(candidates).toHaveLength(2);
      const decided =
        status === 'open' ? workspace : applyReviewDecisions(workspace, wallet, candidates, status);
      const labelled: Workspace = {
        ...decided,
        annotations: {
          ...decided.annotations,
          entities: Object.fromEntries(
            candidates.map((item) => [
              item.nodeId,
              { label: `Recorded ${item.reason}`, note: '', icon: '', bookmarked: false },
            ]),
          ),
        },
      };
      // Labels alone previously removed both kinds of candidate.
      const afterLabels = build(labelled).items;
      for (const item of candidates) {
        expect(afterLabels.find((entry) => entry.key === item.key)).toMatchObject({
          evidence: item.evidence,
          status,
          changed: false,
          decidedAt: decided.wallets.reviews?.[item.key]?.at,
          label: `Recorded ${item.reason}`,
          tags: [],
        });
      }
      // Removing the labels and adding a tag must update the display metadata
      // without losing the item, changing its evidence or resolving pending work.
      const tagged: Workspace = {
        ...labelled,
        annotations: {
          ...labelled.annotations,
          entities: {},
          tags: [
            {
              id: '30000000-0000-4000-8000-000000000001',
              name: 'Recorded context',
              color: '#27c4a7',
              nodeIds: candidates.map((item) => item.nodeId),
            },
          ],
        },
      };
      const afterTags = build(tagged).items;
      for (const item of candidates) {
        const rebuilt = afterTags.find((entry) => entry.key === item.key);
        expect(rebuilt).toMatchObject({
          evidence: item.evidence,
          status,
          changed: false,
          decidedAt: decided.wallets.reviews?.[item.key]?.at,
          label: '',
          tags: ['Recorded context'],
        });
        expect(
          rebuilt?.status === 'open' || rebuilt?.status === 'later' || rebuilt?.changed === true,
        ).toBe(status === 'open' || status === 'later');
        expect(rebuilt?.title).not.toMatch(/unlabeled|unknown/i);
      }
      expect(tagged.wallets.reviews).toBe(decided.wallets.reviews);
    },
  );

  it('records one undoable update and keeps decisions across a rebuild', () => {
    const workspace = fixture();
    const review = build(workspace);
    const decided = applyReviewDecisions(workspace, wallet, review.items.slice(0, 2), 'reviewed');
    expect(Object.keys(decided.wallets.reviews ?? {})).toHaveLength(2);
    const again = build(decided);
    expect(again.items[0].status).toBe('reviewed');
    expect(again.items[0].changed).toBe(false);
    expect(again.items.filter((item) => item.status === 'open').length).toBeGreaterThan(0);
  });

  it('treats an unknown source as a completed review, not a failure', () => {
    const workspace = fixture();
    const item = build(workspace).items[0];
    const decided = applyReviewDecisions(workspace, wallet, [item], 'unknown');
    expect(decided.wallets.reviews?.[item.key].status).toBe('unknown');
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
      chainData: {
        ...decided.chainData,
        transactions: { ...decided.chainData.transactions, [extraSpend.txid]: extraSpend },
      },
    };
    const rebuilt = buildWalletReview(refreshed, wallet, {
      utxos: [utxo, { ...utxo, txid: id(4), vout: 0, valueSats: 20_000_000 }],
    });
    const changed = find(rebuilt.items, 'source')[0];
    expect(changed.status).toBe('reviewed');
    expect(changed.changed).toBe(true);
    // Reopening drops the decision entirely.
    const reopened = applyReviewDecisions(refreshed, wallet, [changed], 'reopen');
    expect(reopened.wallets.reviews?.[changed.key]).toBeUndefined();
  });

  it('keeps transaction decisions independent and leaves wallet facts unchanged', () => {
    const workspace = fixture();
    const transactions = find(build(workspace).items, 'wallet-transaction');
    expect(transactions).toHaveLength(2);
    const [first, second] = transactions;
    const decided = applyReviewDecisions(workspace, wallet, [first], 'reviewed');
    const rebuilt = build(decided);
    expect(rebuilt.items.find((item) => item.key === first.key)?.status).toBe('reviewed');
    expect(rebuilt.items.find((item) => item.key === second.key)?.status).toBe('open');
    const completed = applyReviewDecisions(decided, wallet, [second], 'reviewed');
    expect(completed.wallets.definitions).toBe(workspace.wallets.definitions);
    expect(completed.wallets.reviews?.[first.key].status).toBe('reviewed');
    expect(completed.wallets.reviews?.[second.key].status).toBe('reviewed');
  });

  it('derives transaction review from wallet facts and requeues when details are loaded', () => {
    const txid = id(3);
    const workspace = fixture();
    const factualWallet: Wallet = {
      ...wallet,
      addresses: wallet.addresses.map((address, index) =>
        index === 0
          ? {
              ...address,
              history: [...(address.history ?? []), { tx_hash: txid, height: 800002 }],
            }
          : address,
      ),
    };
    workspace.wallets.definitions = [factualWallet];
    const unloaded = find(
      buildWalletReview(workspace, factualWallet).items,
      'wallet-transaction',
    ).find((item) => item.txid === txid)!;
    expect(unloaded.detail).toContain('not loaded');
    const reviewed = applyReviewDecisions(workspace, factualWallet, [unloaded], 'reviewed');
    const loaded: Workspace = {
      ...reviewed,
      chainData: {
        ...reviewed.chainData,
        transactions: {
          ...reviewed.chainData.transactions,
          [txid]: { ...receipt, txid },
        },
      },
    };
    const enriched = find(
      buildWalletReview(loaded, factualWallet).items,
      'wallet-transaction',
    ).find((item) => item.txid === txid)!;
    expect(enriched).toMatchObject({ status: 'reviewed', changed: true });
    expect(enriched.evidence).not.toBe(unloaded.evidence);
  });

  it('keeps decisions scoped to their wallet and prunes removed wallets', () => {
    const workspace = fixture();
    const item = build(workspace).items[0];
    expect(item.key.startsWith(`${wallet.id}|`)).toBe(true);
    const other: Wallet = { ...wallet, id: '20000000-0000-4000-8000-000000000002', name: 'Other' };
    const decided = applyReviewDecisions(
      { ...workspace, wallets: { ...workspace.wallets, definitions: [wallet, other] } },
      wallet,
      [item],
      'reviewed',
    );
    const otherReview = buildWalletReview(decided, other, { utxos: [utxo] });
    expect(otherReview.items[0].status).toBe('open');
    expect(otherReview.items[0].key).not.toBe(item.key);
    const pruned = pruneWalletReviews({
      ...decided,
      wallets: { ...decided.wallets, definitions: [other] },
    });
    expect(pruned.wallets.reviews).toBeUndefined();
  });

  it('round-trips review decisions through workspace validation', () => {
    const workspace = fixture();
    const item = build(workspace).items[0];
    // The synthetic wallet key is not derivable, so validate the stored record itself.
    const decided = {
      ...applyReviewDecisions(workspace, wallet, [item], 'later'),
      wallets: {
        ...applyReviewDecisions(workspace, wallet, [item], 'later').wallets,
        definitions: [],
      },
    };
    expect(parseWorkspace(decided).wallets.reviews?.[item.key].status).toBe('later');
    expect(() =>
      parseWorkspace({
        ...decided,
        wallets: {
          ...decided.wallets,
          reviews: { bad: { status: 'done', at: '', evidence: '' } },
        },
      }),
    ).toThrow();
    // Older workspaces without the field still load.
    expect(
      parseWorkspace({ ...fixture(), wallets: { ...fixture().wallets, definitions: [] } }).wallets
        .reviews,
    ).toBeUndefined();
  });

  it('builds stable keys that do not collide between reasons', () => {
    expect(reviewKey(wallet.id, 'current-utxo', 'a')).not.toBe(reviewKey(wallet.id, 'source', 'a'));
  });
});

describe('spend guidance', () => {
  it('warns only when the selected outputs carry different recorded sources', () => {
    const workspace = fixture({
      annotations: {
        entities: {
          [`out:${id(1)}:0`]: { label: 'Exchange A', note: '', icon: '', bookmarked: false },
          [`out:${id(2)}:0`]: { label: 'Salary', note: '', icon: '', bookmarked: false },
        },
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

describe('deferral and complete queues', () => {
  it('keeps a deferred wallet transaction discoverable and makes reopen return it to open', () => {
    const workspace = fixture();
    const transaction = find(build(workspace).items, 'wallet-transaction').find(
      (item) => item.txid === id(2),
    )!;
    const deferred = applyReviewDecisions(workspace, wallet, [transaction], 'later');
    const rebuilt = find(build(deferred).items, 'wallet-transaction').find(
      (item) => item.key === transaction.key,
    )!;
    expect(rebuilt).toMatchObject({ status: 'later', subjectIds: [`tx:${id(2)}`] });
    const completed = applyReviewDecisions(deferred, wallet, [rebuilt], 'reviewed');
    const reviewed = find(build(completed).items, 'wallet-transaction').find(
      (item) => item.key === transaction.key,
    )!;
    expect(reviewed.status).toBe('reviewed');
    const reopened = applyReviewDecisions(completed, wallet, [reviewed], 'reopen');
    expect(
      find(build(reopened).items, 'wallet-transaction').find(
        (item) => item.key === transaction.key,
      ),
    ).toMatchObject({ status: 'open', subjectIds: [`tx:${id(2)}`] });
  });

  it('treats only reviewed and unknown as completed reviews', () => {
    expect(isCompletedReview({ status: 'reviewed' })).toBe(true);
    expect(isCompletedReview({ status: 'unknown' })).toBe(true);
    expect(isCompletedReview({ status: 'later' })).toBe(false);
    expect(isCompletedReview({ status: 'reviewed', at: '', evidence: '' })).toBe(true);
    expect(isCompletedReview({ status: 'unknown', at: '', evidence: '' })).toBe(true);
    expect(isCompletedReview({ status: 'later', at: '', evidence: '' })).toBe(false);
    expect(isCompletedReview(undefined)).toBe(false);
  });

  it('includes every review candidate beyond the former per-reason bound', () => {
    const utxos = Array.from({ length: 401 }, (_, index) => ({
      ...utxo,
      txid: id(1000 + index),
      vout: 0,
      valueSats: 60_000_000 - index,
    }));
    const workspace = fixture({ chainData: { transactions: {} } });
    const all = buildWalletReview(workspace, wallet, { utxos });
    expect(find(all.items, 'current-utxo')).toHaveLength(401);
    expect(find(all.items, 'wallet-address')).toHaveLength(2);
    const remainingNodeId = `out:${id(1400)}:0`;
    const reviewed = applyReviewDecisions(
      workspace,
      wallet,
      all.items.filter((item) => item.nodeId !== remainingNodeId),
      'reviewed',
    );
    const after = buildWalletReview(reviewed, wallet, { utxos });
    const open = after.items.filter((item) => item.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].nodeId).toBe(remainingNodeId);
  });

  it('does not hide a deferred record behind completed ones', () => {
    const utxos = Array.from({ length: 401 }, (_, index) => ({
      ...utxo,
      txid: id(2000 + index),
      vout: 0,
      valueSats: 60_000_000 - index,
    }));
    const workspace = fixture({ chainData: { transactions: {} } });
    const first = buildWalletReview(workspace, wallet, { utxos });
    const deferred = applyReviewDecisions(workspace, wallet, [first.items[0]], 'later');
    const reviewed = applyReviewDecisions(deferred, wallet, first.items.slice(1), 'reviewed');
    const after = buildWalletReview(reviewed, wallet, { utxos });
    const pending = after.items.filter((item) => item.status !== 'reviewed');
    expect(pending.map((item) => item.status)).toEqual(['later']);
  });
});
