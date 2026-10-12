import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  applyReviewDecisions,
  buildWalletReview,
  isCompletedReview,
  pruneWalletReviews,
  reviewKey,
  walletGoalKey,
  spendGuidance,
  type WalletReviewItem,
} from '../../../src/Core/Workspace/Wallets/walletReview';
import { MAX_WALLET_REVIEWS, type Wallet } from '../../../src/Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../../src/Core/Workspace/workspace';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import type { Transaction } from '../../../src/Core/ChainData';

import { addressToScriptHash } from '../../../src/Core/Bitcoin';
import type { WalletUtxoRecord } from '../../../src/Core/Workspace/Wallets/walletRecords';
import { applyBatchLabel } from '../../../src/Core/Workspace/Annotations/batchMetadata';
import { saveCounterparty } from '../../../src/Core/Workspace/Counterparties/counterparties';
import { counterpartyReference } from '../../../src/Core/Workspace/annotationReferences';
import type { AnalysisFinding } from '../../../src/Core/Workspace/Analysis/finding';
import {
  initializeLegacyFindingEvidence,
  legacyWalletFindingEvidence,
} from '../../../src/Core/Workspace/Wallets/walletReviewEvidence';
import { walletReviewsSchema } from '../../../src/Core/Workspace/Wallets/wallets';

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
const goal = (review: ReturnType<typeof build>, kind: string, txid = id(2)) =>
  review.items.find((item) => item.goal === kind && item.txid === txid)!;
const partyId = '40000000-0000-4000-8000-000000000004';
const withParty = (
  workspace: Workspace,
  direction: 'received' | 'sent',
  txid: string,
  anchors: string[],
  outputIds?: string[],
) =>
  saveCounterparty(
    workspace,
    { id: partyId, name: 'Public exchange' },
    {
      kind: 'wallet-transaction',
      walletId: wallet.id,
      transactionId: txid,
      direction,
      walletOutputIds: anchors,
      ...(outputIds ? { outputIds } : {}),
    },
  );
const finding: AnalysisFinding = {
  id: 'cioh:aa',
  algorithm: 'cioh-v2',
  title: 'Tentative input group',
  description: 'Co-spent outputs',
  nodeIds: [`out:${id(1)}:0`],
  txids: [id(2)],
  subjects: [`out:${id(1)}:0`, `tx:${id(2)}`, `addr:${MINE_A}`, `addr:${THEIRS}`],
  createdAt: '2026-09-08T10:00:00.000Z',
  kind: 'hypothesis',
};

