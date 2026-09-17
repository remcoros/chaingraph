import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  groupWalletRelationships,
  listLoadedAddressTransactionIds,
  listWalletRelationships,
} from './walletRelationships';
import { createWorkspace } from '../createWorkspace';
import { outpointReference } from '../entityReferences';
import type { Wallet } from './wallets';
import type { Workspace } from '../workspace';
import type { Transaction } from '../../ChainData';

import { addressToScriptHash } from '../../Bitcoin';

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
const output = (n: number, owner: string, value = 1) => ({
  n,
  value,
  scriptPubKey: { hex: script(owner) },
});

describe('address-level wallet relationship subjects', () => {
  it('groups distinct outputs by canonical address without double counting repeated contexts', () => {
    const anotherReceipt = { ...receipt, txid: id(4), vout: [output(0, mine)] };
    const workspace = fixture([funding, receipt, spending, anotherReceipt]);
    const before = JSON.stringify(workspace);
    const grouped = groupWalletRelationships(workspace, wallet);
    const source = grouped.sources.find((entry) => entry.address === other)!;
    expect(source).toMatchObject({
      id: `addr:${other}`,
      ownership: 'external',
      outpointIds: [outpointReference(id(10), 0), outpointReference(id(10), 1)],
      transactionIds: [id(2), id(3), id(4)],
      amountSats: 600_000_000,
      count: 2,
    });
    expect(source.contexts).toEqual([
      {
        transactionId: id(2),
        walletOutputIds: [outpointReference(id(2), 0), outpointReference(id(2), 1)],
      },
      { transactionId: id(3), walletOutputIds: [outpointReference(id(3), 1)] },
      { transactionId: id(4), walletOutputIds: [outpointReference(id(4), 0)] },
    ]);
    expect(source.outpoints[0].transactionIds).toEqual([id(2), id(4)]);
    expect(source.outpoints[1].transactionIds).toEqual([id(3)]);
    const destination = grouped.destinations.find((entry) => entry.address === other)!;
    expect(destination.outpointIds).toEqual([outpointReference(id(3), 0)]);
    expect(destination.amountSats).toBe(100_000_000);
    expect(destination.id).toBe(source.id);
    expect(grouped.sourceExceptions.map((entry) => entry.id)).toEqual([
      outpointReference(id(9), 3),
    ]);
    expect(grouped.coverage).toEqual(listWalletRelationships(workspace, wallet).coverage);
    expect(JSON.stringify(workspace)).toBe(before);
    expect(source).not.toHaveProperty('unspent');
    expect(source).not.toHaveProperty('allocatedSats');
  });

  it('keeps malformed, non-address and missing outputs as exceptions rather than inventing groups', () => {
    const changedFunding = structuredClone(funding);
    changedFunding.vout[0].scriptPubKey = { hex: '6a00', address: other };
    changedFunding.vout[1].scriptPubKey = { hex: 'malformed', address: other };
    const changedSpend = structuredClone(spending);
    changedSpend.vout[0].scriptPubKey = { hex: '6a00', address: other };
    const grouped = groupWalletRelationships(
      fixture([changedFunding, receipt, changedSpend]),
      wallet,
    );
    expect(grouped.sources.map((entry) => entry.address)).toEqual([mine]);
    expect(grouped.destinations.map((entry) => entry.address)).toEqual([mine]);
    expect(grouped.sourceExceptions.map((entry) => entry.id).sort()).toEqual(
      [
        outpointReference(id(9), 3),
        outpointReference(id(10), 0),
        outpointReference(id(10), 1),
      ].sort(),
    );
    expect(grouped.destinationExceptions.map((entry) => entry.id)).toEqual([
      outpointReference(id(3), 0),
    ]);
    expect(grouped.sourceExceptions.every((entry) => entry.address === undefined)).toBe(true);
  });

  it('preserves wallet/network isolation and ignores conflicting address text when grouping', () => {
    const workspace = fixture();
    workspace.chainData.transactions = structuredClone(workspace.chainData.transactions);
    workspace.chainData.transactions[id(10)].vout[0].scriptPubKey.address = mine;
    workspace.chainData.transactions[id(10)].vout[1].scriptPubKey = {
      address: other.toUpperCase(),
    };
    const original = groupWalletRelationships(workspace, wallet);
    expect(original.sources.find((entry) => entry.address === other)?.count).toBe(2);
    const unrelatedWallet = {
      ...wallet,
      id: 'unrelated',
      addresses: [
        {
          ...wallet.addresses[0],
          address: address(3),
          scripthash: addressToScriptHash(address(3), 'mainnet'),
        },
      ],
    };
    expect(groupWalletRelationships(workspace, unrelatedWallet)).toMatchObject({
      sources: [],
      destinations: [],
      sourceExceptions: [],
      destinationExceptions: [],
    });
    workspace.network = 'testnet4';
    expect(groupWalletRelationships(workspace, wallet).sources).toEqual([]);
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
    const testnet = groupWalletRelationships(workspace, testWallet);
    expect(testnet.sources.find((entry) => entry.address === address(2, 'tb'))?.count).toBe(1);
    expect(testnet.sources.every((entry) => entry.id.startsWith('addr:tb1'))).toBe(true);
    expect(
      testnet.sourceExceptions.some((entry) => entry.id === outpointReference(id(10), 1)),
    ).toBe(true);
  });

  it('does not present a partial or unsafe sum as the observed output total', () => {
    const workspace = fixture();
    workspace.chainData.transactions = structuredClone(workspace.chainData.transactions);
    workspace.chainData.transactions[id(10)].vout[1].value = Number.NaN;
    expect(
      groupWalletRelationships(workspace, wallet).sources.find((entry) => entry.address === other)
        ?.amountSats,
    ).toBeUndefined();
    workspace.chainData.transactions[id(10)].vout[0].value = Number.MAX_SAFE_INTEGER / 100_000_000;
    workspace.chainData.transactions[id(10)].vout[1].value = Number.MAX_SAFE_INTEGER / 100_000_000;
    expect(
      groupWalletRelationships(workspace, wallet).sources.find((entry) => entry.address === other)
        ?.amountSats,
    ).toBeUndefined();
  });
});
const wallet: Wallet = {
  id: 'wallet',
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
      history: [
        { tx_hash: id(5), height: 1 },
        { tx_hash: id(6), height: 1 },
      ],
    },
  ],
  scanComplete: true,
};
const funding: Transaction = {
  txid: id(10),
  vin: [{ txid: id(11), vout: 0 }],
  vout: [output(0, other, 4), output(1, other, 2)],
};
const receipt: Transaction = {
  txid: id(2),
  vin: [
    { txid: id(10).toUpperCase(), vout: 0 },
    { txid: id(9), vout: 3 },
  ],
  vout: [output(0, mine, 2), output(1, mine, 1), output(2, other)],
};
const spending: Transaction = {
  txid: id(3),
  vin: [
    { txid: id(2), vout: 0 },
    { txid: id(10), vout: 1 },
  ],
  vout: [output(0, other), output(1, mine)],
};
function fixture(transactions: Transaction[] = [funding, receipt, spending]): Workspace {
  return {
    ...createWorkspace('Relationships', 'mainnet'),
    wallets: { ...createWorkspace('Relationships', 'mainnet').wallets, definitions: [wallet] },
    chainData: {
      ...createWorkspace('Relationships', 'mainnet').chainData,
      transactions: Object.fromEntries(
        transactions.map((transaction) => [transaction.txid, transaction]),
      ),
    },
  };
}

