import { describe, expect, it } from 'vitest';
import { applyWalletScan } from '../../../src/Core/Workspace/Wallets/walletActivity';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import type { Wallet } from '../../../src/Core/Workspace/Wallets/wallets';

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

describe('capability results survive workspace format validation', () => {
  it('migrates the immediately preceding v6 activity shape before validation', () => {
    const current = createWorkspace('Activity migration', 'mainnet');
    const legacy = {
      ...current,
      version: 6,
      wallets: {
        ...current.wallets,
        definitions: [
          {
            ...wallet,
            lastActivity: {
              newTransactionIds: ['a'.repeat(64), 'b'.repeat(64)],
              refreshedTransactionCount: 3,
              missingTransactionCount: 1,
            },
          },
        ],
      },
    };
    const original = structuredClone(legacy);

    const parsed = parseWorkspace(legacy);
    expect(parsed.version).toBe(7);
    expect(parsed.wallets.definitions[0].lastActivity).toEqual({
      addedTransactionCount: 2,
      refreshedTransactionCount: 3,
      missingTransactionCount: 1,
    });
    expect(legacy).toEqual(original);
  });

  it('merges into current edits and never resurrects a removed wallet', () => {
    const current = {
      ...createWorkspace('Refresh', 'mainnet'),
      wallets: {
        ...createWorkspace('Refresh', 'mainnet').wallets,
        definitions: [{ ...wallet, name: 'Renamed during refresh' }],
      },
      annotations: {
        ...createWorkspace('Refresh', 'mainnet').annotations,
        entities: {
          [`tx:${txid}`]: {
            label: 'Exchange withdrawal',
            note: 'Keep this evidence',
            icon: 'star',
            bookmarked: true,
          },
        },
      },
    };
    const scanned = {
      ...wallet,
      scannedAt: '2026-09-08T10:00:00.000Z',
      lastActivity: {
        addedTransactionCount: 1,
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
    expect(merged.wallets.definitions[0].name).toBe('Renamed during refresh');
    expect(merged.annotations.entities).toBe(current.annotations.entities);
    expect(merged.wallets.definitions[0].lastActivity).toEqual(scanned.lastActivity);
    expect(parseWorkspace(merged).wallets.definitions[0].lastActivity).toEqual(
      scanned.lastActivity,
    );
    expect(Object.keys(applyWalletScan(merged, scanned, [tx]).chainData.transactions)).toEqual([
      txid,
    ]);
    const removed = { ...current, wallets: { ...current.wallets, definitions: [] } };
    expect(applyWalletScan(removed, scanned, [tx])).toBe(removed);
  });
  it('replaces the last scan summary without maintaining a second transaction queue', () => {
    const current = {
      ...createWorkspace('Activity', 'mainnet'),
      wallets: {
        ...createWorkspace('Activity', 'mainnet').wallets,
        definitions: [wallet],
      },
    };
    const scanned = {
      ...wallet,
      lastActivity: {
        addedTransactionCount: 0,
        refreshedTransactionCount: 0,
        missingTransactionCount: 0,
      },
    };
    expect(applyWalletScan(current, scanned, []).wallets.definitions[0].lastActivity).toEqual(
      scanned.lastActivity,
    );
  });
  it('bounds imported activity records and supports older wallets', () => {
    const workspace = {
      ...createWorkspace('Import', 'mainnet'),
      wallets: { ...createWorkspace('Import', 'mainnet').wallets, definitions: [wallet] },
    };
    expect(parseWorkspace(workspace).wallets.definitions[0].lastActivity).toBeUndefined();
    const activity = {
      addedTransactionCount: 1,
      refreshedTransactionCount: 0,
      missingTransactionCount: 0,
    };
    for (const invalid of [
      { ...activity, addedTransactionCount: -1 },
      { ...activity, addedTransactionCount: 501 },
      { ...activity, refreshedTransactionCount: 501 },
      { ...activity, missingTransactionCount: -1 },
    ])
      expect(() =>
        parseWorkspace({
          ...workspace,
          wallets: { ...workspace.wallets, definitions: [{ ...wallet, lastActivity: invalid }] },
        }),
      ).toThrow();
  });
});