describe('wallet address descriptions', () => {
  const addressGoal = (review: ReturnType<typeof build>, address = MINE_B) =>
    review.items.find((item) => item.goal === 'address-context' && item.address === address)!;

  it('includes both used branches from history, scripts or checked coins, and leaves lookahead alone', () => {
    const workspace = fixture({ chainData: { transactions: {} } });
    const unused = mine(3);
    workspace.wallets.definitions = [
      {
        ...wallet,
        addresses: [
          {
            ...wallet.addresses[0],
            history: [
              { tx_hash: id(9), height: 0 },
              { tx_hash: id(9), height: 0 },
            ],
          },
          { ...wallet.addresses[1], branch: 1, index: 0, path: 'account/1/0', history: [] },
          {
            address: unused,
            scripthash: addressToScriptHash(unused, 'mainnet'),
            branch: 0,
            index: 2,
            path: 'account/0/2',
          },
        ],
      },
    ];
    const review = build(workspace);
    expect(
      review.items.filter((item) => item.goal === 'address-context').map((item) => item.address),
    ).toEqual([MINE_A, MINE_B]);
    expect(addressGoal(review, MINE_A).transactionIds).toEqual([id(9)]);
    expect(addressGoal(review).transactionIds).toEqual([id(2)]);
    expect(addressGoal(build(workspace, []))).toBeUndefined();
    const loaded = fixture();
    loaded.wallets.definitions = [
      {
        ...wallet,
        addresses: wallet.addresses.map((address) => ({ ...address, history: undefined })),
      },
    ];
    expect(build(loaded, []).items.filter((item) => item.goal === 'address-context')).toHaveLength(
      2,
    );
  });

  it('keeps one address entry with transaction context and leaves legacy acknowledgments separate', () => {
    const key = reviewKey(wallet.id, 'wallet-address', MINE_B);
    const decision = {
      status: 'reviewed' as const,
      at: '2026-09-01T00:00:00.000Z',
      evidence: 'legacy',
    };
    const workspace = fixture({ wallets: { reviews: { [key]: decision } } });
    const review = build(workspace);
    const item = addressGoal(review);
    const group = review.groups.find((group) =>
      group.items.some((candidate) => candidate.key === item.key),
    )!;
    expect(group).toMatchObject({ key: `addr:${MINE_B}`, transactionId: undefined });
    expect(group.items).toHaveLength(1);
    expect(item).toMatchObject({ status: 'open', nodeId: `addr:${MINE_B}`, scope: 'addresses' });
    expect(review.legacyDecisions).toEqual([{ key, ...decision }]);
    expect(item.key).not.toBe(key);
  });

  it.each(['label', 'note', 'tag'] as const)(
    'uses an address %s for address and exact coin context without copying it or answering transactions',
    (field) => {
      let workspace = fixture({ analysis: { findings: [finding] } });
      if (field === 'tag')
        workspace.annotations.tags = [
          { id: partyId, name: 'Project reserves', color: '#27c4a7', nodeIds: [`addr:${MINE_B}`] },
        ];
      else
        workspace.annotations.entities[`addr:${MINE_B}`] = {
          label: field === 'label' ? 'Project reserves' : '',
          note: field === 'note' ? 'Project reserves' : '',
          icon: '',
          bookmarked: false,
        };
      const review = build(workspace);
      expect(addressGoal(review)).toMatchObject({
        satisfied: true,
        status: 'resolved',
        contextSubjects: [`addr:${MINE_B}`],
      });
      expect(goal(review, 'coin-context').status).toBe('resolved');
      expect(goal(review, 'coin-context').contextSubjects).toContain(`addr:${MINE_B}`);
      expect(goal(review, 'activity-context').status).toBe('open');
      expect(
        review.items
          .filter((item) => item.kind === 'finding')
          .every((item) => item.status === 'open'),
      ).toBe(true);
      expect(workspace.annotations.entities[`out:${id(2)}:0`]).toBeUndefined();
      expect(workspace.annotations.entities[`tx:${id(2)}`]).toBeUndefined();
      expect(workspace.wallets.reviews).toBeUndefined();
      workspace = { ...workspace, annotations: { entities: {}, tags: [] } };
      expect(addressGoal(build(workspace))).toMatchObject({ status: 'open', satisfied: false });
      expect(goal(build(workspace), 'coin-context').status).toBe('open');
    },
  );

  it.each(['cannot-identify', 'not-needed', 'later'] as const)(
    'retains %s through new activity, annotation removal and explicit reopen',
    (status) => {
      const original = fixture();
      const item = addressGoal(build(original));
      let workspace = applyReviewDecisions(original, wallet, [item], status);
      workspace = {
        ...workspace,
        wallets: {
          ...workspace.wallets,
          definitions: [
            {
              ...wallet,
              scannedAt: '2026-10-01T00:00:00.000Z',
              addresses: wallet.addresses.map((address) => ({
                ...address,
                history: [...address.history!, { tx_hash: id(10), height: 800010 }],
              })),
            },
          ],
        },
      };
      expect(addressGoal(build(workspace))).toMatchObject({
        status,
        changed: false,
        evidence: item.evidence,
        key: item.key,
      });
      const labelled = applyBatchLabel(workspace, [item.nodeId], 'Reserves');
      expect(addressGoal(build(labelled))).toMatchObject({ status: 'resolved', satisfied: true });
      expect(labelled.wallets.reviews![item.key].status).toBe(status);
      const removed = applyBatchLabel(labelled, [item.nodeId], '', true);
      expect(addressGoal(build(removed))).toMatchObject({ status, changed: false });
      const reopened = applyReviewDecisions(
        removed,
        wallet,
        [addressGoal(build(removed))],
        'reopen',
      );
      expect(addressGoal(build(reopened))).toMatchObject({ status: 'open', changed: false });
    },
  );

  it('ignores icons, empty annotations, invalid histories and another network', () => {
    const workspace = fixture({ chainData: { transactions: {} } });
    workspace.annotations.entities[`addr:${MINE_A}`] = {
      label: '  ',
      note: '\t',
      icon: 'gift',
      bookmarked: true,
    };
    expect(addressGoal(build(workspace), MINE_A).status).toBe('open');
    const foreign = bitcoinAddress.toBech32(new Uint8Array(20).fill(4), 0, 'tb');
    workspace.wallets.definitions = [
      {
        ...wallet,
        addresses: [
          {
            ...wallet.addresses[0],
            history: [
              { tx_hash: 'invalid', height: 0 },
              { tx_hash: id(1), height: -2 },
            ],
          },
          {
            ...wallet.addresses[1],
            address: foreign,
            scripthash: addressToScriptHash(foreign, 'testnet4'),
          },
        ],
      },
    ];
    expect(build(workspace, []).items.some((item) => item.goal === 'address-context')).toBe(false);
  });
});

