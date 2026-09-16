import { bytesToHex } from '@noble/hashes/utils.js';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../../createWorkspace';
import type { Transaction } from '../../../../../Domain/Chain/transaction';
import { addressToScriptHash } from '../../../../../Domain/Wallet/wallet';
import type { Wallet } from '../../../../../Domain/Wallet/walletTypes';
import { WalletInspector } from './Inspector';

const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const txid = '1'.repeat(64);
const wallet: Wallet = {
  id: 'wallet',
  name: 'Public fixture',
  key: '',
  color: '#ffffff',
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
const transaction: Transaction = {
  txid,
  vin: [{ coinbase: '00' }],
  vout: [
    { n: 0, value: 1, scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(address)) } },
  ],
};

describe('WalletInspector', () => {
  it('counts script-only receipts while excluding spoofed decoded addresses', () => {
    const workspace = {
      ...createWorkspace('Evidence', 'mainnet'),
      wallets: [wallet],
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
        workspace,
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
