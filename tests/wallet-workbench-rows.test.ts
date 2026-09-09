import { describe, expect, it } from 'vitest';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { newWorkspace } from '../src/domain/workspace';
import { deriveAddresses } from '../src/lib/wallet';
import {
  buildWalletRecordRows,
  matchesWalletStatus,
  walletRowTags,
  walletRowWithContext,
  buildWalletRelationshipRows,
  resolveWalletRow,
  reviewRow,
  walletSelectAll,
} from '../src/domain/walletWorkbenchRows';
import { PUBLIC_ZPUB } from './fixtures/bitcoin';
import { addressNodeId, outputNodeId, type Wallet } from '../src/domain/types';
import { buildWalletReview } from '../src/domain/walletReview';
import { groupWalletRelationships } from '../src/domain/walletRelationships';
import { matchRelatedEntities } from '../src/domain/walletReviewContext';

const A = 'a'.repeat(64),
  B = 'b'.repeat(64),
  C = 'c'.repeat(64);
function fixture() {
  const workspace = newWorkspace('Public row fixture', 'mainnet');
  const addresses = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2);
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Public wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: addresses.map((entry, index) => ({
      ...entry,
      history: [
        { tx_hash: index ? B : A, height: 800000 },
        { tx_hash: C, height: 800001 },
      ],
    })),
  };
  const script = (index: number) => ({
    hex: bytesToHex(bitcoinAddress.toOutputScript(addresses[index].address)),
  });
  workspace.wallets = [wallet];
  workspace.transactions = {
    [A]: {
      txid: A,
      vin: [{ txid: '9'.repeat(64), vout: 0 }],
      vout: [{ n: 0, value: 1, scriptPubKey: script(0) }],
    },
    [B]: {
      txid: B,
      vin: [{ txid: A, vout: 0 }],
      vout: [{ n: 0, value: 0.9, scriptPubKey: script(1) }],
    },
    [C]: {
      txid: C,
      vin: [{ coinbase: '00' }],
      vout: [{ n: 0, value: 0, scriptPubKey: { hex: '6a' } }],
    },
  };
  return { workspace, wallet, addresses };
}