describe('derived wallet annotation goals', () => {
  it('groups activity around transactions and address descriptions around exact addresses', () => {
    const review = build(fixture());
    expect(review.items.every((item) => item.kind === 'annotation-goal')).toBe(true);
    expect(review.items.map((item) => item.goal)).toEqual([
      'activity-context',
      'activity-context',
      'address-context',
      'address-context',
      'coin-context',
      'counterparty-context',
    ]);
    expect(find(review.items, 'wallet-address')).toEqual([]);
    expect(find(review.items, 'source')).toEqual([]);
    expect(review.groups.map((group) => group.transactionId)).toEqual([
      id(2),
      id(1),
      undefined,
      undefined,
    ]);
    expect(review.groups[0].items.map((item) => item.goal)).toEqual([
      'activity-context',
      'coin-context',
      'counterparty-context',
    ]);
    expect(
      new Set(review.groups.flatMap((group) => group.items.map((item) => item.key))).size,
    ).toBe(review.items.length);
    expect(fixture().wallets.reviews).toBeUndefined();
  });

  it('resolves a coin from its own label without requiring tags or saving a decision', () => {
    const workspace = fixture();
    const coin = goal(build(workspace), 'coin-context');
    const edited = applyBatchLabel(workspace, [coin.nodeId], 'Savings');
    expect(goal(build(edited), 'coin-context')).toMatchObject({
      key: coin.key,
      satisfied: true,
      status: 'resolved',
      changed: false,
      contextSubjects: [coin.nodeId],
      evidence: coin.evidence,
    });
    expect(edited.wallets.reviews).toBeUndefined();
    expect(goal(build(edited), 'counterparty-context').status).toBe('open');
  });

  it('resolves activity and coins from a human receipt note edited anywhere, without copying labels', () => {
    const workspace = fixture();
    workspace.annotations.entities[`tx:${id(1)}`] = {
      label: '',
      note: 'Birthday gift',
      icon: '',
      bookmarked: false,
    };
    const review = build(workspace);
    expect(goal(review, 'activity-context', id(1))).toMatchObject({ status: 'resolved' });
    expect(goal(review, 'coin-context')).toMatchObject({
      status: 'resolved',
      label: '',
      contextSubjects: [`tx:${id(1)}`],
    });
    expect(workspace.annotations.entities[`out:${id(2)}:0`]).toBeUndefined();
    expect(workspace.wallets.reviews).toBeUndefined();
  });

  it('links exact earlier receipt labels and removes satisfaction when that context is removed', () => {
    const original = fixture();
    const labelled = applyBatchLabel(original, [`out:${id(1)}:0`], 'Income');
    expect(goal(build(labelled), 'coin-context')).toMatchObject({
      status: 'resolved',
      contextSubjects: [`out:${id(1)}:0`],
    });
    const removed = applyBatchLabel(labelled, [`out:${id(1)}:0`], '', true);
    expect(goal(build(removed), 'coin-context')).toMatchObject({
      status: 'open',
      satisfied: false,
      contextSubjects: [],
    });
  });

  it('accepts effective coin address tags as optional human context but does not copy address labels', () => {
    const workspace = fixture();
    workspace.annotations.entities[`addr:${MINE_B}`] = {
      label: 'Receiving address',
      note: '',
      icon: '',
      bookmarked: false,
    };
    expect(goal(build(workspace), 'coin-context')).toMatchObject({
      status: 'resolved',
      contextSubjects: [`addr:${MINE_B}`],
    });
    workspace.annotations.tags = [
      { id: partyId, name: 'Savings', color: '#27c4a7', nodeIds: [`addr:${MINE_B}`] },
    ];
    expect(goal(build(workspace), 'coin-context')).toMatchObject({
      status: 'resolved',
      label: '',
      tags: ['Savings'],
    });
  });

  it('does not inherit a transaction tag or icon as a receipt label', () => {
    const workspace = fixture();
    workspace.annotations.entities[`tx:${id(2)}`] = {
      label: '',
      note: '',
      icon: 'gift',
      bookmarked: true,
    };
    workspace.annotations.tags = [
      { id: partyId, name: 'Spend purpose', color: '#27c4a7', nodeIds: [`tx:${id(2)}`] },
    ];
    expect(goal(build(workspace), 'activity-context')).toMatchObject({
      status: 'resolved',
      contextSubjects: [`tx:${id(2)}`],
    });
    expect(goal(build(workspace), 'coin-context').status).toBe('open');
  });

  it('resolves receipt-linked coins from a received counterparty while preserving metadata subjects', () => {
    const named = withParty(fixture(), 'received', id(1), [`out:${id(1)}:0`]);
    expect(goal(build(named), 'coin-context')).toMatchObject({
      status: 'resolved',
      label: '',
      contextSubjects: [counterpartyReference(partyId)],
    });
    expect(goal(build(named), 'activity-context', id(1))).toMatchObject({
      status: 'open',
      contextSubjects: [],
    });
    expect(named.annotations.entities[`out:${id(2)}:0`]).toBeUndefined();
    expect(named.wallets.reviews).toBeUndefined();
  });

  it('keeps a sent counterparty from becoming the origin of change', () => {
    const named = withParty(fixture(), 'sent', id(2), [`out:${id(1)}:0`]);
    expect(goal(build(named), 'activity-context')).toMatchObject({
      status: 'open',
      contextSubjects: [],
    });
    expect(goal(build(named), 'counterparty-context')).toMatchObject({
      status: 'resolved',
      contextSubjects: [counterpartyReference(partyId)],
      relationshipKinds: ['destination'],
    });
    expect(goal(build(named), 'coin-context')).toMatchObject({
      status: 'open',
      contextSubjects: [],
    });
  });

  it('respects narrowed received-output links in a multi-output receipt', () => {
    const workspace = fixture({
      chainData: {
        transactions: {
          [id(1)]: {
            ...receipt,
            vout: [...receipt.vout, { n: 1, value: 0.5, scriptPubKey: { hex: script(MINE_B) } }],
          },
        },
      },
    });
    const named = withParty(
      workspace,
      'received',
      id(1),
      [`out:${id(1)}:0`, `out:${id(1)}:1`],
      [`out:${id(1)}:0`],
    );
    const coins = build(named, [
      {
        ...utxo,
        txid: id(1),
        vout: 0,
        valueSats: 100_000_000,
        address: MINE_A,
        scripthash: addressToScriptHash(MINE_A, 'mainnet'),
      },
      { ...utxo, txid: id(1), vout: 1, valueSats: 50_000_000 },
    ]).items.filter((item) => item.goal === 'coin-context');
    expect(coins.map((coin) => coin.status)).toEqual(['resolved', 'open']);
  });

  it('uses the net-positive received role for collaborative transactions with wallet inputs', () => {
    const external: Transaction = {
      txid: id(9),
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 0.5, scriptPubKey: { hex: script(THEIRS) } }],
    };
    const collaborative: Transaction = {
      ...spend,
      vin: [...spend.vin, { txid: id(9), vout: 0 }],
      vout: [
        { n: 0, value: 1.2, scriptPubKey: { hex: script(MINE_B) } },
        { n: 1, value: 0.29, scriptPubKey: { hex: script(THEIRS) } },
      ],
    };
    const workspace = fixture({
      chainData: { transactions: { [id(1)]: receipt, [id(2)]: collaborative, [id(9)]: external } },
    });
    const named = withParty(workspace, 'received', id(2), [`out:${id(2)}:0`]);
    const review = build(named, [{ ...utxo, valueSats: 120_000_000 }]);
    expect(goal(review, 'counterparty-context')).toMatchObject({
      status: 'resolved',
      relationshipKinds: ['source'],
    });
    expect(goal(review, 'coin-context').status).toBe('resolved');
  });

  it('reuses exact funding-address context without identifying neighboring inputs or allocating value', () => {
    const funding: Transaction = {
      txid: id(9),
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1.1, scriptPubKey: { hex: script(THEIRS) } }],
    };
    const incoming: Transaction = { ...receipt, vin: [{ txid: id(9), vout: 0 }] };
    const workspace = fixture({
      chainData: { transactions: { [id(9)]: funding, [id(1)]: incoming, [id(2)]: spend } },
    });
    const named = saveCounterparty(
      workspace,
      { id: partyId, name: 'Public exchange' },
      { kind: 'entity', subjectId: `addr:${THEIRS}` },
    );
    const review = build(named);
    expect(goal(review, 'counterparty-context', id(1))).toMatchObject({
      status: 'resolved',
      contextSubjects: [`addr:${THEIRS}`, counterpartyReference(partyId)],
    });
    expect(goal(review, 'coin-context').contextSubjects).toContain(`addr:${THEIRS}`);
    expect(named.annotations.entities[`out:${id(2)}:0`]).toBeUndefined();
    expect(named.counterparties!.links).toHaveLength(1);
    expect(named.counterparties!.links[0]).toMatchObject({
      kind: 'entity',
      subjectId: `addr:${THEIRS}`,
    });
  });

  it('reuses exact sent output/address context for the payment, never for wallet change', () => {
    const named = saveCounterparty(
      fixture(),
      { id: partyId, name: 'Shop' },
      { kind: 'entity', subjectId: `out:${id(2)}:1` },
    );
    const review = build(named);
    expect(goal(review, 'counterparty-context')).toMatchObject({
      status: 'resolved',
      contextSubjects: [`out:${id(2)}:1`, counterpartyReference(partyId)],
    });
    expect(goal(review, 'coin-context').status).toBe('open');
  });

  it('does not manufacture a counterparty requirement for internal transfers or coinbase receipts', () => {
    const self: Transaction = {
      ...spend,
      vout: [{ n: 0, value: 0.99, scriptPubKey: { hex: script(MINE_B) } }],
    };
    const workspace = fixture({ chainData: { transactions: { [id(1)]: receipt, [id(2)]: self } } });
    expect(
      build(workspace, [{ ...utxo, valueSats: 99_000_000 }]).items.filter(
        (item) => item.goal === 'counterparty-context',
      ),
    ).toEqual([]);
  });
});

