import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { analysisTools } from '../../../../../Core/Workspace/Analysis/analysis';
import type { AnalysisScan } from '../../../../../Core/Workspace/Analysis/analysisScan';
import {
  matchesReviewCategories,
  walletReviewCategories,
  walletReviewCategoryGroups,
  walletReviewCategoryScanState,
} from './reviewCategories';
import { walletReviewReasonDefinitions } from './reviewCategoryDefinitions';
import {
  buildWalletReview,
  type WalletReviewItem,
} from '../../../../../Core/Workspace/Wallets/walletReview';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { applyBatchLabel } from '../../../../../Core/Workspace/Annotations/batchMetadata';
import { saveCounterparty } from '../../../../../Core/Workspace/Counterparties/counterparties';
import { addressToScriptHash } from '../../../../../Core/Bitcoin';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { Transaction } from '../../../../../Core/ChainData';

const id = (n: number) => n.toString(16).padStart(64, '0');
const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const external = bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'bc');
const script = (value: string) => bytesToHex(bitcoinAddress.toOutputScript(value));
const makeItem = (n: number, overrides: Partial<WalletReviewItem> = {}): WalletReviewItem => ({
  kind: 'annotation-goal',
  goal: 'coin-context',
  satisfied: false,
  contextSubjects: [],
  key: `wallet|goal:coin-context|out:${id(n)}:0`,
  txid: id(n),
  transactionIds: [id(n)],
  nodeId: `out:${id(n)}:0`,
  nodeIds: [`out:${id(n)}:0`],
  subjectIds: [`out:${id(n)}:0`],
  scope: 'utxos',
  reason: 'current-utxo',
  title: 'Coin context',
  detail: '',
  label: '',
  tags: [],
  evidence: 'unchanged',
  status: 'open',
  changed: false,
  ...overrides,
});

function receiptFixture() {
  const workspace = createWorkspace('Categories', 'mainnet');
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Fixture wallet',
    key: '',
    color: '#27c4a7',
    scriptType: 'p2wpkh',
    addresses: [
      {
        address,
        scripthash: addressToScriptHash(address, 'mainnet'),
        path: 'account/0/0',
        branch: 0,
        index: 0,
      },
    ],
  };
  const parent: Transaction = {
    txid: id(9),
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: script(external) } }],
  };
  const receipt: Transaction = {
    txid: id(1),
    vin: [{ txid: parent.txid, vout: 0 }],
    vout: [{ n: 0, value: 0.9, scriptPubKey: { hex: script(address) } }],
  };
  workspace.wallets.definitions = [wallet];
  workspace.chainData.transactions = { [parent.txid]: parent, [receipt.txid]: receipt };
  const options = {
    utxos: [
      {
        txid: receipt.txid,
        vout: 0,
        valueSats: 90_000_000,
        height: 0,
        address,
        scripthash: wallet.addresses[0].scripthash,
      },
    ],
  };
  return { workspace, wallet, receipt, options };
}

function counts(workspace: ReturnType<typeof createWorkspace>, items: WalletReviewItem[]) {
  return Object.fromEntries(
    walletReviewCategories(workspace, items).map((category) => [category.id, category.count]),
  );
}

