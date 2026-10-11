import { address as bitcoinAddress, networks } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { expect, it } from 'vitest';
import { createWorkspace } from '../createWorkspace';
import { addressToScriptHash } from '../../Bitcoin';
import {
  buildWalletSelectionAddresses,
  buildWalletSelectionIndex,
} from '../Wallets/walletSelectionIndex';
import type { Wallet } from '../Wallets/wallets';
import { outpointReference } from '../entityReferences';
import { walletTransactionCounterpartySubject } from './walletCounterpartySubjects';

it('builds exact receipt/payment anchors from verified scripts and reuses prepared prevouts', () => {
  const workspace = createWorkspace('Scoped party subjects', 'mainnet');
  const mine = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
  const other = bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'bc');
  const script = (address: string) =>
    bytesToHex(bitcoinAddress.toOutputScript(address, networks.bitcoin));
  const wallet: Wallet = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Public fixture',
    key: '',
    scriptType: 'p2wpkh',
    color: '#123456',
    addresses: [
      {
        branch: 0,
        index: 0,
        path: 'account/0/0',
        address: mine,
        scripthash: addressToScriptHash(mine, 'mainnet'),
      },
    ],
  };
  const receiptId = 'a'.repeat(64),
    paymentId = 'b'.repeat(64);
  workspace.chainData.transactions = {
    [receiptId]: {
      txid: receiptId,
      vin: [{ coinbase: '00' }],
      vout: [
        { n: 0, value: 1, scriptPubKey: { hex: script(mine) } },
        { n: 1, value: 2, scriptPubKey: { hex: script(other) } },
      ],
    },
    [paymentId]: {
      txid: paymentId,
      vin: [
        { txid: receiptId, vout: 0 },
        { txid: receiptId, vout: 1 },
      ],
      vout: [
        { n: 0, value: 2, scriptPubKey: { hex: script(other) } },
        { n: 1, value: 0.9, scriptPubKey: { hex: script(mine) } },
      ],
    },
  };
  const prepared = {
    prevouts: buildWalletSelectionIndex(workspace).prevouts,
    scripthashes: buildWalletSelectionAddresses(wallet, 'mainnet').scripthashes,
  };
  expect(
    walletTransactionCounterpartySubject(workspace, wallet, receiptId, 'received', prepared)
      ?.walletOutputIds,
  ).toEqual([outpointReference(receiptId, 0)]);
  expect(
    walletTransactionCounterpartySubject(workspace, wallet, paymentId, 'sent', prepared)
      ?.walletOutputIds,
  ).toEqual([outpointReference(receiptId, 0)]);
  expect(
    walletTransactionCounterpartySubject(workspace, wallet, paymentId, 'received', prepared)
      ?.walletOutputIds,
  ).toEqual([outpointReference(paymentId, 1)]);
  expect(
    walletTransactionCounterpartySubject(workspace, wallet, receiptId, 'sent', prepared),
  ).toBeUndefined();
  expect(
    walletTransactionCounterpartySubject(
      workspace,
      { ...wallet, addresses: [{ ...wallet.addresses[0], scripthash: 'bad' }] },
      receiptId,
      'received',
    ),
  ).toBeUndefined();
});
