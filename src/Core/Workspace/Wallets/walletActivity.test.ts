import { describe, expect, it } from 'vitest';
import { applyWalletScan, carryScanMetadata, walletCheckAge } from './walletActivity';
import { createWorkspace } from '../createWorkspace';
import type { Wallet } from './wallets';

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
  it.each([{ key: 'changed public account' }, { scriptType: 'p2pkh' as const }])(
    'rejects scan results and undo metadata for a replaced wallet binding: %o',
    (binding) => {
      const current = createWorkspace('Replaced wallet', 'mainnet');
      current.wallets.definitions = [{ ...wallet, ...binding }];
      const scanned = { ...wallet, scannedAt: '2026-09-08T10:00:00Z' };
      expect(applyWalletScan(current, scanned, [])).toBe(current);
      const latest = { ...current, wallets: { ...current.wallets, definitions: [scanned] } };
      expect(carryScanMetadata(current, latest)).toBe(current);
    },
  );
  it('promotes a scoped input transaction discovered by wallet refresh even when its metadata is unchanged', () => {
    const tx = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
    };
    const current = {
      ...createWorkspace('Wallet discovery', 'mainnet'),
      wallets: { ...createWorkspace('Wallet discovery', 'mainnet').wallets, definitions: [wallet] },
      chainData: {
        ...createWorkspace('Wallet discovery', 'mainnet').chainData,
        transactions: { [txid]: tx },
      },
      view: {
        ...createWorkspace('Wallet discovery', 'mainnet').view,
        inputContext: { [txid]: [0] },
      },
    };
    const scanned = { ...wallet, scannedAt: '2026-09-08T10:00:00.000Z' };
    const merged = applyWalletScan(current, scanned, [structuredClone(tx)]);
    expect(merged.view.inputContext).toBeUndefined();
    expect(merged.chainData.transactions).toBe(current.chainData.transactions);
    expect(current.view.inputContext).toEqual({ [txid]: [0] });
    expect(applyWalletScan(current, scanned, []).view.inputContext).toBe(current.view.inputContext);
  });

  it('promotes cached wallet history during a quiet scan while retaining unrelated input context', () => {
    const other = 'b'.repeat(64);
    const tx = {
      txid,
      vin: [{ coinbase: '00' }],
      vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: {} })),
      status: { kind: 'confirmed' as const, confirmations: 10 },
    };
    const current = {
      ...createWorkspace('Quiet wallet scan', 'mainnet'),
      wallets: {
        ...createWorkspace('Quiet wallet scan', 'mainnet').wallets,
        definitions: [wallet],
      },
      chainData: {
        ...createWorkspace('Quiet wallet scan', 'mainnet').chainData,
        transactions: { [txid]: tx, [other]: { ...tx, txid: other } },
      },
      view: {
        ...createWorkspace('Quiet wallet scan', 'mainnet').view,
        inputContext: { [txid]: [0], [other]: [0] },
      },
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
    expect(merged.view.inputContext).toEqual({ [other]: [0] });
    expect(merged.chainData.transactions).toBe(current.chainData.transactions);
    expect(current.view.inputContext).toEqual({ [txid]: [0], [other]: [0] });
    expect(
      applyWalletScan(
        { ...current, wallets: { ...current.wallets, definitions: [] } },
        scanned,
        [],
      ),
    ).toMatchObject({ view: { inputContext: current.view.inputContext } });
  });

  it('makes an old snapshot visible without treating clock skew as negative age', () => {
    const now = Date.parse('2026-09-08T10:00:00Z');
    expect(walletCheckAge(undefined, now)).toBe('Not checked yet');
    expect(walletCheckAge('2026-09-05T10:00:00Z', now)).toBe('Checked 3 days ago');
    expect(walletCheckAge('2026-09-09T10:00:00Z', now)).toBe('Checked just now');
  });
});
