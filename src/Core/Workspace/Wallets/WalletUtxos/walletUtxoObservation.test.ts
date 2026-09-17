import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  matchingWalletUtxoObservation,
  reconcileWalletUtxos,
  resolveWalletUtxoObservation,
} from './walletUtxoObservation';
import { createWorkspace } from '../../createWorkspace';
import { outpointReference } from '../../entityReferences';
import type { Wallet } from '../wallets';
import type { Transaction } from '../../../ChainData';

import { addressToScriptHash } from '../../../Bitcoin';

const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const scripthash = addressToScriptHash(address, 'mainnet');
const txid = '1'.repeat(64);
const wallet: Wallet = {
  id: 'wallet',
  name: 'Public fixture',
  key: '',
  color: '#ffffff',
  scriptType: 'p2wpkh',
  addresses: [{ address, scripthash, path: 'account/0/0', branch: 0, index: 0 }],
};
const transaction: Transaction = {
  txid,
  vin: [{ coinbase: '00' }],
  vout: [
    { n: 0, value: 1, scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(address)) } },
  ],
};
const workspace = {
  ...createWorkspace('Evidence', 'mainnet'),
  wallets: { ...createWorkspace('Evidence', 'mainnet').wallets, definitions: [wallet] },
  chainData: {
    ...createWorkspace('Evidence', 'mainnet').chainData,
    transactions: { [txid]: transaction },
  },
};
const record = { txid, vout: 0, valueSats: 100_000_000, height: 1, address, scripthash };
const view = { records: [record], checkedAt: '2026-09-10T10:00:00.000Z' };
const selectedId = outpointReference(txid, 0);

describe('shared wallet observations', () => {
  it('retains the historical check but withholds a current recommendation when an exact spender is loaded', () => {
    const spenderId = '2'.repeat(64);
    const spender: Transaction = { txid: spenderId, vin: [{ txid, vout: 0 }], vout: [] };
    const loaded = new Map([
      [txid, transaction],
      [spenderId, spender],
    ]);
    const result = reconcileWalletUtxos(view.records, loaded, 'mainnet');
    expect(result.current).toEqual([]);
    expect(result.withLoadedSpender).toEqual([record]);
    expect(result.invalidCount).toBe(0);
    expect(view.records).toEqual([record]);
    expect(view.checkedAt).toBe('2026-09-10T10:00:00.000Z');
    expect(
      resolveWalletUtxoObservation(
        {
          ...workspace,
          chainData: {
            ...workspace.chainData,
            transactions: Object.fromEntries(loaded),
          },
        },
        wallet,
        view,
        selectedId,
      ),
    ).toBeUndefined();
    loaded.set(spenderId, { ...spender, vin: [{ txid, vout: 1 }] });
    expect(reconcileWalletUtxos(view.records, loaded, 'mainnet').current).toEqual([record]);
  });
  it('carries a timestamped positive observation only after verifying loaded output facts', () => {
    expect(resolveWalletUtxoObservation(workspace, wallet, view, selectedId)).toEqual({
      workspaceId: workspace.id,
      network: 'mainnet',
      txid,
      vout: 0,
      checkedAt: view.checkedAt,
    });
    expect(
      resolveWalletUtxoObservation(workspace, wallet, { ...view, records: [] }, selectedId),
    ).toBeUndefined();
    expect(resolveWalletUtxoObservation(workspace, wallet, undefined, selectedId)).toBeUndefined();
    expect(
      resolveWalletUtxoObservation(workspace, wallet, view, outpointReference(txid, 1)),
    ).toBeUndefined();
  });

  it('rejects missing, mismatched and wrong-network evidence without inferring a status', () => {
    for (const changed of [
      { ...workspace, chainData: { ...workspace.chainData, transactions: {} } },
      { ...workspace, network: 'testnet4' as const },
      {
        ...workspace,
        chainData: {
          ...workspace.chainData,
          transactions: {
            [txid]: { ...transaction, vout: [{ ...transaction.vout[0], value: 2 }] },
          },
        },
      },
      {
        ...workspace,
        chainData: {
          ...workspace.chainData,
          transactions: {
            [txid]: {
              ...transaction,
              vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51', address } }],
            },
          },
        },
      },
    ])
      expect(resolveWalletUtxoObservation(changed, wallet, view, selectedId)).toBeUndefined();
    expect(
      resolveWalletUtxoObservation(workspace, { ...wallet, addresses: [] }, view, selectedId),
    ).toBeUndefined();
    expect(
      resolveWalletUtxoObservation(
        workspace,
        wallet,
        { ...view, checkedAt: 'invalid' },
        selectedId,
      ),
    ).toBeUndefined();
  });

  it('prevents a passed observation from rendering against another workspace or selection', () => {
    const observation = resolveWalletUtxoObservation(workspace, wallet, view, selectedId);
    expect(matchingWalletUtxoObservation(observation, workspace, txid, 0)).toBe(observation);
    expect(
      matchingWalletUtxoObservation(observation, { ...workspace, id: 'another' }, txid, 0),
    ).toBeUndefined();
    expect(
      matchingWalletUtxoObservation(observation, { ...workspace, network: 'testnet4' }, txid, 0),
    ).toBeUndefined();
    expect(matchingWalletUtxoObservation(observation, workspace, txid, 1)).toBeUndefined();
  });
});
