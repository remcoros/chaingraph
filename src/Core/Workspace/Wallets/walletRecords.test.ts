import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { listWalletAddresses, listWalletTransactions, verifyWalletUtxo } from './walletRecords';
import { createWorkspace } from '../createWorkspace';
import type { Transaction } from '../../ChainData';
import type { Wallet } from './wallets';
import { addressToScriptHash } from '../../Bitcoin';

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

describe('wallet address records', () => {
  it('counts loaded received outputs including spent ones, without trusting history counts', () => {
    const parent = transaction(1);
    parent.vout.push({ ...parent.vout[0], n: 1 });
    const spend = {
      ...transaction(2),
      vin: [{ txid: id(1), vout: 0 }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    };
    const another = transaction(3);
    const workspace = {
      ...createWorkspace('Addresses', 'mainnet'),
      chainData: {
        ...createWorkspace('Addresses', 'mainnet').chainData,
        transactions: Object.fromEntries([parent, spend, another].map((tx) => [tx.txid, tx])),
      },
    };
    const withHistory = {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], history: [{ tx_hash: id(99), height: 1 }] }],
    };
    expect(listWalletAddresses(workspace, withHistory)).toEqual([
      { ...withHistory.addresses[0], loadedOutputCount: 3 },
    ]);
    expect(
      listWalletAddresses(createWorkspace('Empty', 'mainnet'), withHistory)[0].loadedOutputCount,
    ).toBe(0);
    expect(wallet.addresses[0]).not.toHaveProperty('loadedOutputCount');
  });

  it('verifies address claims and uses the raw output script ahead of decoded address text', () => {
    const outputs = [
      { n: 0, value: 1, scriptPubKey: { hex: '51', address } },
      { n: 1, value: 1, scriptPubKey: { hex: 'zz', address } },
      { n: 2, value: 1, scriptPubKey: { address } },
    ];
    const workspace = {
      ...createWorkspace('Addresses', 'mainnet'),
      chainData: {
        ...createWorkspace('Addresses', 'mainnet').chainData,
        transactions: { [id(1)]: { ...transaction(1), vout: outputs } },
      },
    };
    expect(listWalletAddresses(workspace, wallet)[0].loadedOutputCount).toBe(1);
    expect(listWalletAddresses({ ...workspace, network: 'testnet4' }, wallet)).toEqual([]);
    expect(
      listWalletAddresses(workspace, {
        ...wallet,
        addresses: [{ ...wallet.addresses[0], scripthash: id(100) }],
      }),
    ).toEqual([]);
  });

  it('deduplicates scripts and orders receive addresses before change addresses by index', () => {
    const entries = [
      { branch: 1 as const, index: 1 },
      { branch: 0 as const, index: 9 },
      { branch: 0 as const, index: 2 },
      { branch: 1 as const, index: 0 },
    ].map((entry, i) => {
      const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(i + 2), 0, 'bc');
      return {
        ...entry,
        address,
        scripthash: addressToScriptHash(address, 'mainnet'),
        path: `account/${entry.branch}/${entry.index}`,
      };
    });
    const records = listWalletAddresses(createWorkspace('Addresses', 'mainnet'), {
      ...wallet,
      addresses: [...entries, entries[1]],
    });
    expect(records.map((record) => record.path)).toEqual([
      'account/0/2',
      'account/0/9',
      'account/1/0',
      'account/1/1',
    ]);
    expect(records.every((record) => record.loadedOutputCount === 0)).toBe(true);
  });
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
      ...createWorkspace('Records', 'mainnet'),
      chainData: {
        ...createWorkspace('Records', 'mainnet').chainData,
        transactions: Object.fromEntries(
          [parent, spend, spoof, unrelated].map((tx) => [tx.txid, tx]),
        ),
      },
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
      ...createWorkspace('Ordering', 'mainnet'),
      chainData: {
        ...createWorkspace('Ordering', 'mainnet').chainData,
        transactions: {
          [id(2)]: { ...transaction(2), status: { kind: 'unknown' as const, blocktime: 100 } },
        },
      },
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
      ...createWorkspace('Records', 'mainnet'),
      chainData: {
        ...createWorkspace('Records', 'mainnet').chainData,
        transactions: { [id(1)]: transaction(1) },
      },
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

