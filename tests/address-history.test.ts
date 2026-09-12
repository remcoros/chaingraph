import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  addressBalanceSats,
  indexAddressHistoryTransactions,
  listAddressHistory,
} from '../src/domain/addressHistory';
import { addressToScriptHash } from '../src/lib/wallet';
import { newWorkspace } from '../src/domain/workspace';
import type { Transaction } from '../src/domain/types';

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
    const workspace = newWorkspace('Address history', 'mainnet');
    workspace.transactions = { [received.txid]: received, [spent.txid]: spent };
    workspace.addressHistories = {
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
    const workspace = newWorkspace('Wallet address history', 'mainnet');
    workspace.wallets = [
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

  it('rejects an address from another network or malformed address', () => {
    const workspace = newWorkspace('Address validation', 'mainnet');
    expect(listAddressHistory(workspace, address(3))).toBeDefined();
    expect(listAddressHistory(workspace, address(3).replace('bc1', 'tb1'))).toBeUndefined();
    expect(listAddressHistory(workspace, 'not-an-address')).toBeUndefined();
  });

  it('reuses an index for an immutable transaction snapshot and rebuilds after changes', () => {
    const workspace = newWorkspace('Address history index', 'mainnet');
    const first = indexAddressHistoryTransactions(workspace);
    expect(indexAddressHistoryTransactions(workspace)).toBe(first);

    const changed = {
      ...workspace,
      transactions: { ...workspace.transactions, [received.txid]: received },
    };
    expect(indexAddressHistoryTransactions(changed)).not.toBe(first);
  });
});
