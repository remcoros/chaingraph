import { describe, expect, it } from 'vitest';
import { readWalletUtxoCheck } from './walletUtxoCheck';
import { deriveAddresses } from '../walletDerivation';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../../Persistence';
import { PUBLIC_ZPUB } from '../../../../../tests/fixtures/bitcoin';
import { WalletPreparationCache } from '../walletPreparation';

const oldTime = '2026-09-16T10:00:00.000Z';
const newTime = '2026-09-16T11:00:00.000Z';
const output = { txid: 'a'.repeat(64), vout: 0, valueSats: 100, height: 1 };
function fixture() {
  const workspace = createWorkspace('Public UTXO fixture', 'mainnet');
  const wallet = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Public vector',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#ffffff',
    addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2),
  };
  workspace.wallets.definitions = [wallet];
  workspace.chainData.addressUtxos = {
    [wallet.addresses[0].address]: { network: 'mainnet', utxos: [output], checkedAt: oldTime },
  };
  return { workspace, wallet };
}

describe('wallet projection of retained UTXO observations', () => {
  it('distinguishes unobserved addresses from successfully checked empty addresses', () => {
    const { workspace, wallet } = fixture();
    expect(readWalletUtxoCheck(workspace, wallet)).toMatchObject({
      checkedAddresses: 1,
      totalAddresses: 2,
      nextCursor: 1,
      checkedAt: oldTime,
    });
    workspace.chainData.addressUtxos![wallet.addresses[1].address] = {
      network: 'mainnet',
      utxos: [],
      checkedAt: newTime,
    };
    expect(readWalletUtxoCheck(workspace, wallet)).toMatchObject({
      checkedAddresses: 2,
      totalAddresses: 2,
      nextCursor: undefined,
      checkedAt: oldTime,
    });
    workspace.chainData.addressUtxos = {};
    expect(readWalletUtxoCheck(workspace, wallet)).toBeUndefined();
  });

  it('retains coverage and the original age through full document parsing', () => {
    const { workspace, wallet } = fixture();
    const restored = parseWorkspace(JSON.parse(JSON.stringify(workspace)));
    expect(readWalletUtxoCheck(restored, restored.wallets.definitions[0])).toEqual(
      readWalletUtxoCheck(workspace, wallet),
    );
    expect(restored.wallets.definitions[0]).not.toHaveProperty('utxos');
  });

  it('keeps historical UTXOs through parsing while recomputing recommendations against loaded spenders', () => {
    const { workspace, wallet } = fixture();
    const spender = 'b'.repeat(64);
    workspace.chainData.transactions[spender] = {
      txid: spender,
      vin: [{ txid: output.txid, vout: 0 }],
      vout: [{ n: 0, value: 0, scriptPubKey: { hex: '6a' } }],
    };
    const restored = parseWorkspace(JSON.parse(JSON.stringify(workspace)));
    const check = readWalletUtxoCheck(restored, restored.wallets.definitions[0])!;
    expect(check.records).toHaveLength(1);
    expect(check.checkedAt).toBe(oldTime);
    const prepared = new WalletPreparationCache().prepare(restored, wallet, check);
    expect(prepared.currentUtxos).toEqual([]);
    expect(prepared.invalidCount).toBe(0);
    expect(prepared.review.coverage.utxoLoadedSpenders).toBe(1);
    expect(restored.chainData.addressUtxos).toEqual(workspace.chainData.addressUtxos);
  });

  it('keeps the oldest contributing age after only one address refreshes', () => {
    const { workspace, wallet } = fixture();
    workspace.chainData.addressUtxos![wallet.addresses[1].address] = {
      network: 'mainnet',
      utxos: [{ ...output, txid: 'b'.repeat(64) }],
      checkedAt: newTime,
    };
    expect(readWalletUtxoCheck(workspace, wallet)?.checkedAt).toBe(oldTime);
    workspace.chainData.addressUtxos![wallet.addresses[0].address] = {
      network: 'mainnet',
      utxos: [],
      checkedAt: newTime,
    };
    const view = readWalletUtxoCheck(workspace, wallet)!;
    expect(view.checkedAt).toBe(newTime);
    expect(view.records.map((record) => record.txid)).toEqual(['b'.repeat(64)]);
  });

  it('does not turn conflicting address claims into positive UTXO evidence', () => {
    const { workspace, wallet } = fixture();
    workspace.chainData.addressUtxos![wallet.addresses[1].address] = {
      network: 'mainnet',
      utxos: [output],
      checkedAt: newTime,
    };
    const view = readWalletUtxoCheck(workspace, wallet)!;
    expect(view.records).toEqual([]);
    expect(view.failed).toBe(1);
  });

  it('does not lend another network or wallet the retained observation', () => {
    const { workspace, wallet } = fixture();
    expect(readWalletUtxoCheck({ ...workspace, network: 'testnet4' }, wallet)).toBeUndefined();
    expect(readWalletUtxoCheck(workspace, { addresses: [wallet.addresses[1]] })).toBeUndefined();
  });
});
