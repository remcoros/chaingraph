import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletInspector } from '../../../src/App/Workspace/Workbenches/Graph/InspectorPanel/Inspector';
import {
  matchingWalletUtxoObservation,
  resolveWalletUtxoObservation,
} from '../../../src/App/Workspace/ChainData/WalletUtxos/walletUtxoObservation';
import { newWorkspace } from '../../../src/Domain/Workspace/workspace';
import { outputNodeId } from '../../../src/Domain/Metadata/entityReferences';
import type { Transaction } from '../../../src/Domain/Chain/transaction';
import type { Wallet } from '../../../src/Domain/Wallet/walletTypes';
import { addressToScriptHash } from '../../../src/Domain/Wallet/wallet';

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
  ...newWorkspace('Evidence', 'mainnet'),
  wallets: [wallet],
  transactions: { [txid]: transaction },
};
const record = { txid, vout: 0, valueSats: 100_000_000, height: 1, address, scripthash };
const view = { records: [record], checkedAt: '2026-09-10T10:00:00.000Z' };
const selectedId = outputNodeId(txid, 0);

describe('shared wallet observations', () => {
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
      resolveWalletUtxoObservation(workspace, wallet, view, outputNodeId(txid, 1)),
    ).toBeUndefined();
  });

  it('rejects missing, mismatched and wrong-network evidence without inferring a status', () => {
    for (const changed of [
      { ...workspace, transactions: {} },
      { ...workspace, network: 'testnet4' as const },
      {
        ...workspace,
        transactions: { [txid]: { ...transaction, vout: [{ ...transaction.vout[0], value: 2 }] } },
      },
      {
        ...workspace,
        transactions: {
          [txid]: {
            ...transaction,
            vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51', address } }],
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

  it('wallet Inspector counts script-only receipts while excluding spoofed decoded addresses', () => {
    const fixture = {
      ...workspace,
      transactions: {
        [txid]: {
          ...transaction,
          vout: [transaction.vout[0], { n: 1, value: 1, scriptPubKey: { hex: '51', address } }],
        },
      },
    };
    const html = renderToStaticMarkup(
      createElement(WalletInspector, {
        wallet,
        workspace: fixture,
        busy: false,
        canLoadChainData: false,
        onScan() {},
        onShowActivity() {},
        onEdit() {},
        onRemove() {},
      }),
    );
    expect(html.match(/Loaded received outputs[\s\S]*?<\/dt><dd>(\d+)<\/dd>/)?.[1]).toBe('1');
  });
});