describe('wallet-relative transaction effects', () => {
  const workspaceWith = (...transactions: Transaction[]) => {
    const workspace = createWorkspace('Transaction effects', 'mainnet');
    return {
      ...workspace,
      chainData: {
        ...workspace.chainData,
        transactions: Object.fromEntries(transactions.map((tx) => [tx.txid, tx])),
      },
    };
  };
  const effect = (transactions: Transaction[], txid: string) =>
    listWalletTransactions(workspaceWith(...transactions), wallet).find(
      (record) => record.txid === txid,
    );
  const externalParent = (n: number): Transaction => ({
    ...transaction(n),
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
  });

  it('reports the selected-wallet effect for receipts and payments with change', () => {
    const source = externalParent(10);
    const receipt: Transaction = {
      ...transaction(11),
      vin: [{ txid: source.txid, vout: 0 }],
      vout: [
        { n: 0, value: 0.9, scriptPubKey: { hex: script } },
        { n: 1, value: 0.0999, scriptPubKey: { hex: '51' } },
      ],
    };
    expect(effect([source, receipt], receipt.txid)).toMatchObject({
      direction: 'received',
      receivedSats: 90_000_000,
      spentSats: 0,
      netSats: 90_000_000,
      feeSats: 10_000,
      missingInputCount: 0,
    });

    const sourceWallet = transaction(12);
    const payment: Transaction = {
      ...transaction(13),
      vin: [{ txid: sourceWallet.txid, vout: 0 }],
      vout: [
        { n: 0, value: 0.7, scriptPubKey: { hex: '51' } },
        { n: 1, value: 0.2999, scriptPubKey: { hex: script } },
      ],
    };
    expect(effect([sourceWallet, payment], payment.txid)).toMatchObject({
      direction: 'sent',
      receivedSats: 29_990_000,
      spentSats: 100_000_000,
      netSats: -70_010_000,
      feeSats: 10_000,
      missingInputCount: 0,
    });
  });

  it('recognizes transfers only when every input and output matches the selected wallet', () => {
    const source = transaction(20);
    const self: Transaction = {
      ...transaction(21),
      vin: [{ txid: source.txid, vout: 0 }],
      vout: [{ n: 0, value: 0.9999, scriptPubKey: { hex: script } }],
    };
    expect(effect([source, self], self.txid)).toMatchObject({
      direction: 'transfer',
      receivedSats: 99_990_000,
      spentSats: 100_000_000,
      netSats: -10_000,
      feeSats: 10_000,
    });

    const otherAddress = bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'bc');
    const otherWallet: Wallet = {
      ...wallet,
      id: 'other-wallet',
      addresses: [
        {
          ...wallet.addresses[0],
          address: otherAddress,
          scripthash: addressToScriptHash(otherAddress, 'mainnet'),
        },
      ],
    };
    const betweenWallets: Transaction = {
      ...self,
      vout: [
        {
          n: 0,
          value: 0.9999,
          scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(otherAddress)) },
        },
      ],
    };
    const workspace = {
      ...workspaceWith(source, betweenWallets),
      wallets: { definitions: [wallet, otherWallet] },
    };
    expect(
      listWalletTransactions(workspace, wallet).find((record) => record.txid === self.txid),
    ).toMatchObject({ direction: 'sent', netSats: -100_000_000 });
    expect(listWalletTransactions(workspace, otherWallet)).toEqual([
      expect.objectContaining({ direction: 'received', netSats: 99_990_000 }),
    ]);
  });

  it('keeps external co-input value out of wallet amounts and exposes only a whole-tx fee', () => {
    const own = transaction(30);
    const external = { ...externalParent(31), vout: [{ ...externalParent(31).vout[0], value: 2 }] };
    const collaborative: Transaction = {
      ...transaction(32),
      vin: [
        { txid: own.txid, vout: 0 },
        { txid: external.txid, vout: 0 },
      ],
      vout: [
        { n: 0, value: 1.2, scriptPubKey: { hex: script } },
        { n: 1, value: 1.7999, scriptPubKey: { hex: '51' } },
      ],
    };
    const record = effect([own, external, collaborative], collaborative.txid);
    expect(record).toMatchObject({
      direction: 'received',
      receivedSats: 120_000_000,
      spentSats: 100_000_000,
      netSats: 20_000_000,
      feeSats: 10_000,
    });
    expect(record).not.toHaveProperty('walletFeeSats');
  });

  it('preserves known received outputs while missing inputs keep the net effect unknown', () => {
    const receipt: Transaction = {
      ...transaction(40),
      vin: [{ txid: id(41), vout: 0 }],
      vout: [{ n: 0, value: 0.9, scriptPubKey: { hex: script } }],
    };
    expect(effect([receipt], receipt.txid)).toMatchObject({
      direction: 'unknown',
      receivedSats: 90_000_000,
      spentSats: undefined,
      netSats: undefined,
      feeSats: undefined,
      missingInputCount: 1,
    });
    expect(effect([receipt, externalParent(41)], receipt.txid)).toMatchObject({
      direction: 'received',
      netSats: 90_000_000,
      missingInputCount: 0,
    });
  });

  it('uses attached prevouts without inventing a loaded creating transaction', () => {
    const attached: Transaction = {
      ...transaction(50),
      vin: [{ txid: id(51), vout: 0, prevout: transaction(51).vout[0] }],
      vout: [{ n: 0, value: 0.9999, scriptPubKey: { hex: '51' } }],
    };
    expect(effect([attached], attached.txid)).toMatchObject({
      direction: 'sent',
      receivedSats: 0,
      spentSats: 100_000_000,
      netSats: -100_000_000,
      feeSats: 10_000,
      missingInputCount: 0,
    });
    const unloaded = effect([attached], id(51));
    expect(unloaded).toMatchObject({
      transaction: undefined,
      direction: 'unknown',
    });
    expect(unloaded?.netSats).toBeUndefined();
  });

  it('does not turn conflicting or unidentified previous-output scripts into zero input', () => {
    const source = transaction(60);
    const conflicting: Transaction = {
      ...transaction(61),
      vin: [{ txid: source.txid, vout: 0, prevout: { ...source.vout[0], value: 0.5 } }],
      vout: [{ n: 0, value: 0.4, scriptPubKey: { hex: script } }],
    };
    expect(effect([source, conflicting], conflicting.txid)).toMatchObject({
      direction: 'unknown',
      receivedSats: 40_000_000,
      spentSats: undefined,
      netSats: undefined,
      feeSats: undefined,
      missingInputCount: 1,
    });
    const unidentified: Transaction = {
      ...conflicting,
      vin: [{ txid: id(62), vout: 0, prevout: { value: 1, scriptPubKey: {} } }],
    };
    expect(effect([unidentified], unidentified.txid)).toMatchObject({
      direction: 'unknown',
      spentSats: undefined,
      netSats: undefined,
      feeSats: 60_000_000,
      missingInputCount: 1,
    });
  });

  it('does not let unknown output scripts establish an exact effect or self transfer', () => {
    const own = transaction(70);
    const incomplete: Transaction = {
      ...transaction(71),
      vin: [{ txid: own.txid, vout: 0 }],
      vout: [
        { n: 0, value: 0.5, scriptPubKey: { hex: script } },
        { n: 1, value: 0.4999, scriptPubKey: {} },
      ],
    };
    expect(effect([own, incomplete], incomplete.txid)).toMatchObject({
      direction: 'unknown',
      receivedSats: 50_000_000,
      spentSats: 100_000_000,
      netSats: undefined,
      feeSats: 10_000,
      missingInputCount: 0,
    });
  });

  it('uses authoritative raw scripts over address metadata in both directions', () => {
    const source = externalParent(80);
    const receipt: Transaction = {
      ...transaction(81),
      vin: [
        {
          txid: source.txid,
          vout: 0,
          prevout: { ...source.vout[0], scriptPubKey: { hex: '51', address } },
        },
      ],
      vout: [
        { n: 0, value: 0.2, scriptPubKey: { hex: script } },
        { n: 1, value: 0.7999, scriptPubKey: { hex: '51', address } },
      ],
    };
    expect(effect([source, receipt], receipt.txid)).toMatchObject({
      direction: 'received',
      receivedSats: 20_000_000,
      spentSats: 0,
      netSats: 20_000_000,
    });
    const malformed = {
      ...receipt,
      vout: [
        { n: 0, value: 0.2, scriptPubKey: { hex: script } },
        { n: 1, value: 0.7999, scriptPubKey: { hex: 'zz', address } },
      ],
    };
    expect(effect([source, malformed], malformed.txid)).toMatchObject({
      direction: 'unknown',
      receivedSats: 20_000_000,
      netSats: undefined,
    });
  });

  it('treats coinbase as receipt with no missing input and no transaction fee', () => {
    expect(effect([transaction(90)], id(90))).toMatchObject({
      direction: 'received',
      receivedSats: 100_000_000,
      spentSats: 0,
      netSats: 100_000_000,
      feeSats: undefined,
      missingInputCount: 0,
    });
  });

  it('keeps unloaded history unknown and rejects invalid observed amounts', () => {
    const withHistory = {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], history: [{ tx_hash: id(100), height: 1 }] }],
    };
    const unloaded = listWalletTransactions(workspaceWith(), withHistory)[0];
    expect(unloaded).toMatchObject({ direction: 'unknown', missingInputCount: 0 });
    expect(unloaded.receivedSats).toBeUndefined();
    expect(unloaded.spentSats).toBeUndefined();
    expect(unloaded.netSats).toBeUndefined();
    expect(unloaded.feeSats).toBeUndefined();

    const invalid = {
      ...transaction(101),
      vout: [{ n: 0, value: Number.NaN, scriptPubKey: { hex: script } }],
    };
    expect(effect([invalid], invalid.txid)).toMatchObject({
      direction: 'unknown',
      receivedSats: undefined,
      netSats: undefined,
      feeSats: undefined,
    });
    expect(
      listWalletTransactions({ ...workspaceWith(transaction(102)), network: 'testnet4' }, wallet),
    ).toEqual([]);
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
