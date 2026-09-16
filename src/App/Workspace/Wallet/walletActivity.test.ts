import { describe, expect, it } from 'vitest';
import { applyWalletScan, walletCheckAge } from './walletActivity';
import { createWorkspace } from '../createWorkspace';
import { parseWorkspace } from '../Persistence/Format';
import type { Wallet } from '../../../Domain/Wallet/walletTypes';

const key =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const wallet: Wallet = {
  id: 'f27b07a5-afbe-4fa9-b390-fe4444d5bec6',
  name: 'Imported wallet',
  key,
  scriptType: 'p2wpkh',
  color: '#aabbcc',
  addresses: [],
};
const txid = 'a'.repeat(64);

describe('wallet refresh merging', () => {
  it('merges into current edits and never resurrects a removed wallet', () => {
    const current = {
      ...createWorkspace('Refresh', 'mainnet'),
      wallets: [{ ...wallet, name: 'Renamed during refresh' }],
      annotations: {
        [`tx:${txid}`]: {
          label: 'Exchange withdrawal',
          note: 'Keep this evidence',
          icon: 'star',
          bookmarked: true,
        },
      },
    };
    const scanned = {
      ...wallet,
      scannedAt: '2026-09-08T10:00:00.000Z',
      lastActivity: {
        newTransactionIds: [txid],
        refreshedTransactionCount: 0,
        missingTransactionCount: 0,
      },
    };
    const tx = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    };
    const merged = applyWalletScan(current, scanned, [tx]);
    expect(merged.wallets[0].name).toBe('Renamed during refresh');
    expect(merged.annotations).toBe(current.annotations);
    expect(merged.wallets[0].lastActivity).toEqual(scanned.lastActivity);
    expect(parseWorkspace(merged).wallets[0].lastActivity).toEqual(scanned.lastActivity);
    expect(Object.keys(applyWalletScan(merged, scanned, [tx]).transactions)).toEqual([txid]);
    const removed = { ...current, wallets: [] };
    expect(applyWalletScan(removed, scanned, [tx])).toBe(removed);
  });

  it('promotes a scoped input transaction discovered by wallet refresh even when its metadata is unchanged', () => {
    const tx = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
    };
    const current = {
      ...createWorkspace('Wallet discovery', 'mainnet'),
      wallets: [wallet],
      transactions: { [txid]: tx },
      inputContext: { [txid]: [0] },
    };
    const scanned = { ...wallet, scannedAt: '2026-09-08T10:00:00.000Z' };
    const merged = applyWalletScan(current, scanned, [structuredClone(tx)]);
    expect(merged.inputContext).toBeUndefined();
    expect(merged.transactions).toBe(current.transactions);
    expect(current.inputContext).toEqual({ [txid]: [0] });
    expect(applyWalletScan(current, scanned, []).inputContext).toBe(current.inputContext);
  });

  it('promotes cached wallet history during a quiet scan while retaining unrelated input context', () => {
    const other = 'b'.repeat(64);
    const tx = {
      txid,
      confirmations: 10,
      vin: [{ coinbase: '00' }],
      vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: {} })),
    };
    const current = {
      ...createWorkspace('Quiet wallet scan', 'mainnet'),
      wallets: [wallet],
      transactions: { [txid]: tx, [other]: { ...tx, txid: other } },
      inputContext: { [txid]: [0], [other]: [0] },
    };
    const scanned = {
      ...wallet,
      addresses: [
        {
          address: 'fixture',
          scripthash: txid,
          path: 'account/0/0',
          branch: 0 as const,
          index: 0,
          history: [{ tx_hash: txid, height: 100 }],
        },
      ],
    };
    const merged = applyWalletScan(current, scanned, []);
    expect(merged.inputContext).toEqual({ [other]: [0] });
    expect(merged.transactions).toBe(current.transactions);
    expect(current.inputContext).toEqual({ [txid]: [0], [other]: [0] });
    expect(applyWalletScan({ ...current, wallets: [] }, scanned, [])).toMatchObject({
      inputContext: current.inputContext,
    });
  });

  it('retains unreviewed activity across quiet checks and respects acknowledgment during I/O', () => {
    const current = {
      ...createWorkspace('Activity', 'mainnet'),
      wallets: [{ ...wallet, unreviewedTransactionIds: [txid] }],
    };
    const scanned = {
      ...wallet,
      lastActivity: {
        newTransactionIds: [],
        refreshedTransactionCount: 0,
        missingTransactionCount: 0,
      },
    };
    expect(applyWalletScan(current, scanned, []).wallets[0].unreviewedTransactionIds).toEqual([
      txid,
    ]);
    const acknowledged = { ...current, wallets: [{ ...wallet, unreviewedTransactionIds: [] }] };
    expect(
      applyWalletScan(acknowledged, { ...scanned, unreviewedTransactionIds: [txid] }, []).wallets[0]
        .unreviewedTransactionIds,
    ).toEqual([]);
    const many = Array.from({ length: 10000 }, (_, i) => i.toString(16).padStart(64, '0'));
    const bounded = applyWalletScan(
      { ...current, wallets: [{ ...wallet, unreviewedTransactionIds: many }] },
      { ...scanned, lastActivity: { ...scanned.lastActivity, newTransactionIds: [txid] } },
      [],
    );
    expect(bounded.wallets[0].unreviewedTransactionIds).toHaveLength(10000);
    expect(bounded.wallets[0].unreviewedTransactionIds?.at(-1)).toBe(txid);
    expect(bounded.wallets[0].activityOverflow).toBe(true);
    expect(parseWorkspace(bounded).wallets[0].activityOverflow).toBe(true);
  });

  it('bounds imported activity records and supports older wallets', () => {
    const workspace = { ...createWorkspace('Import', 'mainnet'), wallets: [wallet] };
    expect(parseWorkspace(workspace).wallets[0].lastActivity).toBeUndefined();
    const activity = {
      newTransactionIds: [txid],
      refreshedTransactionCount: 0,
      missingTransactionCount: 0,
    };
    for (const invalid of [
      { ...activity, newTransactionIds: ['bad'] },
      { ...activity, newTransactionIds: Array(501).fill(txid) },
      { ...activity, refreshedTransactionCount: 501 },
      { ...activity, missingTransactionCount: -1 },
    ])
      expect(() =>
        parseWorkspace({ ...workspace, wallets: [{ ...wallet, lastActivity: invalid }] }),
      ).toThrow();
  });

  it('makes an old snapshot visible without treating clock skew as negative age', () => {
    const now = Date.parse('2026-09-08T10:00:00Z');
    expect(walletCheckAge(undefined, now)).toBe('Not checked yet');
    expect(walletCheckAge('2026-09-05T10:00:00Z', now)).toBe('Checked 3 days ago');
    expect(walletCheckAge('2026-09-09T10:00:00Z', now)).toBe('Checked just now');
  });
});
