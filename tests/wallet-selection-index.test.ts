import { describe, expect, it } from 'vitest';
import { newWorkspace } from '../src/domain/workspace';
import { addressToScriptHash } from '../src/lib/wallet';
import { type Transaction, type Wallet, type Workspace } from '../src/domain/types';
import { buildWalletReviewContext } from '../src/domain/walletReviewContext';
import { walletRelatedRecords } from '../src/domain/walletRelatedRecords';
import {
  walletRowRelationship,
  walletRowWithContext,
  type WalletRow,
} from '../src/domain/walletWorkbenchRows';
import {
  buildWalletSelectionAddresses,
  buildWalletSelectionIndex,
} from '../src/domain/walletSelectionIndex';
import {
  RECEIVE_ADDRESS,
  SECOND_ADDRESS,
  PUBLIC_ZPUB,
  TX_FUNDING,
  TX_SPENDING,
  transactions,
} from './fixtures/bitcoin';

function fixture(): Workspace {
  const wallet: Wallet = {
    id: 'selection-wallet',
    name: 'Public fixture',
    key: PUBLIC_ZPUB,
    color: '#27c4a7',
    scriptType: 'p2wpkh',
    addresses: [RECEIVE_ADDRESS, SECOND_ADDRESS].map((address, index) => ({
      address,
      scripthash: addressToScriptHash(address, 'mainnet'),
      branch: 0,
      index,
      path: `account/0/${index}`,
    })),
  };
  return {
    ...newWorkspace('Public selection fixture', 'mainnet'),
    wallets: [wallet],
    transactions: structuredClone(transactions),
  };
}

function row(nodeId: string, kind: WalletRow['kind']): WalletRow {
  return {
    key: nodeId,
    nodeId,
    kind,
    identifier: nodeId.slice(nodeId.indexOf(':') + 1),
    title: '',
    description: '',
    meta: '',
    contextTransactionIds: [],
    reviews: [],
    status: 'open',
    changed: false,
    ...(kind === 'address' ? { address: nodeId.slice(5) } : { txid: nodeId.split(':')[1] }),
  };
}

function compare(workspace: Workspace) {
  const index = buildWalletSelectionIndex(workspace);
  const wallet = workspace.wallets[0];
  const addresses = buildWalletSelectionAddresses(wallet, workspace.network);
  for (const address of [
    RECEIVE_ADDRESS,
    RECEIVE_ADDRESS.toUpperCase(),
    SECOND_ADDRESS,
    'invalid',
  ]) {
    const subject = row(`addr:${address}`, 'address');
    expect(walletRowWithContext(workspace, subject, index)).toEqual(
      walletRowWithContext(workspace, subject),
    );
    expect(walletRowRelationship(subject, wallet, workspace.network, undefined, addresses)).toBe(
      walletRowRelationship(subject, wallet, workspace.network),
    );
    // Deliberately use reverse context order: indexes must preserve supplied relation order.
    subject.contextTransactionIds = [TX_SPENDING, TX_FUNDING];
    expect(walletRelatedRecords(workspace, subject, index)).toEqual(
      walletRelatedRecords(workspace, subject),
    );
  }
  for (const subject of [
    row(`out:${TX_FUNDING}:0`, 'output'),
    row(`tx:${TX_SPENDING}`, 'transaction'),
  ]) {
    expect(
      buildWalletReviewContext(workspace, wallet, subject, TX_SPENDING, index, addresses),
    ).toEqual(buildWalletReviewContext(workspace, wallet, subject, TX_SPENDING));
    expect(walletRelatedRecords(workspace, subject, index)).toEqual(
      walletRelatedRecords(workspace, subject),
    );
  }
  return index;
}

