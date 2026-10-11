// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WalletOverview } from './WalletOverview';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';

afterEach(cleanup);
it('distinguishes historical checks from current candidates and preserves the check action', () => {
  const workspace = createWorkspace('Public overview fixture', 'mainnet');
  const wallet = {
    id: 'public-wallet',
    name: 'Public wallet',
    key: '',
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: [],
  };
  workspace.wallets.definitions = [wallet];
  const check = vi.fn();
  const exchange = vi.fn();
  const props: ComponentProps<typeof WalletOverview> = {
    workspace,
    wallet,
    coverage: {
      scanComplete: true,
      discoveredAddresses: 1,
      usedAddresses: 1,
      knownTransactions: 2,
      loadedTransactions: 2,
      pendingTransactions: 0,
      utxoCount: 0,
      utxoBalanceSats: 0,
      utxoPartial: false,
      utxoLoadedSpenders: 1,
    },
    utxos: {
      records: [],
      checkedAt: '2026-09-01T10:00:00.000Z',
      checkedAddresses: 1,
      totalAddresses: 1,
      failed: 0,
    },
    canLoadChainData: true,
    busy: false,
    active: true,
    analysisStatus: '',
    onSelectWallet: vi.fn(),
    onAddWallet: vi.fn(),
    onRefresh: check,
    onExchangeLabels: exchange,
  };
  render(createElement(WalletOverview, props));
  expect(screen.getByText('Coins at last check')).toBeDefined();
  expect(screen.getByText(/0 remaining candidates/)).toBeDefined();
  expect(screen.getByText(/Balance needs refresh/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh wallet' }));
  expect(check).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Wallet actions' }));
  expect(
    screen.getByRole('menuitem', { name: 'Wallet details…' }).querySelector('svg'),
  ).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Rerun analysis' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: /Import wallet metadata/ }));
  expect(exchange).toHaveBeenLastCalledWith('import');
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Wallet actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Export wallet metadata/ }));
  expect(exchange).toHaveBeenLastCalledWith('export');
  expect(screen.queryByRole('menu')).toBeNull();
});
