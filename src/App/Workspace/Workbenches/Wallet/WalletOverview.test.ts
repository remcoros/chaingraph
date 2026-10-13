// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WalletOverview } from './WalletOverview';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import { deriveAddresses } from '../../../../Core/Workspace/Wallets/walletDerivation';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';

afterEach(cleanup);
function fixture(): ComponentProps<typeof WalletOverview> {
  const workspace = createWorkspace('Public overview fixture', 'mainnet');
  const wallet = {
    id: 'public-wallet',
    name: 'Public wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: [],
    scannedAt: '2026-09-01T10:00:00.000Z',
    refreshedAt: '2026-09-02T10:00:00.000Z',
    scanComplete: true,
    scanGap: 20,
    scanLimit: 200,
  };
  workspace.wallets.definitions = [wallet];
  return {
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
    canLoadChainData: true,
    busy: false,
    active: true,
    onSelectWallet: vi.fn(),
    onAddWallet: vi.fn(),
    onRefresh: vi.fn(),
    onExchangeLabels: vi.fn(),
    discovery: {
      gapLimit: 20,
      setGapLimit: vi.fn(),
      addressesPerBranch: 200,
      setAddressesPerBranch: vi.fn(),
      monitorActivity: true,
      setMonitorActivity: vi.fn(),
      refreshIntervalSeconds: 60,
      setRefreshIntervalSeconds: vi.fn(),
    },
  };
}

it('distinguishes historical checks from current candidates and preserves the check action', () => {
  const props = fixture();
  render(createElement(WalletOverview, props));
  expect(within(screen.getByRole('status')).getByText(/Balance needs refresh/)).toBeDefined();
  expect(screen.getByText(/Partial balance/)).toBeDefined();
  expect(document.querySelector('header time')?.getAttribute('datetime')).toBe(
    props.wallet.refreshedAt,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh wallet' }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Wallet actions' }));
  expect(screen.queryByRole('menuitem', { name: 'Rerun analysis' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: /Import wallet metadata/ }));
  expect(props.onExchangeLabels).toHaveBeenLastCalledWith('import');
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Wallet actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Export wallet metadata/ }));
  expect(props.onExchangeLabels).toHaveBeenLastCalledWith('export');
  expect(screen.queryByRole('menu')).toBeNull();
});

it('keeps background and successful refreshes quiet while failed attempts offer recovery', () => {
  const props = fixture();
  props.coverage.utxoLoadedSpenders = 0;
  props.refresh = {
    walletId: props.wallet.id,
    loading: true,
    message: 'Loading transaction details 4 of 8',
    error: '',
  };
  const view = render(createElement(WalletOverview, props));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(props.refresh.message)).toBeNull();
  expect(screen.getByRole('button', { name: 'Refresh wallet' }).getAttribute('aria-busy')).toBe(
    'true',
  );
  expect(document.querySelector('header time')?.getAttribute('datetime')).toBe(
    props.wallet.refreshedAt,
  );

  props.coinIssues = 'Synthetic coin observations remain excluded';
  view.rerender(createElement(WalletOverview, props));
  expect(within(screen.getByRole('status')).getByText(props.coinIssues)).toBeDefined();
  props.coinIssues = '';
  props.refresh = { ...props.refresh, loading: false, error: 'Synthetic upstream unavailable' };
  view.rerender(createElement(WalletOverview, props));
  const status = screen.getByRole('status');
  expect(within(status).getByText(props.refresh.error)).toBeDefined();
  fireEvent.click(within(status).getByRole('button', { name: /retry/i }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(document.querySelector('header time')?.getAttribute('datetime')).toBe(
    props.wallet.refreshedAt,
  );
  props.refresh = { ...props.refresh, error: '', message: 'Refresh complete' };
  view.rerender(createElement(WalletOverview, props));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(props.refresh.message)).toBeNull();
});

function reachedLimit(limit: number) {
  const props = fixture();
  props.coverage.scanComplete = false;
  props.wallet.scanComplete = false;
  props.wallet.scanLimit = limit;
  props.discovery!.addressesPerBranch = limit;
  props.wallet.addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, limit - 1, 1).map(
    (entry) => ({ ...entry, history: [] }),
  );
  return props;
}

it('hands a reached address limit to the existing settings form before the next refresh', () => {
  const props = reachedLimit(200);
  render(createElement(WalletOverview, props));
  const status = screen.getByRole('status');
  expect(within(status).queryByRole('button', { name: /retry/i })).toBeNull();
  fireEvent.click(within(status).getByRole('button', { name: /settings/i }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: /addresses per branch/i }), {
    target: { value: '400' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
  expect(props.discovery!.setAddressesPerBranch).toHaveBeenCalledWith(400);
  expect(props.onRefresh).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh wallet' }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
});

it('keeps a supported search cap visible without offering another search as a recovery', () => {
  const props = reachedLimit(1000);
  render(createElement(WalletOverview, props));
  expect(within(screen.getByRole('status')).getByText(/1,000/)).toBeDefined();
  expect(within(screen.getByRole('status')).queryByRole('button')).toBeNull();
  // Refresh still updates known addresses and coins at the supported cap.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh wallet' }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
});

it('shows the unavailable-chain reason even when a balance issue is also present', () => {
  const props = fixture();
  props.canLoadChainData = false;
  props.chainDataDisabledReason = 'Synthetic backend disconnected';
  render(createElement(WalletOverview, props));
  expect(within(screen.getByRole('status')).getByText(props.chainDataDisabledReason)).toBeDefined();
  expect(
    (screen.getByRole('button', { name: 'Refresh wallet' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(within(screen.getByRole('status')).queryByRole('button', { name: /retry/i })).toBeNull();
});
