import { expect, it } from 'vitest';
import { walletDiscoveryStatus } from './walletDiscoveryStatus';
import { deriveAddresses } from '../../../../Core/Workspace/Wallets/walletDerivation';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';

import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';

const wallet = (): Wallet => ({
  id: '50000000-0000-4000-8000-000000000001',
  name: 'Public coverage wallet',
  key: PUBLIC_ZPUB,
  scriptType: 'p2wpkh',
  color: '#27c4a7',
  addresses: [],
  scannedAt: '2026-09-09T10:00:00Z',
  scanComplete: true,
  scanLimit: 200,
  scanGap: 20,
});

it('does not turn missing counterparty prevouts into a wallet discovery warning', () => {
  expect(walletDiscoveryStatus(wallet())).toBeUndefined();
});

it('identifies an address limit and tells the user where it can be increased', () => {
  const current = wallet();
  current.scanComplete = false;
  current.addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 190, 10).map(
    (entry) => ({ ...entry, history: [] }),
  );
  expect(walletDiscoveryStatus(current)).toEqual({
    text: 'Address limit: 200/branch',
    hint: 'Increase Addresses / branch in Graph wallet controls, then Refresh.',
  });
});

it('distinguishes queued history from incomplete address discovery', () => {
  const current = wallet();
  current.scanComplete = false;
  current.pendingTransactionIds = ['a'.repeat(64)];
  expect(walletDiscoveryStatus(current)).toBeUndefined();
  current.pendingTransactionIds = [];
  expect(walletDiscoveryStatus(current)?.text).toBe('Refresh to finish address discovery');
});

it('does not suggest repeating a scan beyond the supported address cap', () => {
  const current = wallet();
  current.scanComplete = false;
  current.scanLimit = 1000;
  current.addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 999, 1).map((entry) => ({
    ...entry,
    history: [],
  }));
  expect(walletDiscoveryStatus(current)?.hint).toContain(
    'Repeating the same scan cannot search further',
  );
});
