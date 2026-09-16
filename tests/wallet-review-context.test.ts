import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  buildWalletReviewContext,
  orderWalletContextTransactions,
} from '../src/App/Workspace/Workbenches/Wallet/walletReviewContext';
import { matchRelatedEntities } from '../src/App/Workspace/Workbenches/Wallet/walletRelatedSelection';
import { buildWalletReview, type WalletReviewItem } from '../src/Domain/Wallet/walletReview';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { outputNodeId, type Transaction, type Wallet, type Workspace } from '../src/Domain/types';
import { addressToScriptHash } from '../src/Domain/Wallet/wallet';

const id = (n: number) => n.toString(16).padStart(64, '0');
const address = (n: number, prefix = 'bc') =>
  bitcoinAddress.toBech32(new Uint8Array(20).fill(n), 0, prefix);
const mine = address(1);
const other = address(2);
const script = (value: string) =>
  bytesToHex(
    bitcoinAddress.toOutputScript(
      value,
      value.startsWith('tb1') ? networks.testnet : networks.bitcoin,
    ),
  );
const wallet: Wallet = {
  id: 'review-wallet',
  name: 'Public fixture',
  key: '',
  color: '#27c4a7',
  scriptType: 'p2wpkh',
  addresses: [
    {
      address: mine,
      scripthash: addressToScriptHash(mine, 'mainnet'),
      branch: 0,
      index: 0,
      path: 'account/0/0',
      history: [{ tx_hash: id(3), height: 1 }],
    },
  ],
};
const parent: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: [
    { n: 0, value: 1, scriptPubKey: { hex: script(mine) } },
    { n: 2, value: 2, scriptPubKey: { hex: script(other), address: mine } },
  ],
};
const shared: Transaction = {
  txid: id(3),
  vin: [
    { txid: id(1), vout: 0 },
    { txid: id(1), vout: 2 },
    { txid: id(9), vout: 0 },
  ],
  vout: [
    { n: 0, value: 0.9, scriptPubKey: { hex: script(mine), address: other } },
    { n: 1, value: 2, scriptPubKey: { hex: script(other), address: mine } },
  ],
};
function fixture(): Workspace {
  return {
    ...newWorkspace('Public review fixture', 'mainnet'),
    wallets: [wallet],
    transactions: { [parent.txid]: parent, [shared.txid]: shared },
  };
}
function item(
  nodeId = outputNodeId(shared.txid, 0),
  overrides: Partial<WalletReviewItem> = {},
): WalletReviewItem {
  return {
    key: 'review',
    reason: 'current-utxo',
    title: 'Review',
    detail: '',
    nodeId,
    nodeIds: [nodeId],
    txid: shared.txid,
    label: '',
    tags: [],
    evidence: '',
    status: 'open',
    changed: false,
    ...overrides,
  };
}

