import { afterEach, describe, expect, it, vi } from 'vitest';
import { address, networks, payments } from 'bitcoinjs-lib';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { fetchTransaction } from '../../../src/Core/ChainData/api';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import { validateTransactionAddresses, type Transaction } from '../../../src/Core/ChainData';
import type { Network, TxOutput } from '../../../src/Core/Bitcoin';

const txid = 'a'.repeat(64);
const publicHash = Uint8Array.from({ length: 20 }, (_, index) => index + 1);
const publicKey = hexToBytes('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
const transaction = (scriptPubKey: TxOutput['scriptPubKey']): Transaction => ({
  txid,
  vin: [{ coinbase: '00' }],
  vout: [{ n: 0, value: 1, scriptPubKey }],
});
const payment = (network: Network, hash = publicHash) =>
  payments.p2wpkh({ hash, network: network === 'mainnet' ? networks.bitcoin : networks.testnet });
const workspace = (network: Network, tx: Transaction) => {
  const value = createWorkspace('Public address validation fixture', network);
  value.chainData.transactions[tx.txid] = tx;
  return value;
};
afterEach(() => vi.unstubAllGlobals());

describe('transaction output address boundaries', () => {
  for (const network of ['mainnet', 'testnet4'] as const) {
    it(`accepts valid ${network} metadata at fetch/import and rejects foreign-network addresses`, async () => {
      const correct = payment(network);
      const wrong = payment(network === 'mainnet' ? 'testnet4' : 'mainnet');
      const valid = transaction({ address: correct.address!, hex: bytesToHex(correct.output!) });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ result: valid }))),
      );
      expect(await fetchTransaction(network, txid)).toMatchObject(valid);
      expect(parseWorkspace(workspace(network, valid)).chainData.transactions[txid]).toEqual(valid);
      const foreign = transaction({ address: wrong.address!, hex: bytesToHex(correct.output!) });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ result: foreign }))),
      );
      await expect(fetchTransaction(network, txid)).rejects.toThrow(
        `invalid address for ${network}`,
      );
      expect(() => parseWorkspace(workspace(network, foreign))).toThrow(
        `invalid address for ${network}`,
      );
      expect(() =>
        validateTransactionAddresses(
          transaction({ addresses: [correct.address!, wrong.address!] }),
          network,
        ),
      ).toThrow(`invalid address for ${network}`);
    });
  }

  it('rejects a same-network decoded address that disagrees with an addressable output script', async () => {
    const correct = payment('mainnet');
    const other = payment('mainnet', new Uint8Array(20));
    const conflicting = transaction({ address: other.address!, hex: bytesToHex(correct.output!) });
    expect(() => parseWorkspace(workspace('mainnet', conflicting))).toThrow(
      'does not match its script',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: conflicting }))),
    );
    await expect(fetchTransaction('mainnet', txid)).rejects.toThrow('does not match its script');
    expect(() =>
      validateTransactionAddresses(
        transaction({
          address: correct.address!,
          addresses: [other.address!],
          hex: bytesToHex(correct.output!),
        }),
        'mainnet',
      ),
    ).toThrow('does not match its script');
  });

  it('accepts equivalent uppercase witness addresses and valid address-only metadata', () => {
    const correct = payment('mainnet');
    expect(() =>
      validateTransactionAddresses(
        transaction({ address: correct.address!.toUpperCase(), hex: bytesToHex(correct.output!) }),
        'mainnet',
      ),
    ).not.toThrow();
    expect(() =>
      parseWorkspace(workspace('mainnet', transaction({ addresses: [correct.address!] }))),
    ).not.toThrow();
    expect(() =>
      validateTransactionAddresses(transaction({ address: 'invalid-public-example' }), 'mainnet'),
    ).toThrow('invalid address for mainnet');
  });

  it('keeps legacy bare-multisig/P2PK participant addresses without equating them with the whole script', () => {
    const participant = payments.p2pkh({ pubkey: publicKey }).address!;
    const multisig = payments.p2ms({ m: 1, pubkeys: [publicKey] }).output!;
    const p2pk = payments.p2pk({ pubkey: publicKey }).output!;
    for (const output of [multisig, p2pk])
      expect(() =>
        parseWorkspace(
          workspace('mainnet', transaction({ addresses: [participant], hex: bytesToHex(output) })),
        ),
      ).not.toThrow();
    const foreignParticipant = payments.p2pkh({
      pubkey: publicKey,
      network: networks.testnet,
    }).address!;
    expect(() =>
      validateTransactionAddresses(
        transaction({ addresses: [foreignParticipant], hex: bytesToHex(multisig) }),
        'mainnet',
      ),
    ).toThrow('invalid address for mainnet');
  });

  it('preserves script-only and opaque scripts without inventing address metadata', () => {
    for (const hex of ['6a', '51', bytesToHex(payment('testnet4').output!)]) {
      const tx = transaction({ hex });
      expect(parseWorkspace(workspace('testnet4', tx)).chainData.transactions[txid]).toEqual(tx);
    }
    // Decoded participant strings can accompany scripts with no single address.
    const validAddress = address.toBase58Check(publicHash, networks.bitcoin.pubKeyHash);
    expect(() =>
      validateTransactionAddresses(transaction({ address: validAddress, hex: '51' }), 'mainnet'),
    ).not.toThrow();
  });
});