describe('discoverable wallet review reasons', () => {
  it('offers context goals and registry tools without mandatory field or legacy acknowledgment filters', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const groups = walletReviewCategoryGroups(workspace, []);
    const catalog = walletReviewCategories(workspace, []);
    expect(new Set(groups.map((group) => group.label))).toEqual(
      new Set(['Review items', 'Privacy patterns', 'Value and structure', 'Imported wallets']),
    );
    expect(new Set(catalog.map((category) => category.id))).toEqual(
      new Set([
        'wallet-transaction',
        'current-utxo',
        'address-description',
        'source-address',
        'destination-address',
        ...analysisTools.map((tool) => `heuristic:${tool.id}`),
      ]),
    );
    expect(new Set(catalog.map((category) => category.id)).size).toBe(catalog.length);
    expect(
      catalog.every((category) => category.count === 0 && category.label && category.description),
    ).toBe(true);
    expect(catalog.find((category) => category.id === 'current-utxo')).toMatchObject({
      label: 'Coin description',
    });
    expect(catalog.find((category) => category.id === 'source-address')).toMatchObject({
      label: 'Sender',
    });
    for (const tool of analysisTools)
      expect(catalog.find((category) => category.id === `heuristic:${tool.id}`)).toMatchObject({
        algorithm: tool.id,
        kind: tool.kind,
        heuristic: true,
      });
    expect(walletReviewCategoryScanState(workspace)).toMatchObject({
      status: 'not-scanned',
      partial: true,
    });
    expect(
      walletReviewCategoryScanState(workspace).tools.every((tool) => tool.status === 'not-scanned'),
    ).toBe(true);
  });

  it('counts transaction groups once per reason while matching selected reasons as a union', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const coin = makeItem(1);
    const secondCoin = makeItem(2, {
      key: `${coin.key}:second`,
      txid: id(1),
      transactionIds: [id(1)],
    });
    const activity = makeItem(3, {
      goal: 'activity-context',
      reason: 'wallet-transaction',
      txid: id(1),
      transactionIds: [id(1)],
    });
    const receipt = makeItem(4, {
      goal: 'counterparty-context',
      reason: 'source-address',
      relationshipKinds: ['source'],
      txid: id(1),
      transactionIds: [id(1)],
    });
    const payment = makeItem(5, {
      goal: 'counterparty-context',
      reason: 'destination-address',
      relationshipKinds: ['destination'],
    });
    const items = [coin, secondCoin, activity, receipt, payment];
    const catalog = walletReviewCategories(workspace, items);
    expect(counts(workspace, items)).toMatchObject({
      'current-utxo': 1,
      'wallet-transaction': 1,
      'source-address': 1,
      'destination-address': 1,
    });
    expect(
      items.filter((item) =>
        matchesReviewCategories(item, ['current-utxo', 'destination-address'], workspace),
      ),
    ).toEqual([coin, secondCoin, payment]);
    expect(matchesReviewCategories(receipt, new Set(['source-address']), workspace)).toBe(true);
    expect(matchesReviewCategories(receipt, ['destination-address'], workspace)).toBe(false);
    expect(items.filter((item) => matchesReviewCategories(item, [], workspace))).toEqual([]);
    expect(
      items.filter((item) => matchesReviewCategories(item, ['unsupported'], workspace)),
    ).toEqual([]);
    expect(
      items.every((item) =>
        matchesReviewCategories(
          item,
          catalog.map((category) => category.id),
          workspace,
        ),
      ),
    ).toBe(true);
  });

  it('uses supplied Core groups for findings with multiple transaction contexts and repeated scopes', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const first = makeItem(1, {
      key: 'wallet|link|first',
      kind: 'finding',
      goal: undefined,
      reason: 'link',
      algorithm: 'cioh-v2',
      txid: id(1),
      transactionIds: [id(1), id(2)],
    });
    const projection = { ...first, scope: 'relationships' as const };
    const second = makeItem(3, {
      key: 'wallet|link|second',
      kind: 'finding',
      goal: undefined,
      reason: 'link',
      algorithm: 'cioh-v2',
      txid: id(3),
      transactionIds: [id(2), id(3)],
    });
    const groups = [{ key: `tx:${id(2)}`, items: [first, second] }];
    expect(
      walletReviewCategories(workspace, [first, projection, second], groups).find(
        (category) => category.id === 'heuristic:cioh',
      )?.count,
    ).toBe(1);
    expect(
      walletReviewCategories(workspace, [first, projection]).find(
        (category) => category.id === 'heuristic:cioh',
      )?.count,
    ).toBe(1);
  });

  it('uses linked receipt context without creating missing-label or optional-tag tasks', () => {
    const { workspace, wallet, receipt, options } = receiptFixture();
    const edited = applyBatchLabel(workspace, [`tx:${receipt.txid}`], 'Recognized receipt');
    const review = buildWalletReview(edited, wallet, options);
    const coin = review.items.find((item) => item.goal === 'coin-context')!;
    expect(coin).toMatchObject({
      satisfied: true,
      status: 'resolved',
      contextSubjects: [`tx:${receipt.txid}`],
      tags: [],
    });
    expect(edited.annotations.entities[coin.nodeId]).toBeUndefined();
    expect(edited.wallets.reviews).toBeUndefined();
    const openItems = review.items.filter(
      (item) => !item.satisfied && (item.changed || item.status === 'open'),
    );
    expect(
      walletReviewCategories(edited, openItems, review.groups).find(
        (category) => category.id === 'current-utxo',
      )?.count,
    ).toBe(0);
    expect(
      walletReviewCategories(edited, review.items, review.groups).find(
        (category) => category.id === 'current-utxo',
      )?.count,
    ).toBe(1);
    expect(matchesReviewCategories(coin, ['current-utxo'], edited)).toBe(true);
    expect(
      matchesReviewCategories(
        coin,
        ['utxo-missing-label', 'utxo-missing-tags', 'utxo-unidentified'],
        edited,
      ),
    ).toBe(false);
  });

  it('recognizes resolved relationship goals from explicit counterparties without labeling every address', () => {
    const { workspace, wallet, receipt, options } = receiptFixture();
    const partyId = '40000000-0000-4000-8000-000000000001';
    const edited = saveCounterparty(
      workspace,
      { id: partyId, name: 'Fixture sender' },
      {
        kind: 'wallet-transaction',
        walletId: wallet.id,
        transactionId: receipt.txid,
        direction: 'received',
        walletOutputIds: [`out:${receipt.txid}:0`],
      },
    );
    const review = buildWalletReview(edited, wallet, options);
    const relationship = review.items.find((item) => item.goal === 'counterparty-context')!;
    expect(relationship).toMatchObject({
      satisfied: true,
      status: 'resolved',
      contextSubjects: [`party:${partyId}`],
    });
    expect(edited.annotations.entities[`addr:${external}`]).toBeUndefined();
    expect(edited.wallets.reviews).toBeUndefined();
    expect(matchesReviewCategories(relationship, ['source-address'], edited)).toBe(true);
    expect(matchesReviewCategories(relationship, ['unidentified-sources'], edited)).toBe(false);
    const openItems = review.items.filter((item) => !item.satisfied);
    expect(openItems.some((item) => item.goal === 'activity-context')).toBe(true);
    expect(
      walletReviewCategories(edited, openItems, review.groups)
        .filter((category) => !['wallet-transaction', 'address-description'].includes(category.id))
        .every((category) => category.count === 0),
    ).toBe(true);
  });

  it('retains truthful legacy definitions without adding prior acknowledgments to active categories', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    workspace.wallets.reviews = {
      'wallet|funding-source|old': {
        status: 'unknown',
        at: '2026-09-01T00:00:00.000Z',
        evidence: 'saved',
      },
    };
    for (const reason of ['wallet-address', 'source', 'funding-source', 'counterparty'] as const) {
      expect(walletReviewReasonDefinitions[reason].filter).toBe(false);
      expect(walletReviewReasonDefinitions[reason].description).toContain('original meaning');
      const legacy = makeItem(1, { goal: undefined, reason, legacyOutputReview: true });
      expect(matchesReviewCategories(legacy, [reason, 'saved-output-reviews'], workspace)).toBe(
        false,
      );
    }
    expect(
      walletReviewCategories(workspace, []).some(
        (category) => category.id === 'saved-output-reviews',
      ),
    ).toBe(false);
    expect(workspace.wallets.reviews['wallet|funding-source|old'].status).toBe('unknown');
  });

  it('filters registered Analysis findings by tool and keeps older or unknown ones conditional', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const finding = {
      id: 'cioh:fixture',
      algorithm: 'cioh-v2',
      title: 'Possible group',
      description: 'Hypothesis',
      nodeIds: [`out:${id(1)}:0`],
      txids: [id(2)],
      createdAt: '2026-09-09T00:00:00.000Z',
      kind: 'hypothesis' as const,
    };
    workspace.analysis.findings = [finding];
    const item = makeItem(1, {
      key: `wallet|link|${finding.id}`,
      kind: 'finding',
      goal: undefined,
      reason: 'link',
    });
    const catalog = walletReviewCategories(workspace, [item]);
    expect(catalog.find((category) => category.id === 'heuristic:cioh')?.count).toBe(1);
    expect(catalog.find((category) => category.id === 'link')).toBeUndefined();
    expect(catalog.find((category) => category.id === 'older-or-unknown-findings')).toBeUndefined();
    expect(
      matchesReviewCategories(
        { ...item, algorithm: 'unrelated-cioh-v2' },
        ['heuristic:cioh'],
        workspace,
      ),
    ).toBe(false);
    const supportedOlderVersion = makeItem(4, {
      key: 'wallet|link|cioh-v1',
      kind: 'finding',
      goal: undefined,
      reason: 'link',
      algorithm: 'cioh-v1',
    });
    expect(matchesReviewCategories(supportedOlderVersion, ['heuristic:cioh'], workspace)).toBe(
      true,
    );
    const older = makeItem(2, {
      key: 'wallet|link|older',
      kind: 'finding',
      goal: undefined,
      reason: 'link',
      algorithm: 'retired-tool-v1',
    });
    const unknown = makeItem(3, {
      key: 'wallet|link|unknown',
      kind: 'finding',
      goal: undefined,
      reason: 'link',
    });
    const legacyCatalog = walletReviewCategories(workspace, [
      item,
      supportedOlderVersion,
      older,
      unknown,
    ]);
    expect(legacyCatalog.find((category) => category.id === 'heuristic:cioh')?.count).toBe(2);
    expect(
      legacyCatalog.find((category) => category.id === 'older-or-unknown-findings'),
    ).toMatchObject({ label: 'Older or unknown findings', count: 2 });
    expect(matchesReviewCategories(item, ['older-or-unknown-findings'], workspace)).toBe(false);
    expect(matchesReviewCategories(older, ['older-or-unknown-findings'], workspace)).toBe(true);
    expect(matchesReviewCategories(unknown, ['older-or-unknown-findings'], workspace)).toBe(true);
    expect(walletReviewCategoryScanState(workspace)).toMatchObject({
      status: 'saved-findings',
      partial: true,
    });
    const scan: AnalysisScan = {
      scope: { kind: 'workspace', label: 'Loaded workspace', explanation: '', txids: [id(2)] },
      options: {},
      findings: [],
      runAt: '2026-09-09T01:00:00.000Z',
      reports: analysisTools.map((tool) => ({
        toolId: tool.id,
        status: 'complete',
        message: 'Completed',
      })),
    };
    expect(walletReviewCategoryScanState(workspace, scan)).toMatchObject({
      status: 'scanned',
      runAt: scan.runAt,
      partial: false,
    });
    scan.reports[0].status = 'error';
    expect(walletReviewCategoryScanState(workspace, scan).partial).toBe(true);
  });
});