describe('goal dispositions and evidence', () => {
  it('keeps cannot identify, no annotation needed and later distinct from metadata satisfaction', () => {
    for (const status of ['cannot-identify', 'not-needed', 'later'] as const) {
      const workspace = fixture();
      const item = goal(build(workspace), 'coin-context');
      const saved = applyReviewDecisions(
        workspace,
        wallet,
        [item],
        status,
        '2026-09-10T00:00:00.000Z',
      );
      expect(goal(build(saved), 'coin-context')).toMatchObject({
        status,
        satisfied: false,
        changed: false,
      });
      expect(saved.wallets.reviews![item.key]).toEqual({
        kind: 'annotation-goal',
        status,
        evidence: item.evidence,
        at: '2026-09-10T00:00:00.000Z',
      });
      expect(isCompletedReview({ status })).toBe(status !== 'later');
      const labelled = applyBatchLabel(saved, [item.nodeId], 'Savings');
      expect(goal(build(labelled), 'coin-context')).toMatchObject({
        status: 'resolved',
        satisfied: true,
      });
      expect(labelled.wallets.reviews![item.key]).toEqual(saved.wallets.reviews![item.key]);
      expect(
        build(labelled)
          .groups.flatMap((group) => group.items)
          .some((entry) => entry.key === item.key),
      ).toBe(true);
    }
  });

  it('does not acknowledge annotation goals as reviewed or apply goal dispositions to findings', () => {
    const workspace = fixture({ analysis: { findings: [finding] } });
    const review = build(workspace);
    const coin = goal(review, 'coin-context');
    const assessment = review.items.find((item) => item.kind === 'finding')!;
    expect(() => applyReviewDecisions(workspace, wallet, [coin], 'reviewed')).toThrow(
      'annotation disposition',
    );
    expect(() => applyReviewDecisions(workspace, wallet, [assessment], 'cannot-identify')).toThrow(
      'annotation disposition',
    );
    expect(() =>
      applyReviewDecisions(workspace, wallet, [coin, assessment], 'not-needed'),
    ).toThrow();
    expect(workspace.wallets.reviews).toBeUndefined();
    expect(
      walletReviewsSchema.safeParse({
        [coin.key]: {
          kind: 'annotation-goal',
          status: 'reviewed',
          evidence: coin.evidence,
          at: '2026-09-10T00:00:00.000Z',
        },
      }).success,
    ).toBe(false);
  });

  it('reopens deliberately and treats unchanged repeat decisions as a no-op', () => {
    const workspace = fixture();
    const item = goal(build(workspace), 'coin-context');
    expect(applyReviewDecisions(workspace, wallet, [item], 'reopen')).toBe(workspace);
    const saved = applyReviewDecisions(
      workspace,
      wallet,
      [item, item],
      'later',
      '2026-09-10T00:00:00.000Z',
    );
    expect(Object.keys(saved.wallets.reviews!)).toEqual([item.key]);
    expect(applyReviewDecisions(saved, wallet, [item], 'later')).toBe(saved);
    const reopened = applyReviewDecisions(saved, wallet, [item], 'reopen');
    expect(reopened.wallets.reviews).toBeUndefined();
    expect(goal(build(reopened), 'coin-context').status).toBe('open');
    expect(() =>
      applyReviewDecisions(workspace, { ...wallet, id: 'another-wallet' }, [item], 'later'),
    ).toThrow('another wallet');
  });

  it('requeues only the changed unmet goal, not observation timestamps or unrelated metadata', () => {
    const workspace = fixture();
    const review = build(workspace);
    const activity = goal(review, 'activity-context');
    const coin = goal(review, 'coin-context');
    const saved = applyReviewDecisions(workspace, wallet, [activity, coin], 'later');
    const routine = fixture({
      wallets: saved.wallets,
      chainData: {
        transactions: {
          [id(1)]: receipt,
          [id(2)]: { ...spend, status: { kind: 'confirmed', blockHeight: 800002 } },
        },
      },
    });
    expect(
      goal(
        buildWalletReview(routine, wallet, {
          utxos: [utxo],
          utxoCheckedAt: '2026-09-11T00:00:00.000Z',
        }),
        'coin-context',
      ).changed,
    ).toBe(false);
    expect(goal(build(routine), 'activity-context').changed).toBe(false);
    const changed = fixture({
      wallets: saved.wallets,
      chainData: {
        transactions: {
          [id(1)]: receipt,
          [id(2)]: { ...spend, vout: [{ ...spend.vout[0], value: 0.5 }, spend.vout[1]] },
        },
      },
    });
    expect(goal(build(changed, [{ ...utxo, valueSats: 50_000_000 }]), 'coin-context').changed).toBe(
      true,
    );
    expect(
      goal(build(changed, [{ ...utxo, valueSats: 50_000_000 }]), 'activity-context').changed,
    ).toBe(true);
    expect(goal(build(changed), 'activity-context', id(1)).changed).toBe(false);
  });

  it('keeps sent human labels, notes and incorrectly assigned received relationships from identifying change origin', () => {
    let workspace = withParty(fixture(), 'received', id(2), [`out:${id(2)}:0`]);
    workspace = withParty(workspace, 'sent', id(2), [`out:${id(1)}:0`]);
    workspace.annotations.entities[`tx:${id(2)}`] = {
      label: 'Rent',
      note: 'Monthly payment',
      icon: '',
      bookmarked: false,
    };
    expect(goal(build(workspace), 'activity-context').status).toBe('resolved');
    expect(goal(build(workspace), 'coin-context')).toMatchObject({
      status: 'open',
      contextSubjects: [],
    });
    workspace.annotations.entities[`tx:${id(1)}`] = {
      label: '',
      note: 'Salary',
      icon: '',
      bookmarked: false,
    };
    expect(goal(build(workspace), 'coin-context')).toMatchObject({
      status: 'resolved',
      contextSubjects: [`tx:${id(1)}`],
    });
  });

  it('does not inherit an earlier payment purpose into a second generation change coin', () => {
    const next: Transaction = {
      ...spend,
      txid: id(3),
      vin: [{ txid: id(2), vout: 0 }],
      vout: [
        { n: 0, value: 0.4, scriptPubKey: { hex: script(MINE_B) } },
        { n: 1, value: 0.19, scriptPubKey: { hex: script(THEIRS) } },
      ],
    };
    const workspace = fixture({
      chainData: { transactions: { [id(1)]: receipt, [id(2)]: spend, [id(3)]: next } },
    });
    workspace.annotations.entities[`tx:${id(2)}`] = {
      label: 'Rent',
      note: '',
      icon: '',
      bookmarked: false,
    };
    const check = [{ ...utxo, txid: id(3), valueSats: 40_000_000 }];
    expect(goal(build(workspace, check), 'coin-context', id(3)).status).toBe('open');
    const exact = applyBatchLabel(workspace, [`out:${id(2)}:0`], 'Specific savings coin');
    expect(goal(build(exact, check), 'coin-context', id(3))).toMatchObject({
      status: 'resolved',
      contextSubjects: [`out:${id(2)}:0`],
    });
  });

  it('retains old object acknowledgments as immutable prior history rather than completing new goals', () => {
    const key = reviewKey(wallet.id, 'current-utxo', `out:${id(2)}:0`);
    const decision = {
      status: 'reviewed' as const,
      evidence: 'old-format',
      at: '2026-09-01T00:00:00.000Z',
    };
    const workspace = fixture({ wallets: { reviews: { [key]: decision } } });
    const review = build(workspace);
    expect(goal(review, 'coin-context').status).toBe('open');
    expect(review.legacyDecisions).toEqual([{ key, ...decision }]);
    expect(workspace.wallets.reviews![key]).toBe(decision);
    expect(walletGoalKey(wallet.id, 'coin-context', `out:${id(2)}:0`)).not.toBe(key);
    expect(pruneWalletReviews(workspace)).toBe(workspace);
    expect(
      pruneWalletReviews({ ...workspace, wallets: { ...workspace.wallets, definitions: [] } })
        .wallets.reviews,
    ).toBeUndefined();
  });

  it('preserves the review budget without evicting earlier human decisions', () => {
    const entries = Object.fromEntries(
      Array.from({ length: MAX_WALLET_REVIEWS }, (_, index) => [
        `${wallet.id}|old|${index}`,
        { status: 'reviewed' as const, evidence: 'legacy', at: '2026-09-01T00:00:00.000Z' },
      ]),
    );
    const workspace = fixture({ wallets: { reviews: entries } });
    const coin = goal(build(workspace), 'coin-context');
    expect(() => applyReviewDecisions(workspace, wallet, [coin], 'later')).toThrow('at most');
    expect(workspace.wallets.reviews).toBe(entries);
    expect(Object.keys(entries)).toHaveLength(MAX_WALLET_REVIEWS);
    expect(walletReviewsSchema.safeParse(entries).success).toBe(true);
  });
});

