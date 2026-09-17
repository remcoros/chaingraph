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
    utxoLoading: false,
    canLoadChainData: true,
    busy: false,
    active: true,
    analyzing: false,
    analysisStatus: '',
    onSelectWallet: vi.fn(),
    onAddWallet: vi.fn(),
    onRefresh: vi.fn(),
    onCheck: check,
    onAnalyze: vi.fn(),
  };
  render(createElement(WalletOverview, props));
  expect(screen.getByText('UTXOs at last check')).toBeDefined();
  expect(screen.getByText(/0 remaining candidates/)).toBeDefined();
  expect(screen.getByText(/Historical checks retained; use Check UTXOs/)).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Check current UTXOs' }));
  expect(check).toHaveBeenCalledOnce();
});
