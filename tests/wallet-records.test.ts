import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { listWalletTransactions, verifyWalletUtxo } from '../src/domain/walletRecords';
import { newWorkspace } from '../src/domain/workspace';
import type { Transaction, Wallet } from '../src/domain/types';
import { addressToScriptHash } from '../src/lib/wallet';

const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const hash = addressToScriptHash(address, 'mainnet');
const script = bytesToHex(bitcoinAddress.toOutputScript(address));
const id = (n: number) => n.toString(16).padStart(64, '0');
const wallet: Wallet = {
  id: 'wallet',
  name: 'Wallet',
  key: '',
  color: '#ffffff',
  scriptType: 'p2wpkh',
  addresses: [{ address, scripthash: hash, path: 'account/0/0', branch: 0, index: 0 }],
};
const transaction = (n: number): Transaction => ({
  txid: id(n),
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey: { hex: script } }],
});

describe('wallet transaction history', () => {
  it('combines unloaded history with direct script matches and exact spending prevouts only', () => {
    const parent = transaction(1);
    const spend: Transaction = {
      ...transaction(2),
      vin: [{ txid: id(1), vout: 0 }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    };
    const spoof = {
      ...transaction(3),
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51', address } }],
    };
    const unrelated = { ...spend, txid: id(4), vin: [{ txid: id(1), vout: 1 }] };
    const workspace = {
      ...newWorkspace('Records', 'mainnet'),
      transactions: Object.fromEntries(
        [parent, spend, spoof, unrelated].map((tx) => [tx.txid, tx]),
      ),
    };
    const withHistory = {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], history: [{ tx_hash: id(5), height: 100 }] }],
    };
    const records = listWalletTransactions(workspace, withHistory);
    expect(records.map((item) => item.txid)).toEqual([id(5), id(1), id(2)]);
    expect(records[0].transaction).toBeUndefined();
    expect(records[1].transaction).toBe(parent);
  });
  it('sorts mempool, height, time and txid deterministically and collapses duplicate history', () => {
    const history = [
      { tx_hash: id(6), height: 5 },
      { tx_hash: id(5), height: 20 },
      { tx_hash: id(4), height: -1 },
      { tx_hash: id(3), height: 0 },
      { tx_hash: id(2), height: 20 },
      { tx_hash: id(1), height: 20 },
      { tx_hash: id(1), height: 20 },
    ];
    const workspace = {
      ...newWorkspace('Ordering', 'mainnet'),
      transactions: { [id(2)]: { ...transaction(2), blocktime: 100 } },
    };
    const records = listWalletTransactions(workspace, {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], history }],
    });
    expect(records.map((item) => item.txid)).toEqual([id(3), id(4), id(2), id(1), id(5), id(6)]);
    expect(records.slice(0, 2).every((item) => item.mempool && item.height === undefined)).toBe(
      true,
    );
  });
  it('does not use malformed or wrong-network address claims or conflicting history heights', () => {
    const workspace = {
      ...newWorkspace('Records', 'mainnet'),
      transactions: { [id(1)]: transaction(1) },
    };
    expect(
      listWalletTransactions(workspace, {
        ...wallet,
        addresses: [{ ...wallet.addresses[0], scripthash: id(100) }],
      }),
    ).toEqual([]);
    expect(listWalletTransactions({ ...workspace, network: 'testnet4' }, wallet)).toEqual([]);
    const records = listWalletTransactions(workspace, {
      ...wallet,
      addresses: [
        {
          ...wallet.addresses[0],
          history: [
            { tx_hash: 'bad', height: 50 },
            { tx_hash: id(2), height: 10 },
            { tx_hash: id(2), height: 11 },
          ],
        },
      ],
    });
    expect(records.find((record) => record.txid === id(2))).toMatchObject({
      height: undefined,
      mempool: false,
    });
    expect(records).toHaveLength(2);
  });
});

describe('wallet output verification before selection', () => {
  const record = {
    txid: id(1),
    vout: 0,
    valueSats: 100_000_000,
    height: 0,
    address,
    scripthash: hash,
  };
  it('verifies outpoint, amount, network and authoritative script', () => {
    expect(verifyWalletUtxo(record, transaction(1), 'mainnet')).toBe(true);
    expect(verifyWalletUtxo(record, transaction(1), 'testnet4')).toBe(false);
    expect(verifyWalletUtxo(record, transaction(2), 'mainnet')).toBe(false);
    expect(verifyWalletUtxo({ ...record, vout: 1 }, transaction(1), 'mainnet')).toBe(false);
    expect(
      verifyWalletUtxo({ ...record, valueSats: record.valueSats + 1 }, transaction(1), 'mainnet'),
    ).toBe(false);
    expect(
      verifyWalletUtxo(
        record,
        { ...transaction(1), vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51', address } }] },
        'mainnet',
      ),
    ).toBe(false);
    expect(verifyWalletUtxo({ ...record, scripthash: id(123) }, transaction(1), 'mainnet')).toBe(
      false,
    );
  });
  it('accepts a valid address when raw script is unavailable and rejects malformed raw script', () => {
    const tx = { ...transaction(1), vout: [{ n: 0, value: 1, scriptPubKey: { address } }] };
    expect(verifyWalletUtxo(record, tx, 'mainnet')).toBe(true);
    expect(
      verifyWalletUtxo(
        record,
        { ...tx, vout: [{ ...tx.vout[0], scriptPubKey: { address, hex: 'zz' } }] },
        'mainnet',
      ),
    ).toBe(false);
  });
});
