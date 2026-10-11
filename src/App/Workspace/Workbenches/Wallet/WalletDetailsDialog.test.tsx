// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WalletDetailsDialog } from './WalletDetailsDialog';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';
import type { Wallet } from '../../../../Core/Workspace/Wallets/wallets';

const wallet: Wallet = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Public wallet',
  key: PUBLIC_ZPUB,
  scriptType: 'p2wpkh',
  color: '#27c4a7',
  addresses: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows account facts without inventing a full derivation path and keeps the key read-only', () => {
  render(createElement(WalletDetailsDialog, { wallet, network: 'mainnet', onClose: vi.fn() }));
  expect(screen.getByRole('dialog', { name: 'Wallet details' })).toBeDefined();
  expect(screen.getByText('Mainnet')).toBeDefined();
  expect(screen.getByText('Native SegWit · P2WPKH')).toBeDefined();
  expect(screen.getByText('0 · hardened child at depth 3')).toBeDefined();
  expect(screen.getByText('Full origin path unavailable from the account key')).toBeDefined();
  expect(screen.queryByText(/m\/84/)).toBeNull();
  const key = screen.getByLabelText('Extended public key (read-only)') as HTMLTextAreaElement;
  expect(key.readOnly).toBe(true);
  expect(key.value).not.toContain(PUBLIC_ZPUB);
  fireEvent.click(screen.getByRole('button', { name: 'Show extended public key' }));
  expect(key.value).toBe(PUBLIC_ZPUB);
  fireEvent.click(screen.getByRole('button', { name: 'Hide extended public key' }));
  expect(key.value).not.toContain(PUBLIC_ZPUB);
});

it('copies the exact imported account key and delegates rename through the existing action', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const onClose = vi.fn(),
    onEditWallet = vi.fn();
  render(createElement(WalletDetailsDialog, { wallet, network: 'mainnet', onClose, onEditWallet }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy account key' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(PUBLIC_ZPUB));
  fireEvent.click(screen.getByRole('button', { name: 'Rename wallet' }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onEditWallet).toHaveBeenCalledWith(wallet.id);
});

it('keeps preview details usable without falsely identifying an account', () => {
  render(
    createElement(WalletDetailsDialog, {
      wallet: { ...wallet, key: '' },
      network: 'testnet4',
      onClose: vi.fn(),
    }),
  );
  expect(screen.getByText('Testnet4')).toBeDefined();
  expect(screen.getByText('Account key unavailable')).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Copy account key' })).toBeNull();
});

it('closes through the shared dialog Escape behavior', () => {
  const onClose = vi.fn();
  render(createElement(WalletDetailsDialog, { wallet, network: 'mainnet', onClose }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});