describe('finding assessments and prior support baselines', () => {
  const withFinding = (algorithm = finding.algorithm) =>
    fixture({ analysis: { findings: [{ ...finding, algorithm }] } });
  const findingItem = (workspace: Workspace) =>
    build(workspace).items.find((item) => item.kind === 'finding')!;
  it('projects one finding into factual views but assigns only one assessment to its transaction group', () => {
    const workspace = withFinding();
    const review = build(workspace);
    const projections = review.items.filter((item) => item.kind === 'finding');
    expect(new Set(projections.map((item) => item.scope))).toEqual(
      new Set(['utxos', 'transactions', 'addresses', 'relationships']),
    );
    expect(new Set(projections.map((item) => item.key)).size).toBe(1);
    expect(projections.every((item) => item.scopes === undefined)).toBe(true);
    const groupedFinding = review.groups
      .flatMap((group) => group.items)
      .find((item) => item.kind === 'finding')!;
    expect(new Set(groupedFinding.scopes)).toEqual(
      new Set(['utxos', 'transactions', 'addresses', 'relationships']),
    );
    expect(
      review.groups.flatMap((group) => group.items).filter((item) => item.kind === 'finding'),
    ).toHaveLength(1);
    const saved = applyReviewDecisions(workspace, wallet, projections, 'reviewed');
    expect(Object.keys(saved.wallets.reviews!)).toHaveLength(1);
    expect(
      build(saved)
        .items.filter((item) => item.kind === 'finding')
        .every((item) => item.status === 'reviewed' && !item.changed),
    ).toBe(true);
  });

  it('requeues a value-flow assessment on changed material vsize without requeueing confirmations', () => {
    const workspace = withFinding('value-flow-v1');
    const saved = applyReviewDecisions(workspace, wallet, [findingItem(workspace)], 'reviewed');
    const observed = {
      ...saved,
      chainData: {
        ...saved.chainData,
        transactions: {
          ...saved.chainData.transactions,
          [id(2)]: { ...spend, status: { kind: 'confirmed' as const, blockHeight: 800099 } },
        },
      },
    };
    expect(findingItem(observed)).toMatchObject({ status: 'reviewed', changed: false });
    const changed = {
      ...saved,
      chainData: {
        ...saved.chainData,
        transactions: { ...saved.chainData.transactions, [id(2)]: { ...spend, vsize: 300 } },
      },
    };
    expect(findingItem(changed)).toMatchObject({ status: 'reviewed', changed: true });
    expect(changed.wallets.reviews).toBe(saved.wallets.reviews);
  });

  it('preserves original legacy assessment fields and compares against its saved material support baseline', () => {
    const workspace = withFinding();
    const key = reviewKey(wallet.id, 'link', finding.id);
    const record = {
      status: 'reviewed' as const,
      evidence: legacyWalletFindingEvidence(finding),
      at: '2026-09-01T00:00:00.000Z',
    };
    workspace.wallets.reviews = { [key]: record };
    const migrated = initializeLegacyFindingEvidence(workspace);
    expect(workspace.wallets.reviews[key]).toBe(record);
    expect(migrated.wallets.reviews![key]).toEqual({
      ...record,
      supportEvidence: findingItem(migrated).evidence,
    });
    expect(findingItem(migrated)).toMatchObject({
      status: 'reviewed',
      decidedAt: record.at,
      changed: false,
    });
    expect(initializeLegacyFindingEvidence(migrated)).toBe(migrated);
    const changed = {
      ...migrated,
      chainData: {
        ...migrated.chainData,
        transactions: {
          ...migrated.chainData.transactions,
          [id(1)]: { ...receipt, vout: [{ ...receipt.vout[0], value: 0.9 }] },
        },
      },
    };
    expect(findingItem(changed).changed).toBe(true);
    expect(initializeLegacyFindingEvidence(changed)).toBe(changed);
    expect(changed.wallets.reviews![key]).toEqual(migrated.wallets.reviews![key]);
  });

  it('does not baseline mismatched or stale prior findings or object acknowledgments', () => {
    const workspace = withFinding();
    const key = reviewKey(wallet.id, 'link', finding.id);
    workspace.wallets.reviews = {
      [key]: { status: 'later', evidence: 'mismatch', at: '2026-09-01T00:00:00.000Z' },
    };
    expect(initializeLegacyFindingEvidence(workspace)).toBe(workspace);
    expect(findingItem(workspace).changed).toBe(true);
    const stale = { ...workspace, analysis: { findings: [{ ...finding, stale: true }] } };
    stale.wallets.reviews![key].evidence = legacyWalletFindingEvidence(finding);
    expect(initializeLegacyFindingEvidence(stale)).toBe(stale);
    expect(build(stale).items.some((item) => item.kind === 'finding')).toBe(false);
    const excluded = { ...workspace, analysis: { findings: [{ ...finding, excluded: true }] } };
    expect(build(excluded).items.some((item) => item.kind === 'finding')).toBe(false);
    const unknown = { ...workspace, analysis: { findings: [{ ...finding, subjects: undefined }] } };
    expect(build(unknown).items.some((item) => item.kind === 'finding')).toBe(false);
  });

  it('keeps wallet rename from changing wallet-intersection assessments but requeues factual address matches', () => {
    const workspace = withFinding('wallet-intersections-v1');
    const saved = applyReviewDecisions(workspace, wallet, [findingItem(workspace)], 'reviewed');
    const renamed = {
      ...saved,
      wallets: { ...saved.wallets, definitions: [{ ...wallet, name: 'Everyday wallet' }] },
    };
    expect(findingItem(renamed).changed).toBe(false);
    const changed = {
      ...saved,
      wallets: {
        ...saved.wallets,
        definitions: [{ ...wallet, addresses: wallet.addresses.slice(0, 1) }],
      },
    };
    expect(findingItem(changed).changed).toBe(true);
  });
});