describe('wallet selected review context', () => {
  it('opens the newest observed context first, including mempool activity', () => {
    const transactions = new Map<string, Transaction>([
      [id(1), { ...parent, blockHeight: 800000, blocktime: 100 }],
      [id(2), { ...parent, txid: id(2), blockHeight: 800002, blocktime: 102 }],
      [id(3), { ...shared, blockHeight: 800001, blocktime: 101 }],
      [id(4), { ...parent, txid: id(4), mempool: true }],
    ]);
    const ids = [id(1), id(3), id(2), id(4)];
    expect(orderWalletContextTransactions(ids, transactions)).toEqual([id(4), id(2), id(3), id(1)]);
    expect(ids).toEqual([id(1), id(3), id(2), id(4)]);
    transactions.delete(id(4));
    expect(orderWalletContextTransactions(ids, transactions)).toEqual([id(2), id(3), id(1), id(4)]);
  });

  it('uses saved times when heights are unavailable and keeps undated contexts deterministic', () => {
    const transactions = new Map<string, Transaction>([
      [id(1), { ...parent, blocktime: 100 }],
      [id(2), { ...parent, txid: id(2), time: 200 }],
      [id(3), shared],
    ]);
    expect(orderWalletContextTransactions([id(4), id(3), id(1), id(2)], transactions)).toEqual([
      id(2),
      id(1),
      id(3),
      id(4),
    ]);
    expect(orderWalletContextTransactions([], transactions)).toEqual([]);
    expect(transactions.get(id(3))?.blocktime).toBeUndefined();
  });

  it('shows a direct funding subject as the selected canonical input in an explicit receiving context', () => {
    const context = buildWalletReviewContext(
      fixture(),
      wallet,
      { nodeId: `OUT:${id(1).toUpperCase()}:02`, reason: 'funding-source' },
      id(3),
    );
    expect(context).toMatchObject({
      status: 'loaded',
      transactionId: id(3),
      transactionNodeId: `tx:${id(3)}`,
      selectedNodeId: outputNodeId(id(1), 2),
      selectedSide: 'input',
      transactionSelected: false,
    });
    expect(context.selected).toBe(context.inputs[1]);
    expect(context.inputs[1]).toMatchObject({
      id: outputNodeId(id(1), 2),
      address: other,
      selected: true,
      missing: false,
    });
    expect(context.outputs.some((entry) => entry.selected)).toBe(false);
    expect(context.role).not.toBe('possible-counterparty');
    const missing = buildWalletReviewContext(
      fixture(),
      wallet,
      { nodeId: outputNodeId(id(9), 0) },
      id(3),
    );
    expect(missing.selected).toBe(missing.inputs[2]);
    expect(missing.selected).toMatchObject({ missing: true, selected: true });
  });

  it('requires an explicit address transaction and selects all actual matching inputs and outputs', () => {
    const subject = { nodeId: `addr:${mine.toUpperCase()}`, txid: id(3) };
    const unresolved = buildWalletReviewContext(fixture(), wallet, subject);
    expect(unresolved.status).toBe('unavailable');
    expect(unresolved.transactionId).toBeUndefined();
    const selected = buildWalletReviewContext(fixture(), wallet, subject, id(3));
    expect(selected.selectedNodeId).toBe(`addr:${mine}`);
    expect(selected.selected).toBeUndefined();
    expect(selected.inputs.filter((entry) => entry.selected).map((entry) => entry.id)).toEqual([
      outputNodeId(id(1), 0),
    ]);
    expect(selected.outputs.filter((entry) => entry.selected).map((entry) => entry.id)).toEqual([
      outputNodeId(id(3), 0),
    ]);
    const transaction = buildWalletReviewContext(fixture(), wallet, { nodeId: `tx:${id(3)}` });
    expect(transaction.transactionSelected).toBe(true);
    expect(transaction.selectedNodeId).toBe(`tx:${id(3)}`);
    expect(buildWalletReviewContext(fixture(), wallet, subject, 'bad').status).toBe('unavailable');
  });

  it('does not treat a non-address raw script as a known external subject', () => {
    const workspace = fixture();
    workspace.transactions[id(3)] = {
      ...shared,
      vout: [{ n: 0, value: 0, scriptPubKey: { hex: '6a00', address: mine } }],
    };
    expect(
      buildWalletReviewContext(workspace, wallet, { nodeId: outputNodeId(id(3), 0) }).selected,
    ).toMatchObject({
      ownership: 'unknown',
      missing: false,
      address: undefined,
      scriptPubKey: { hex: '6a00', address: mine },
    });
  });

  it.each(['6a', '6a03414243', '6a03ff0041', '6a0341', '51'])(
    'retains loaded script %s for presentation without changing ownership',
    (hex) => {
      const workspace = fixture();
      const output = { n: 0, value: 0, scriptPubKey: { hex } };
      workspace.transactions[id(3)] = { ...shared, vout: [output] };
      const context = buildWalletReviewContext(workspace, wallet, item());
      expect(context.outputs[0].scriptPubKey).toBe(output.scriptPubKey);
      expect(context.outputs[0]).toMatchObject({ ownership: 'unknown', missing: false });
      expect(context.inputs[0].scriptPubKey).toBe(parent.vout[0].scriptPubKey);
    },
  );

  it('updates script presentation with late prevout evidence and withholds conflicting scripts', () => {
    const workspace = fixture();
    delete workspace.transactions[parent.txid];
    workspace.transactions[shared.txid] = { ...shared, vin: [{ txid: parent.txid, vout: 0 }] };
    const input = () => buildWalletReviewContext(workspace, wallet, item()).inputs[0];
    expect(input()).toMatchObject({ missing: true, scriptPubKey: undefined });
    const scriptPubKey = { hex: '51' };
    workspace.transactions[shared.txid].vin[0].prevout = { value: 1, scriptPubKey };
    expect(input()).toMatchObject({ missing: false, prevoutStatus: 'attached', scriptPubKey });
    expect(input().scriptPubKey).toBe(scriptPubKey);
    workspace.transactions[parent.txid] = parent;
    expect(input()).toMatchObject({
      missing: true,
      prevoutStatus: 'conflict',
      scriptPubKey: undefined,
    });
  });

  it('keeps shared-transaction ownership at output level and decodes authoritative scripts', () => {
    const context = buildWalletReviewContext(fixture(), wallet, item());
    expect(context.status).toBe('loaded');
    expect(context.inputs.map((input) => input.ownership)).toEqual([
      'wallet',
      'external',
      'unknown',
    ]);
    expect(context.inputs[1]).toMatchObject({
      id: outputNodeId(id(1), 2),
      address: other,
      valueSats: 200_000_000,
    });
    expect(context.outputs.map((output) => output.ownership)).toEqual(['wallet', 'external']);
    expect(context.selected).toMatchObject({ address: mine, ownership: 'wallet', selected: true });
    expect(context.role).toBe('wallet-output');
    expect(context.missingPrevouts).toBe(1);
    expect(context.inputs[2]).toMatchObject({ missing: true, ownership: 'unknown' });
    expect(context.inputs[2].valueSats).toBeUndefined();
    expect(buildWalletReviewContext(fixture(), wallet, item(outputNodeId(id(3), 1))).role).toBe(
      'possible-counterparty',
    );
    const activity = buildWalletReviewContext(
      fixture(),
      wallet,
      item(`tx:${id(3)}`, { reason: 'new-activity' }),
    );
    expect(activity.role).toBe('wallet-related-transaction');
    expect(activity.selected).toBeUndefined();
  });

  it('does not label every output of an incoming batch a possible counterparty', () => {
    const workspace = fixture();
    workspace.transactions[id(3)] = { ...shared, vin: [{ txid: id(1), vout: 2 }] };
    expect(buildWalletReviewContext(workspace, wallet, item(outputNodeId(id(3), 1))).role).toBe(
      'unknown-output',
    );
  });

  it('rejects mismatched wallet claims and never falls back from malformed raw scripts', () => {
    const claimed = {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], scripthash: addressToScriptHash(other, 'mainnet') }],
    };
    expect(buildWalletReviewContext(fixture(), claimed, item()).selected?.ownership).toBe(
      'external',
    );
    const workspace = fixture();
    workspace.transactions[id(3)] = {
      ...shared,
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: 'broken', address: mine } }],
    };
    const selected = buildWalletReviewContext(workspace, wallet, item()).selected;
    expect(selected).toMatchObject({ ownership: 'unknown', missing: false });
    expect(selected?.address).toBeUndefined();
  });

  it('validates address-only outputs against the workspace network', () => {
    const workspace = fixture();
    workspace.transactions[id(3)] = {
      ...shared,
      vout: [
        { n: 0, value: 1, scriptPubKey: { address: mine } },
        { n: 1, value: 1, scriptPubKey: { address: address(1, 'tb') } },
      ],
    };
    expect(
      buildWalletReviewContext(workspace, wallet, item()).outputs.map((output) => output.ownership),
    ).toEqual(['wallet', 'unknown']);
    const testnet = { ...workspace, network: 'testnet4' as const };
    const testWallet = {
      ...wallet,
      addresses: [
        {
          ...wallet.addresses[0],
          address: address(1, 'tb'),
          scripthash: addressToScriptHash(address(1, 'tb'), 'testnet4'),
        },
      ],
    };
    expect(
      buildWalletReviewContext(testnet, testWallet, item()).outputs.map(
        (output) => output.ownership,
      ),
    ).toEqual(['unknown', 'wallet']);
  });

  it('reports missing creating transactions without promoting imported item claims to output facts', () => {
    const context = buildWalletReviewContext(
      fixture(),
      wallet,
      item(outputNodeId(id(8), 0), { address: mine, amountSats: 99 }),
    );
    expect(context).toMatchObject({
      status: 'missing',
      transactionId: id(8),
      inputs: [],
      outputs: [],
      currentOutputs: [],
      role: 'unknown-output',
    });

    expect(context.selected).toMatchObject({
      id: outputNodeId(id(8), 0),
      ownership: 'unknown',
      missing: true,
      selected: true,
    });
    expect(context.selected?.valueSats).toBeUndefined();
    expect(context.selected?.address).toBeUndefined();
    expect(
      buildWalletReviewContext(fixture(), wallet, item('invalid', { txid: undefined })).status,
    ).toBe('unavailable');
    const coinbase = buildWalletReviewContext(fixture(), wallet, item(outputNodeId(id(1), 0)));
    expect(coinbase.inputs[0]).toMatchObject({
      coinbase: true,
      missing: false,
      ownership: 'unknown',
    });
    expect(coinbase.missingPrevouts).toBe(0);
  });

  it('uses attached input evidence without treating the parent transaction as loaded', () => {
    const workspace = fixture();
    delete workspace.transactions[parent.txid];
    workspace.transactions[shared.txid] = {
      ...shared,
      vin: [
        {
          txid: parent.txid,
          vout: 0,
          prevout: { value: 1, scriptPubKey: { hex: script(mine) } },
        },
        ...shared.vin.slice(1),
      ],
    };
    const context = buildWalletReviewContext(
      workspace,
      wallet,
      item(outputNodeId(parent.txid, 0), { txid: parent.txid }),
    );
    expect(context.status).toBe('missing');
    expect(context.selected).toMatchObject({
      valueSats: 100_000_000,
      ownership: 'wallet',
      missing: false,
      prevoutStatus: 'attached',
    });
    const spendingContext = buildWalletReviewContext(
      workspace,
      wallet,
      item(`tx:${shared.txid}`, { reason: 'new-activity' }),
    );
    expect(spendingContext.inputs[0]).toMatchObject({
      ownership: 'wallet',
      missing: false,
      prevoutStatus: 'attached',
    });
  });

  it('preserves all rows and canonical metadata references for compact presentation', () => {
    const workspace = fixture();
    workspace.transactions[id(3)] = {
      ...shared,
      vout: Array.from({ length: 80 }, (_, n) => ({
        n,
        value: n / 100,
        scriptPubKey: { hex: script(mine) },
      })),
    };
    workspace.annotations[outputNodeId(id(3), 79)] = {
      label: 'Imported receipt',
      note: 'Human context',
      icon: 'gift',
      bookmarked: false,
    };
    const before = JSON.stringify(workspace);
    const context = buildWalletReviewContext(workspace, wallet, item(outputNodeId(id(3), 79)));
    expect(context.outputs).toHaveLength(80);
    expect(
      context.outputs.filter((output) => output.selected).map((output) => output.vout),
    ).toEqual([79]);
    expect(workspace.annotations[context.selected!.id].icon).toBe('gift');
    expect(JSON.stringify(workspace)).toBe(before);
  });

  it('exposes source targets only when explicitly listed, wallet matched, and directly spending the receipt', () => {
    const workspace = fixture();
    const review = buildWalletReview(workspace, wallet, {
      utxos: [
        {
          txid: id(3),
          vout: 0,
          valueSats: 90_000_000,
          height: 1,
          address: mine,
          scripthash: wallet.addresses[0].scripthash,
        },
      ],
    });
    const source = review.items.find((entry) => entry.reason === 'source')!;
    expect(source.nodeIds).toEqual([outputNodeId(id(1), 0), outputNodeId(id(3), 0)]);
    expect(
      buildWalletReviewContext(workspace, wallet, source).currentOutputs.map((entry) => entry.id),
    ).toEqual([outputNodeId(id(3), 0)]);
    const unrelated: Transaction = {
      txid: id(4),
      vin: [{ txid: id(7), vout: 0 }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: script(mine) } }],
    };
    workspace.transactions[unrelated.txid] = unrelated;
    const expanded = {
      ...source,
      nodeIds: [
        ...source.nodeIds,
        outputNodeId(id(3), 1),
        outputNodeId(id(4), 0),
        outputNodeId(id(8), 0),
        outputNodeId(id(3), 0),
        'invalid',
      ],
    };
    expect(
      buildWalletReviewContext(workspace, wallet, expanded).currentOutputs.map((entry) => entry.id),
    ).toEqual([outputNodeId(id(3), 0)]);
    expect(
      buildWalletReviewContext(workspace, wallet, { ...source, nodeIds: [source.nodeId] })
        .currentOutputs,
    ).toEqual([]);
  });
});

