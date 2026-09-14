import { describe, expect, it } from 'vitest';
import {
  walletScanScope,
  walletScanSummary,
} from '../src/App/Workspace/Workbenches/Wallet/useWalletScan';
import { scanDefaults, type AnalysisScan } from '../src/Domain/Analysis/analysisScan';
import { newWorkspace } from '../src/Domain/Workspace/workspace';
import { deriveAddresses } from '../src/Domain/Wallet/wallet';
import type { Wallet } from '../src/Domain/types';
import type { WalletRow } from '../src/Domain/Wallet/walletWorkbenchRows';
import { PUBLIC_ZPUB, TX_FUNDING, TX_SPENDING, transactions } from './fixtures/bitcoin';

function fixture() {
  const workspace = newWorkspace('Public scan fixture', 'mainnet');
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Public scan wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1),
  };
  workspace.wallets = [wallet];
  workspace.transactions = structuredClone(transactions);
  workspace.transactions['c'.repeat(64)] = {
    txid: 'c'.repeat(64),
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 0, scriptPubKey: { hex: '6a' } }],
  };
  return { workspace, wallet };
}

describe('Wallet scan scope', () => {
  it('does not describe inapplicable tools as a permanently partial scan', () => {
    const { workspace, wallet } = fixture();
    const scan: AnalysisScan = {
      scope: walletScanScope(workspace, wallet),
      options: scanDefaults(),
      findings: [],
      runAt: '2026-09-09T10:00:00Z',
      reports: [
        { toolId: 'wallet-intersections', status: 'skipped', message: 'Requires two wallets.' },
      ],
    };
    expect(walletScanSummary(scan)).toBe('0 findings');
    scan.reports[0].status = 'error';
    expect(walletScanSummary(scan)).toBe('0 findings · 1 tool failed');
  });
  it('scans loaded wallet transactions without unrelated workspace records', () => {
    const { workspace, wallet } = fixture();
    const scope = walletScanScope(workspace, wallet);
    expect(scope.kind).toBe('wallet');
    expect(scope.txids.sort()).toEqual([TX_FUNDING, TX_SPENDING].sort());
    expect(scope.txids).not.toContain('c'.repeat(64));
  });

  it('keeps grouped address scans inside their selected-wallet relationship contexts', () => {
    const { workspace, wallet } = fixture();
    const address = wallet.addresses[0].address;
    const row: WalletRow = {
      key: `addr:${address}`,
      nodeId: `addr:${address}`,
      identifier: address,
      title: address,
      description: '',
      kind: 'address',
      address,
      meta: '',
      contextTransactionIds: [TX_FUNDING, '9'.repeat(64)],
      relationshipDirection: 'source',
      reviews: [],
      status: 'open',
      changed: false,
    };
    const scope = walletScanScope(workspace, wallet, row);
    expect(scope.kind).toBe('address');
    expect(scope.txids).toEqual([TX_FUNDING]);
    expect(scope.txids).not.toContain(TX_SPENDING);
  });
});