describe('factual coverage and spend guidance', () => {
  it('keeps no check unknown while a completed empty check is a dated zero observation', () => {
    const workspace = fixture();
    const unchecked = buildWalletReview(workspace, wallet);
    expect(unchecked.coverage.utxoCount).toBeUndefined();
    expect(unchecked.coverage.utxoBalanceSats).toBeUndefined();
    expect(unchecked.items.some((item) => item.goal === 'coin-context')).toBe(false);
    const checked = build(workspace, []);
    expect(checked.coverage).toMatchObject({
      utxoCount: 0,
      utxoBalanceSats: 0,
      utxoPartial: false,
    });
    const partial = buildWalletReview(workspace, wallet, {
      utxos: [],
      utxoCheckedAt: '2026-09-01T00:00:00.000Z',
      utxoCheckedAddresses: 1,
      utxoTotalAddresses: 2,
    });
    expect(partial.coverage.utxoPartial).toBe(true);
  });

  it('rejects unverified UTXO claims and removes a current candidate with a loaded spender without deleting its decision', () => {
    const workspace = fixture();
    expect(build(workspace, [{ ...utxo, address: THEIRS }]).coverage.utxoCount).toBe(0);
    const coin = goal(build(workspace), 'coin-context');
    const saved = applyReviewDecisions(workspace, wallet, [coin], 'later');
    const spender: Transaction = {
      txid: id(3),
      vin: [{ txid: id(2), vout: 0 }],
      vout: [{ n: 0, value: 0.59, scriptPubKey: { hex: script(THEIRS) } }],
    };
    const changed = {
      ...saved,
      chainData: {
        ...saved.chainData,
        transactions: { ...saved.chainData.transactions, [id(3)]: spender },
      },
    };
    const review = build(changed);
    expect(review.coverage).toMatchObject({
      utxoCount: 0,
      utxoBalanceSats: 0,
      utxoLoadedSpenders: 1,
    });
    expect(review.items.some((item) => item.goal === 'coin-context')).toBe(false);
    expect(changed.wallets.reviews![coin.key]).toEqual(saved.wallets.reviews![coin.key]);
  });

  it('warns about mixing different direct labels or tags without asserting ownership or risk scores', () => {
    const workspace = applyBatchLabel(
      applyBatchLabel(fixture(), [`out:${id(1)}:0`], 'Salary'),
      [`out:${id(2)}:0`],
      'Gift',
    );
    expect(spendGuidance(workspace, [`out:${id(1)}:0`, `out:${id(2)}:0`])).toContain(
      '2 different source labels',
    );
    expect(spendGuidance(workspace, [`out:${id(1)}:0`, `out:${id(9)}:0`])).toContain(
      'no recorded source',
    );
    expect(spendGuidance(workspace, [`out:${id(1)}:0`])).toBeUndefined();
    expect(spendGuidance(workspace, [`out:${id(1)}:0`, `out:${id(1)}:0`])).toBeUndefined();
  });
});

