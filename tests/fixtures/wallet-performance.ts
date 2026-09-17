import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Wallet } from '../../src/Core/Workspace/Wallets/wallets';
import type { Workspace } from '../../src/Core/Workspace/workspace';
import { deriveAddresses } from '../../src/Core/Workspace/Wallets/walletDerivation';

import { createWorkspace } from '../../src/Core/Workspace/createWorkspace';

import { PUBLIC_ZPUB } from './bitcoin';

/** Synthetic loaded history using the public CC0 BIP84 account fixture. */
export function largeWalletFixture(addressCount = 600, transactionsPerAddress = 3): Workspace {
  const workspace = createWorkspace('Public large-wallet performance fixture', 'mainnet');
  const addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, addressCount);
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Public large wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: [],
    scannedAt: '2026-09-08T09:00:00.000Z',
    scanComplete: true,
    scanGap: 20,
    scanLimit: addressCount,
  };
  const external = bitcoinAddress.toBech32(new Uint8Array(20).fill(7), 0, 'bc');
  const externalScript = bytesToHex(bitcoinAddress.toOutputScript(external));
  for (const [index, address] of addresses.entries()) {
    const history: { tx_hash: string; height: number }[] = [];
    const hex = bytesToHex(bitcoinAddress.toOutputScript(address.address));
    let previous: string | undefined;
    for (let step = 0; step < transactionsPerAddress; step++) {
      const txid = (1 + index * transactionsPerAddress + step).toString(16).padStart(64, '0');
      const height = 800000 + index * transactionsPerAddress + step;
      workspace.chainData.transactions[txid] = {
        txid,
        vin: previous ? [{ txid: previous, vout: 0 }] : [{ coinbase: '00' }],
        vout: [
          { n: 0, value: 1 - step * 0.1, scriptPubKey: { hex, address: address.address } },
          { n: 1, value: 0.0999, scriptPubKey: { hex: externalScript, address: external } },
        ],
        vsize: 140,
        status: {
          kind: 'confirmed',
          blockHeight: height,
          confirmations: 900000 - height,
          blocktime: 1700000000 + index * transactionsPerAddress + step,
        },
      };
      history.push({ tx_hash: txid, height });
      previous = txid;
    }
    wallet.addresses.push({ ...address, history });
  }
  workspace.wallets.definitions = [wallet];
  workspace.view = {
    ...workspace.view,
    workbench: 'wallet',
    selectedWallet: wallet.id,
    lockToSelection: false,
    dimensions: 2,
  };
  return workspace;
}
