import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  addressBalanceSats,
  indexAddressHistoryTransactions,
  listAddressHistory,
  recentAddressHistoryEntries,
  recentAddressUtxos,
  RECENT_ADDRESS_GRAPH_LIMIT,
  shouldLoadAddressHistory,
} from './addressHistory';
import { paginateAddressHistorySections } from '../TransactionFlow/addressHistorySections';
import { addressToScriptHash } from '../../../../../Core/Bitcoin';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import type { Transaction } from '../../../../../Core/ChainData';

const id = (value: number) => value.toString(16).padStart(64, '0');
const address = (value: number) => bitcoinAddress.toBech32(new Uint8Array(20).fill(value), 0, 'bc');

const received: Transaction = {
  txid: id(1),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { address: address(1) } }],
};
const spent: Transaction = {
  txid: id(2),
  vin: [{ txid: received.txid, vout: 0 }],
  vout: [{ n: 0, value: 0.9, scriptPubKey: {} }],
};

describe('address history projection', () => {
  it('keeps an observed balance distinct from missing balance', () => {
    expect(
      addressBalanceSats({
        network: 'mainnet',
        confirmedSats: 125_000,
        unconfirmedSats: -25_000,
        checkedAt: new Date().toISOString(),
      }),
    ).toBe(100_000);
    expect(addressBalanceSats(undefined)).toBeUndefined();
  });

  it('keeps unloaded history navigable and derives direction only from loaded evidence', () => {
    const target = address(1);
    const workspace = createWorkspace('Address history', 'mainnet');
    workspace.chainData.transactions = { [received.txid]: received, [spent.txid]: spent };
    workspace.chainData.addressHistories = {
      [target]: {
        history: [
          { tx_hash: id(3), height: 20 },
          { tx_hash: spent.txid, height: 10 },
          { tx_hash: received.txid, height: 5 },
        ],
        truncated: true,
      },
    };
    workspace.view.graphNodeIds = [`tx:${received.txid}`];
    workspace.view.hiddenNodeIds = [`tx:${spent.txid}`];

    const result = listAddressHistory(workspace, target)!;
    expect(result).toMatchObject({
      knownCount: 3,
      loadedCount: 2,
      unloadedCount: 1,
      complete: false,
      source: 'address history',
    });
    expect(result.entries.map((entry) => [entry.txid, entry.direction])).toEqual([
      [id(3), 'unknown'],
      [spent.txid, 'spent'],
      [received.txid, 'received'],
    ]);
    expect(result.entries.find((entry) => entry.txid === received.txid)).toMatchObject({
      receivedSats: 100_000_000,
      onGraph: true,
      hidden: false,
    });
    expect(result.entries.find((entry) => entry.txid === spent.txid)).toMatchObject({
      spentSats: 100_000_000,
      onGraph: false,
      hidden: true,
    });
  });

  it('uses verified wallet history when a direct address observation is absent', () => {
    const target = address(2);
    const workspace = createWorkspace('Wallet address history', 'mainnet');
    workspace.wallets.definitions = [
      {
        id: crypto.randomUUID(),
        name: 'Fixture wallet',
        key: '',
        scriptType: 'p2wpkh',
        color: '#112233',
        addresses: [
          {
            address: target,
            scripthash: addressToScriptHash(target, 'mainnet'),
            path: 'account/0/0',
            index: 0,
            branch: 0,
            history: [{ tx_hash: id(4), height: 0 }],
          },
        ],
        scanComplete: false,
      },
    ];
    const result = listAddressHistory(workspace, target)!;
    expect(result.source).toBe('wallet history');
    expect(result.complete).toBe(false);
    expect(result.entries[0]).toMatchObject({ txid: id(4), mempool: true });
  });

  it('requests a network check for missing, empty, or loaded-only history', () => {
    const workspace = createWorkspace('Address history refresh', 'mainnet');
    const target = address(3);
    const empty = listAddressHistory(
      {
        ...workspace,
        chainData: {
          ...workspace.chainData,
          addressHistories: { [target]: { history: [], truncated: false } },
        },
      },
      target,
    );
    expect(shouldLoadAddressHistory(undefined)).toBe(true);
    expect(shouldLoadAddressHistory(empty)).toBe(true);
    const loadedOnlyEntry = {
      txid: id(5),
      height: 1,
      mempool: false,
      direction: 'unknown' as const,
      onGraph: false,
      hidden: false,
    };
    expect(
      shouldLoadAddressHistory({
        ...empty!,
        entries: [loadedOnlyEntry],
        knownCount: 1,
        loadedCount: 1,
        unloadedCount: 0,
        source: 'loaded transactions',
      }),
    ).toBe(true);
    expect(
      shouldLoadAddressHistory({
        ...empty!,
        entries: [{ ...loadedOnlyEntry, txid: id(6) }],
        knownCount: 1,
        loadedCount: 0,
        unloadedCount: 1,
        source: 'address history',
      }),
    ).toBe(false);
  });

  it('orders recent graph items with pending and newest heights first', () => {
    const entries = recentAddressHistoryEntries({
      address: address(4),
      entries: [
        {
          txid: id(2),
          height: 0,
          mempool: true,
          direction: 'unknown',
          onGraph: false,
          hidden: false,
        },
        {
          txid: id(3),
          height: 12,
          mempool: false,
          direction: 'unknown',
          onGraph: false,
          hidden: false,
        },
        {
          txid: id(1),
          height: 10,
          mempool: false,
          direction: 'unknown',
          onGraph: false,
          hidden: false,
        },
      ],
      knownCount: 3,
      loadedCount: 0,
      unloadedCount: 3,
      complete: true,
      source: 'address history',
    });
    expect(entries.map(({ txid }) => txid)).toEqual([id(2), id(3), id(1)]);

    const utxos = recentAddressUtxos({
      network: 'mainnet',
      checkedAt: new Date().toISOString(),
      utxos: [
        { txid: id(1), vout: 0, valueSats: 1, height: 100 },
        { txid: id(2), vout: 0, valueSats: 1, height: 0 },
        { txid: id(3), vout: 0, valueSats: 1, height: 110 },
      ],
    });
    expect(utxos.map(({ txid }) => txid)).toEqual([id(2), id(3), id(1)]);
    expect(
      recentAddressUtxos({ network: 'mainnet', checkedAt: new Date().toISOString(), utxos: [] }, 0),
    ).toEqual([]);
    expect(RECENT_ADDRESS_GRAPH_LIMIT).toBe(10);
  });

  it('keeps expanded sections represented within a bounded pending-first page', () => {
    const page = paginateAddressHistorySections(
      [
        { items: ['pending-1', 'pending-2', 'pending-3'], collapsed: false },
        { items: ['confirmed-1', 'confirmed-2'], collapsed: false },
        { items: ['unknown-1', 'unknown-2'], collapsed: false },
      ],
      4,
    );
    expect(page).toEqual([['pending-1', 'pending-2'], ['confirmed-1'], ['unknown-1']]);
    expect(page.flat()).toHaveLength(4);

    expect(
      paginateAddressHistorySections(
        [
          { items: ['pending-1', 'pending-2'], collapsed: true },
          { items: ['confirmed-1', 'confirmed-2'], collapsed: false },
          { items: ['unknown-1'], collapsed: false },
        ],
        2,
      ),
    ).toEqual([[], ['confirmed-1'], ['unknown-1']]);
  });

  it('rejects an address from another network or malformed address', () => {
    const workspace = createWorkspace('Address validation', 'mainnet');
    expect(listAddressHistory(workspace, address(3))).toBeDefined();
    expect(listAddressHistory(workspace, address(3).replace('bc1', 'tb1'))).toBeUndefined();
    expect(listAddressHistory(workspace, 'not-an-address')).toBeUndefined();
  });

  it('reuses an index for an immutable transaction snapshot and rebuilds after changes', () => {
    const workspace = createWorkspace('Address history index', 'mainnet');
    const first = indexAddressHistoryTransactions(workspace);
    expect(indexAddressHistoryTransactions(workspace)).toBe(first);

    const changed = {
      ...workspace,
      chainData: {
        ...workspace.chainData,
        transactions: { ...workspace.chainData.transactions, [received.txid]: received },
      },
    };
    expect(indexAddressHistoryTransactions(changed)).not.toBe(first);
  });
});