describe('review factual boundaries', () => {
  it('keeps script-derived factual subjects stable when imported display claims disagree', () => {
    const workspace = fixture();
    const item = goal(build(workspace), 'counterparty-context');
    expect(item.subjectIds).toContain(`addr:${THEIRS}`);
    const saved = applyReviewDecisions(workspace, wallet, [item], 'cannot-identify');
    const changed = {
      ...saved,
      chainData: {
        ...saved.chainData,
        transactions: structuredClone(saved.chainData.transactions),
      },
    };
    changed.chainData.transactions[id(2)].vout[1].scriptPubKey.address = MINE_A;
    const after = goal(build(changed), 'counterparty-context');
    expect(after.subjectIds).toEqual(item.subjectIds);
    expect(after.evidence).toBe(item.evidence);
    expect(after.changed).toBe(false);
  });

  it('decodes neutral raw scripts with the selected network and does not mix wallet observations', () => {
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
    expect(
      goal(build(workspace, [{ ...utxo, address: testAddress(2) }]), 'counterparty-context')
        .subjectIds,
    ).toContain(`addr:${testAddress(9)}`);
    expect(build(workspace, [utxo]).coverage.utxoCount).toBe(0);
    const other = {
      ...wallet,
      addresses: [
        {
          ...wallet.addresses[0],
          address: THEIRS,
          scripthash: addressToScriptHash(THEIRS, 'mainnet'),
        },
      ],
    };
    expect(buildWalletReview(fixture(), other, { utxos: [utxo] }).coverage.utxoCount).toBe(0);
  });

  it.each(['broken', '6a00'])(
    'does not identify external script %s from a claimed address',
    (hex) => {
      const workspace = fixture({
        chainData: {
          transactions: {
            [id(1)]: receipt,
            [id(2)]: {
              ...spend,
              vout: [spend.vout[0], { ...spend.vout[1], scriptPubKey: { hex, address: THEIRS } }],
            },
          },
        },
      });
      expect(goal(build(workspace), 'counterparty-context').subjectIds).not.toContain(
        `addr:${THEIRS}`,
      );
      const named = saveCounterparty(
        workspace,
        { id: partyId, name: 'Shop' },
        { kind: 'entity', subjectId: `addr:${THEIRS}` },
      );
      expect(goal(build(named), 'counterparty-context').status).toBe('open');
    },
  );

  it('uses validated address-only evidence and rejects another network identity', () => {
    const workspace = fixture({
      chainData: {
        transactions: {
          [id(1)]: receipt,
          [id(2)]: {
            ...spend,
            vout: [spend.vout[0], { ...spend.vout[1], scriptPubKey: { address: THEIRS } }],
          },
        },
      },
    });
    expect(goal(build(workspace), 'counterparty-context').subjectIds).toContain(`addr:${THEIRS}`);
    workspace.chainData.transactions[id(2)].vout[1].scriptPubKey.address = bitcoinAddress.toBech32(
      new Uint8Array(20).fill(9),
      0,
      'tb',
    );
    expect(
      goal(build(workspace), 'counterparty-context').subjectIds.some((subject) =>
        subject.startsWith('addr:'),
      ),
    ).toBe(false);
  });

  it('reports unloaded coin transactions as missing evidence and requeues when their transaction loads', () => {
    const workspace = fixture({ chainData: { transactions: {} } });
    const review = build(workspace);
    expect(review.missingSourceTransactions).toBe(1);
    expect(review.coverage.utxoCount).toBe(1);
    expect(review.items.filter((item) => item.goal === 'counterparty-context')).toHaveLength(0);
    const item = goal(review, 'coin-context');
    const saved = applyReviewDecisions(workspace, wallet, [item], 'later');
    const loaded = {
      ...saved,
      chainData: { ...saved.chainData, transactions: { [id(1)]: receipt, [id(2)]: spend } },
    };
    expect(goal(build(loaded), 'coin-context')).toMatchObject({
      key: item.key,
      status: 'later',
      changed: true,
    });
    expect(build(fixture(), [{ ...utxo, valueSats: 1 }]).coverage.utxoCount).toBe(0);
  });

  it('keeps unloaded transaction goals discoverable and their decisions independent', () => {
    const pendingWallet = {
      ...wallet,
      pendingTransactionIds: [id(9)],
      addresses: wallet.addresses.map((entry) => ({
        ...entry,
        history: [...(entry.history ?? []), { tx_hash: id(9), height: 800003 }],
      })),
    };
    const workspace = fixture({ wallets: { definitions: [pendingWallet] } });
    const pending = goal(build(workspace), 'activity-context', id(9));
    expect(pending).toMatchObject({ status: 'open' });
    const saved = applyReviewDecisions(workspace, pendingWallet, [pending], 'later');
    expect(goal(build(saved), 'activity-context', id(9))).toMatchObject({
      status: 'later',
      changed: false,
    });
    expect(goal(build(saved), 'activity-context', id(2)).status).toBe('open');
    expect(saved.chainData).toBe(workspace.chainData);
    const loaded = {
      ...saved,
      chainData: {
        ...saved.chainData,
        transactions: { ...saved.chainData.transactions, [id(9)]: { ...receipt, txid: id(9) } },
      },
    };
    expect(goal(build(loaded), 'activity-context', id(9)).changed).toBe(true);
  });

  it('includes every transaction goal beyond former per-reason bounds', () => {
    const transactions = Object.fromEntries(
      Array.from({ length: 405 }, (_, index) => [
        id(index + 100),
        { ...receipt, txid: id(index + 100) },
      ]),
    );
    const workspace = fixture({ chainData: { transactions } });
    const review = build(workspace, []);
    expect(review.items.filter((item) => item.goal === 'activity-context')).toHaveLength(406);
    const item = goal(review, 'activity-context', id(100));
    const saved = applyReviewDecisions(workspace, wallet, [item], 'later');
    expect(goal(build(saved, []), 'activity-context', id(100)).status).toBe('later');
    expect(
      new Set(review.groups.flatMap((group) => group.items.map((entry) => entry.key))).size,
    ).toBe(review.items.length);
  });
});

it('requires explicit factual finding subjects rather than inferring relevance from its transaction list', () => {
  const workspace = fixture({
    analysis: { findings: [{ ...finding, subjects: [`out:${id(99)}:0`, `addr:${mine(8)}`] }] },
  });
  expect(build(workspace).items.filter((item) => item.kind === 'finding')).toEqual([]);
});