describe('component-owned wallet selection indexes', () => {
  it('preserves exact contexts, script authority, relation order and uppercase address queries', () => {
    const workspace = fixture();
    workspace.transactions[TX_FUNDING].vout[1].scriptPubKey.address = RECEIVE_ADDRESS;
    const index = compare(workspace);
    expect(
      walletRowWithContext(
        workspace,
        row(`addr:${RECEIVE_ADDRESS.toUpperCase()}`, 'address'),
        index,
      ).contextTransactionIds,
    ).toEqual([TX_FUNDING, TX_SPENDING]);
  });

  it('resolves attached prevouts without inventing creating transactions', () => {
    const workspace = fixture();
    const { n: _, ...prevout } = workspace.transactions[TX_FUNDING].vout[0];
    workspace.transactions[TX_SPENDING].vin[0].prevout = prevout;
    delete workspace.transactions[TX_FUNDING];
    const index = compare(workspace);
    expect(index.prevouts.get(`out:${TX_FUNDING}:0`)?.status).toBe('attached');
    expect(index.transactions.has(TX_FUNDING)).toBe(false);
    expect(index.scriptTransactionIds.get(workspace.wallets[0].addresses[0].scripthash)).toEqual([
      TX_SPENDING,
    ]);
  });

  it('excludes conflicting inputs while preserving authoritative loaded-output address facts', () => {
    const workspace = fixture();
    const { n: _, ...prevout } = workspace.transactions[TX_FUNDING].vout[1];
    workspace.transactions[TX_SPENDING].vin[1].prevout = { ...prevout, value: 99 };
    const index = compare(workspace);
    expect(index.prevouts.get(`out:${TX_FUNDING}:1`)?.status).toBe('conflict');
    expect(index.scriptTransactionIds.get(workspace.wallets[0].addresses[1].scripthash)).toEqual([
      TX_FUNDING,
    ]);
  });

  it('preserves invalid-map-key exclusions and network boundaries', () => {
    const workspace = fixture();
    workspace.transactions['c'.repeat(64)] = workspace.transactions[TX_SPENDING];
    delete workspace.transactions[TX_SPENDING];
    expect(compare(workspace).transactions.has(TX_SPENDING)).toBe(false);
    workspace.network = 'testnet4';
    const index = compare(workspace);
    expect(
      buildWalletSelectionAddresses(workspace.wallets[0], workspace.network).addresses.size,
    ).toBe(0);
    expect(
      walletRowWithContext(workspace, row(`addr:${RECEIVE_ADDRESS}`, 'address'), index)
        .contextTransactionIds,
    ).toEqual([]);
  });

  it('rebuilds observation changes without modifying an earlier snapshot', () => {
    const workspace = fixture();
    const before = buildWalletSelectionIndex(workspace);
    const incoming: Transaction = structuredClone(workspace.transactions[TX_SPENDING]);
    const { n: _, ...prevout } = workspace.transactions[TX_FUNDING].vout[0];
    incoming.vin[0].prevout = { ...prevout, value: 99 };
    const updated = {
      ...workspace,
      transactions: { ...workspace.transactions, [TX_SPENDING]: incoming },
    };
    const after = compare(updated);
    expect(before.prevouts.get(`out:${TX_FUNDING}:0`)?.status).toBe('loaded');
    expect(after.prevouts.get(`out:${TX_FUNDING}:0`)?.status).toBe('conflict');
  });

  it('projects repeated selections without enumerating unrelated loaded transactions or verifying wallet addresses again', () => {
    const workspace = fixture();
    const index = buildWalletSelectionIndex(workspace);
    const addresses = buildWalletSelectionAddresses(workspace.wallets[0], workspace.network);
    const guarded = {
      ...workspace,
      transactions: new Proxy(workspace.transactions, {
        ownKeys() {
          throw new Error('Selection rescanned the workspace');
        },
      }),
    };
    const wallet = {
      ...workspace.wallets[0],
      addresses: new Proxy(workspace.wallets[0].addresses, {
        get(target, key, receiver) {
          if (key === Symbol.iterator) throw new Error('Selection reverified wallet addresses');
          return Reflect.get(target, key, receiver);
        },
      }),
    };
    for (const address of [RECEIVE_ADDRESS, SECOND_ADDRESS]) {
      const subject = walletRowWithContext(guarded, row(`addr:${address}`, 'address'), index);
      expect(walletRowRelationship(subject, wallet, guarded.network, undefined, addresses)).toBe(
        'In this wallet',
      );
      expect(walletRelatedRecords(guarded, subject, index).outputs.length).toBeGreaterThan(0);
      expect(
        buildWalletReviewContext(guarded, wallet, subject, TX_SPENDING, index, addresses).status,
      ).toBe('loaded');
    }
    expect(
      walletRelatedRecords(guarded, row(`out:${TX_FUNDING}:0`, 'output'), index).transactions,
    ).toEqual([`tx:${TX_FUNDING}`, `tx:${TX_SPENDING}`]);
  });
});