describe('shared Wallet rows', () => {
  it('projects address metadata targets and keeps source and destination decisions separate', () => {
    const { workspace, wallet, addresses } = fixture();
    const counterparty = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 2, 1)[0].address;
    const parent = 'd'.repeat(64);
    workspace.transactions[parent] = {
      txid: parent,
      vin: [{ coinbase: '00' }],
      vout: [
        {
          n: 0,
          value: 0.2,
          scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(counterparty)) },
        },
      ],
    };
    workspace.transactions[B].vin.push({ txid: parent, vout: 0 });
    workspace.transactions[B].vout.push({
      n: 1,
      value: 0.05,
      scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(counterparty)) },
    });
    const groups = groupWalletRelationships(workspace, wallet);
    const rows = buildWalletRelationshipRows(
      workspace,
      groups,
      buildWalletReview(workspace, wallet).items,
    );
    const id = addressNodeId(counterparty);
    const source = rows.sources.find((row) => row.nodeId === id)!;
    const destination = rows.destinations.find((row) => row.nodeId === id)!;
    expect(source.kind).toBe('address');
    expect(source.outpointIds).toEqual([outputNodeId(parent, 0)]);
    expect(source.reviews.map((item) => item.reason)).toEqual(['source-address']);
    expect(destination.reviews.map((item) => item.reason)).toEqual(['destination-address']);
    expect(walletRowWithContext(workspace, source).contextTransactionIds).toEqual([B]);
    expect(source.contextTransactionIds).not.toContain(A);
    expect(rows.sources).toHaveLength(1);
    expect(rows.destinations).toHaveLength(1);
    expect(rows.sources.some((row) => row.address === addresses[0].address)).toBe(false);
  });

  it('retains the resolved subject when a missing outpoint becomes an address group', () => {
    const { workspace, wallet } = fixture();
    const missing = reviewRow(
      buildWalletReview(workspace, wallet).items.find(
        (item) => item.reason === 'funding-source' && !item.address,
      )!,
    );
    const address = buildWalletRecordRows(workspace, wallet, [], []).addresses[0];
    const resolved = { ...address, key: 'resolved', outpointIds: [missing.nodeId] };
    expect(resolveWalletRow([address, resolved], missing.key, missing)).toBe(resolved);
    expect(resolveWalletRow([address, resolved], address.key, missing)).toBe(address);
    expect(resolveWalletRow([address], missing.key, missing)).toBe(address);
    expect(resolveWalletRow([resolved, address], undefined, address)).toBe(address);
  });

  it('toggles all matching rows without clearing hidden selections on unselect', () => {
    expect(walletSelectAll(['outside'], ['one', 'two'])).toEqual({
      allSelected: false,
      next: ['one', 'two'],
    });
    expect(walletSelectAll(['one', 'two', 'outside'], ['one', 'two'])).toEqual({
      allSelected: true,
      next: ['outside'],
    });
    expect(walletSelectAll(['outside'], []).allSelected).toBe(false);
  });

  it('builds only the requested record list', () => {
    const { workspace, wallet } = fixture();
    const rows = buildWalletRecordRows(workspace, wallet, [], [], 'addresses');
    expect(rows.addresses).toHaveLength(2);
    expect(rows.transactions).toEqual([]);
    expect(rows.utxos).toEqual([]);
  });

  it('selects exact one-hop transaction contexts for grouped addresses without widening output scope', () => {
    const candidates = [
      { id: 'address-one', transactionIds: [A, B] },
      { id: 'address-two', transactionIds: [B] },
      { id: 'address-three', transactionIds: [C] },
      { id: 'output', txid: C, transactionIds: [B] },
    ];
    expect(matchRelatedEntities(candidates, [candidates[1]], 'transaction')).toEqual([
      'address-one',
      'address-two',
    ]);
    expect(matchRelatedEntities(candidates, [candidates[3]], 'transaction')).toEqual([
      'address-three',
      'output',
    ]);
  });

  it('offers all verified address transaction contexts, without treating history as a script match', () => {
    const { workspace, wallet, addresses } = fixture();
    const rows = buildWalletRecordRows(workspace, wallet, [], []);
    expect(walletRowWithContext(workspace, rows.addresses[0]).contextTransactionIds).toEqual([
      A,
      B,
    ]);
    expect(walletRowWithContext(workspace, rows.addresses[1]).contextTransactionIds).toEqual([B]);
    expect(rows.addresses[0].nodeId).toBe(addressNodeId(addresses[0].address));
    expect(walletRowWithContext(workspace, rows.addresses[0]).contextTransactionIds).not.toContain(
      C,
    );
    // Reported history remains discoverable in Transactions, without inventing address flow.
    expect(rows.transactions.some((row) => row.txid === C)).toBe(true);
  });

  it('keeps legacy unknown decisions completed on UTXO and transaction rows', () => {
    const { workspace, wallet, addresses } = fixture();
    workspace.walletReviews = {
      [`${wallet.id}|current-utxo|${B}:0`]: {
        status: 'unknown',
        at: '2026-09-09T12:00:00Z',
        evidence: 'old-evidence',
      },
      [`${wallet.id}|new-activity|${B}`]: {
        status: 'unknown',
        at: '2026-09-09T12:00:00Z',
        evidence: 'old-activity',
      },
    };
    const rows = buildWalletRecordRows(
      workspace,
      wallet,
      [
        {
          txid: B,
          vout: 0,
          valueSats: 90_000_000,
          height: 800000,
          address: addresses[1].address,
          scripthash: addresses[1].scripthash,
        },
      ],
      [],
    );
    for (const row of [rows.utxos[0], rows.transactions.find((row) => row.txid === B)!]) {
      expect(row.status).toBe('unknown');
      expect(matchesWalletStatus(row, 'decided')).toBe(true);
      expect(matchesWalletStatus(row, 'open')).toBe(false);
      expect(matchesWalletStatus(row, 'later')).toBe(false);
    }
  });

  it('uses canonical metadata subjects and effective address tags without widening their scope', () => {
    const { workspace, wallet, addresses } = fixture();
    workspace.tags = [
      {
        id: '40000000-0000-4000-8000-000000000001',
        name: 'Public reserve',
        color: '#27c4a7',
        nodeIds: [addressNodeId(addresses[1].address)],
      },
    ];
    const rows = buildWalletRecordRows(
      workspace,
      wallet,
      [
        {
          txid: B,
          vout: 0,
          valueSats: 90_000_000,
          height: 800000,
          address: addresses[1].address,
          scripthash: addresses[1].scripthash,
        },
      ],
      [],
    );
    expect(rows.utxos[0].nodeId).toBe(outputNodeId(B, 0));
    expect(walletRowTags(workspace, rows.utxos[0]).map((tag) => tag.name)).toEqual([
      'Public reserve',
    ]);
    expect(walletRowTags(workspace, rows.addresses[0])).toEqual([]);
  });
});