describe('explicit related entity selection', () => {
  const candidates = [
    { id: 'first', address: mine, txid: id(1) },
    { id: 'same-address', address: mine, txid: id(2) },
    { id: 'same-transaction', address: other, txid: id(1) },
    { id: 'unrelated', address: other, txid: id(3) },
    { id: 'unknown' },
  ];
  it('matches only the requested relation in the supplied candidate set', () => {
    expect(matchRelatedEntities(candidates, [candidates[0]], 'address')).toEqual([
      'first',
      'same-address',
    ]);
    expect(matchRelatedEntities(candidates, [candidates[0]], 'transaction')).toEqual([
      'first',
      'same-transaction',
    ]);
    expect(matchRelatedEntities(candidates.slice(1), [candidates[0]], 'transaction')).toEqual([
      'same-transaction',
    ]);
    expect(matchRelatedEntities(candidates, [{ id: 'unknown' }], 'address')).toEqual([]);
    expect(matchRelatedEntities(candidates, [], 'transaction')).toEqual([]);
  });
  it('does not widen through related matches, labels, partial identifiers or missing values', () => {
    expect(
      matchRelatedEntities(candidates, [{ id: 'first', address: mine.slice(0, -1) }], 'address'),
    ).toEqual([]);
    expect(
      matchRelatedEntities(candidates, [{ id: 'first', address: mine.toUpperCase() }], 'address'),
    ).toEqual([]);
    expect(
      matchRelatedEntities([...candidates, candidates[0]], [candidates[0]], 'transaction'),
    ).toEqual(['first', 'same-transaction']);
  });
});