describe('direct wallet relationships', () => {
  it('deduplicates canonical subjects while retaining every one-hop context and wallet reference', () => {
    const replacement = { ...receipt, txid: id(4), vout: [output(0, mine)] };
    const workspace = fixture([funding, receipt, spending, replacement]);
    const before = JSON.stringify(workspace);
    const { sources, destinations, coverage } = listWalletRelationships(workspace, wallet);
    const direct = sources.find((source) => source.id === outpointReference(id(10), 0))!;
    expect(direct).toMatchObject({
      txid: id(10),
      vout: 0,
      ownership: 'external',
      missing: false,
      address: other,
      amountSats: 400_000_000,
      transactionIds: [id(2), id(4)],
      walletOutputIds: [
        outpointReference(id(2), 0),
        outpointReference(id(2), 1),
        outpointReference(id(4), 0),
      ],
    });
    expect(direct.contexts).toEqual([
      {
        transactionId: id(2),
        walletOutputIds: [outpointReference(id(2), 0), outpointReference(id(2), 1)],
      },
      { transactionId: id(4), walletOutputIds: [outpointReference(id(4), 0)] },
    ]);
    expect(new Set(sources.map((source) => source.id)).size).toBe(sources.length);
    expect(sources.some((source) => source.txid === id(11))).toBe(false);
    expect(destinations.map((destination) => destination.id)).toEqual([
      outpointReference(id(3), 0),
      outpointReference(id(3), 1),
    ]);
    expect(destinations[0].walletOutputIds).toEqual([outpointReference(id(2), 0)]);
    expect(destinations[1].ownership).toBe('wallet');
    expect(sources.find((source) => source.id === outpointReference(id(2), 0))?.ownership).toBe(
      'wallet',
    );
    expect(destinations.some((destination) => destination.id === outpointReference(id(2), 2))).toBe(
      false,
    );
    expect(coverage).toMatchObject({
      knownTransactions: 5,
      loadedTransactions: 3,
      unloadedTransactions: 2,
      receivingTransactions: 3,
      spendingTransactions: 1,
      missingPrevouts: 1,
      partial: true,
    });
    expect(JSON.stringify(workspace)).toBe(before);
    expect(direct).not.toHaveProperty('allocatedSats');
    expect(direct).not.toHaveProperty('unspent');
    expect(direct).not.toHaveProperty('spendable');
  });

  it('keeps missing prevouts but never fabricates a coinbase outpoint or input value', () => {
    const coinbase = {
      txid: id(7),
      vin: [{ coinbase: '00', txid: id(8), vout: 0 }],
      vout: [output(0, mine)],
    };
    const unknown = { txid: id(8), vin: [{}], vout: [output(0, mine)] };
    const results = listWalletRelationships(fixture([receipt, coinbase, unknown]), wallet);
    expect(results.sources).toHaveLength(2);
    expect(
      results.sources.every((source) => source.missing && source.ownership === 'unknown'),
    ).toBe(true);
    expect(
      results.sources.every(
        (source) => source.amountSats === undefined && source.address === undefined,
      ),
    ).toBe(true);
    expect(results.sources.some((source) => source.txid === id(8))).toBe(false);
    expect(results.coverage).toMatchObject({
      missingPrevouts: 2,
      coinbaseInputs: 1,
      unidentifiedInputs: 1,
      partial: true,
    });
  });

  it('uses attached prevouts without fabricating their creating transactions', () => {
    const attachedReceipt: Transaction = {
      ...receipt,
      vin: [
        {
          txid: id(10),
          vout: 0,
          prevout: { value: 4, scriptPubKey: { hex: script(other) } },
        },
      ],
    };
    const workspace = fixture([attachedReceipt]);
    const results = listWalletRelationships(workspace, wallet);
    expect(results.sources).toContainEqual(
      expect.objectContaining({
        id: outpointReference(id(10), 0),
        address: other,
        amountSats: 400_000_000,
        ownership: 'external',
        missing: false,
      }),
    );
    expect(results.coverage.missingPrevouts).toBe(0);
    expect(workspace.chainData.transactions[id(10)]).toBeUndefined();
    expect(listLoadedAddressTransactionIds(workspace, other)).toEqual([id(2)]);
  });

  it('uses raw scripts over claims, with malformed, non-address and foreign-address evidence unknown', () => {
    const malformed: Transaction = {
      txid: id(10),
      vin: [{ coinbase: '00' }],
      vout: [
        { n: 0, value: 1, scriptPubKey: { hex: 'not-hex', address: mine } },
        { n: 1, value: 1, scriptPubKey: { hex: '6a00', address: mine } },
        { n: 2, value: 1, scriptPubKey: { address: address(1, 'tb') } },
        { n: 3, value: 1, scriptPubKey: {} },
        { n: 4, value: 1, scriptPubKey: { hex: script(other), address: mine } },
        { n: 5, value: 1, scriptPubKey: { address: mine } },
      ],
    };
    const receiving = {
      ...receipt,
      vin: malformed.vout.map((entry) => ({ txid: id(10), vout: entry.n })),
    };
    const results = listWalletRelationships(fixture([malformed, receiving]), wallet);
    const inputs = results.sources.filter((source) => source.txid === id(10));
    expect(inputs.map((source) => source.ownership)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'external',
      'wallet',
    ]);
    expect(inputs.slice(0, 4).every((source) => !source.address && !source.missing)).toBe(true);
    expect(inputs[4].address).toBe(other);
    expect(results.destinations.map((entry) => entry.id)).toEqual(
      receiving.vout.map((entry) => outpointReference(id(2), entry.n)),
    );
  });

  it('does not derive direction from history, another wallet, or mismatched claims', () => {
    const historyOnly = { txid: id(5), vin: [{ txid: id(9), vout: 0 }], vout: [output(0, other)] };
    const workspace = fixture([historyOnly]);
    workspace.wallets.definitions.push({
      ...wallet,
      id: 'other-wallet',
      addresses: [
        {
          ...wallet.addresses[0],
          address: other,
          scripthash: addressToScriptHash(other, 'mainnet'),
        },
      ],
    });
    expect(listWalletRelationships(workspace, wallet)).toMatchObject({
      sources: [],
      destinations: [],
      coverage: {
        knownTransactions: 2,
        loadedTransactions: 1,
        unloadedTransactions: 1,
        missingPrevouts: 1,
      },
    });
    const claimed = {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], scripthash: addressToScriptHash(other, 'mainnet') }],
    };
    expect(listWalletRelationships(fixture(), claimed)).toMatchObject({
      sources: [],
      destinations: [],
    });
    const foreign = { ...workspace, network: 'testnet4' as const };
    expect(listWalletRelationships(foreign, wallet)).toMatchObject({
      sources: [],
      destinations: [],
    });
  });

  it('uses the declared network for raw scripts and rejects inconsistent transaction map keys', () => {
    const workspace = fixture();
    workspace.network = 'testnet4';
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
      listWalletRelationships(workspace, testWallet).sources.find(
        (source) => source.txid === id(10),
      )?.address,
    ).toBe(address(2, 'tb'));
    const wrongKey = fixture([]);
    wrongKey.chainData.transactions[id(99)] = receipt;
    expect(listWalletRelationships(wrongKey, wallet).sources).toEqual([]);
  });

  it('reports partial wallet discovery even when all known transactions are loaded', () => {
    const localWallet = {
      ...wallet,
      addresses: [{ ...wallet.addresses[0], history: [] }],
      scanComplete: false,
    };
    const coinbase = { txid: id(1), vin: [{ coinbase: '00' }], vout: [output(0, mine)] };
    expect(listWalletRelationships(fixture([coinbase]), localWallet).coverage).toMatchObject({
      knownTransactions: 1,
      loadedTransactions: 1,
      unloadedTransactions: 0,
      coinbaseInputs: 1,
      missingPrevouts: 0,
      partial: true,
    });
    expect(
      listWalletRelationships(fixture([coinbase]), { ...localWallet, scanComplete: true }).coverage
        .partial,
    ).toBe(false);
  });

  it('lists only script-verified loaded address contexts, never an arbitrary history transaction', () => {
    const workspace = fixture();
    expect(listLoadedAddressTransactionIds(workspace, mine)).toEqual([id(2), id(3)]);
    expect(listLoadedAddressTransactionIds(workspace, mine.toUpperCase())).toEqual([id(2), id(3)]);
    expect(listLoadedAddressTransactionIds(workspace, other)).toEqual([id(2), id(3), id(10)]);
    expect(listLoadedAddressTransactionIds(workspace, address(1, 'tb'))).toEqual([]);
    expect(listLoadedAddressTransactionIds(workspace, 'invalid')).toEqual([]);
  });
});
