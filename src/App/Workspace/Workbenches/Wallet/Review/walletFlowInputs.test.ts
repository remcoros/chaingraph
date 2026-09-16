import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../../../../../Domain/Chain/transaction';
import type { WalletReviewFlowEntry } from '../walletReviewContext';
import { indexPreviousOutputs } from '../../../../../Domain/Chain/prevouts';
import { buildGraph } from '../../../GraphState/graphEvidence';
import { createWorkspace } from '../../../createWorkspace';
import { parseWorkspace } from '../../../Persistence/Format';
import {
  loadWalletFlowInputWave,
  mergeWalletFlowInputs,
  walletFlowInputPlan,
  walletFlowSourceKey,
} from './walletFlowInputs';
import { PUBLIC_ZPUB, transactions, TX_FUNDING } from '../../../../../../tests/fixtures/bitcoin';

const parent = 'a'.repeat(64);
const child = 'c'.repeat(64);
const grandparent = 'b'.repeat(64);
const walletId = '50000000-0000-4000-8000-000000000001';
const tx = (txid: string, count = 1): Transaction => ({
  txid,
  vin: [{ coinbase: '00' }],
  vout: Array.from({ length: count }, (_, n) => ({
    n,
    value: 1,
    scriptPubKey: { hex: '51' },
  })),
});
const input = (txid = parent, vout = 0): WalletReviewFlowEntry => ({
  id: `out:${txid}:${vout}`,
  txid,
  vout,
  selected: false,
  ownership: 'unknown',
  missing: true,
});
const fixture = () => {
  const workspace = createWorkspace('Visible input fixture', 'mainnet');
  workspace.wallets = [
    {
      id: walletId,
      name: 'Public wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh',
      color: '#27c4a7',
      addresses: [],
    },
  ];
  workspace.transactions[child] = {
    ...tx(child),
    vin: [
      { txid: parent, vout: 0 },
      { txid: parent, vout: 2 },
    ],
  };
  return workspace;
};

describe('visible Wallet input planning', () => {
  it('reuses the loaded snapshot index and skips workspace scans for empty visible inputs', () => {
    const workspace = fixture();
    workspace.transactions[parent] = tx(parent);
    const prevouts = indexPreviousOutputs(workspace);
    const expected = walletFlowInputPlan(workspace, walletId, child, [input(), input(parent, 2)]);
    workspace.transactions = new Proxy(workspace.transactions, {
      ownKeys() {
        throw new Error('Row selection must not enumerate the loaded transaction history.');
      },
    });
    expect(
      walletFlowInputPlan(
        workspace,
        walletId,
        child,
        [input(), input(parent, 2)],
        undefined,
        prevouts,
      ),
    ).toEqual(expected);
    expect(walletFlowInputPlan(workspace, walletId, child, []).refs).toEqual([]);
  });

  it('deduplicates known prevouts without deriving invented targets from missing addresses', () => {
    const workspace = fixture();
    const plan = walletFlowInputPlan(workspace, walletId, child, [
      input(),
      input(),
      input(parent, 2),
      { ...input(), id: `tx:${child}`, coinbase: true },
      { ...input(), id: 'addr:unknown' },
      { ...input(), vout: 1 },
      input(grandparent),
    ]);
    expect(plan.transactionIds).toEqual([parent]);
    expect(plan.refs).toEqual([
      { id: `out:${parent}:0`, txid: parent, vout: 0 },
      { id: `out:${parent}:2`, txid: parent, vout: 2 },
    ]);
    expect(plan.pendingCount).toBe(1);
  });

  it('bounds visible references at 100 and each request wave at 20, excluding in-flight attempts', () => {
    const workspace = fixture();
    const ids = Array.from({ length: 130 }, (_, index) => index.toString(16).padStart(64, '0'));
    workspace.transactions[child].vin = ids.map((txid) => ({ txid, vout: 0 }));
    const plan = walletFlowInputPlan(
      workspace,
      walletId,
      child,
      ids.map((id) => input(id)),
      new Set(ids.slice(0, 4)),
    );
    expect(plan.refs).toHaveLength(100);
    expect(plan.pendingCount).toBe(100);
    expect(plan.transactionIds).toEqual(ids.slice(4, 24));
  });

  it('does not fetch a cached parent again when its requested output is absent', () => {
    const workspace = fixture();
    workspace.transactions[parent] = tx(parent);
    const plan = walletFlowInputPlan(workspace, walletId, child, [input(parent, 2)]);
    expect(plan.transactionIds).toEqual([]);
    expect(plan.pendingCount).toBe(0);
    expect(plan.missingOutputCount).toBe(1);
  });

  it('does not fetch a parent when attached evidence supplies the visible output details', () => {
    const workspace = fixture();
    workspace.transactions[child].vin[0].prevout = {
      value: 1,
      scriptPubKey: { hex: '51' },
    };
    const plan = walletFlowInputPlan(workspace, walletId, child, [
      { ...input(), missing: false, prevoutStatus: 'attached' },
    ]);
    expect(plan.transactionIds).toEqual([]);
    expect(plan.pendingCount).toBe(0);
    expect(plan.missingOutputCount).toBe(0);
    expect(workspace.transactions[parent]).toBeUndefined();
  });

  it('invalidates a removed wallet, removed source or changed input list', () => {
    const workspace = fixture();
    const before = walletFlowSourceKey(workspace, walletId, child);
    workspace.transactions[child].vin = [{ txid: grandparent, vout: 0 }];
    expect(walletFlowSourceKey(workspace, walletId, child)).not.toBe(before);
    expect(walletFlowInputPlan(workspace, walletId, child, [input()]).transactionIds).toEqual([]);
    workspace.wallets = [];
    expect(walletFlowSourceKey(workspace, walletId, child)).toBe('');
    expect(walletFlowInputPlan(workspace, walletId, child, [input()]).refs).toEqual([]);
  });
});

describe('visible Wallet evidence merges', () => {
  it('keeps cache-only merges identical without promotion, provenance changes or replacement', () => {
    const workspace = fixture();
    workspace.transactions[parent] = tx(parent, 3);
    workspace.inputContext = { [parent]: [2] };
    expect(mergeWalletFlowInputs(workspace, walletId, child, [input()], [])).toBe(workspace);
    expect(mergeWalletFlowInputs(workspace, walletId, child, [input()], [tx(parent, 4)])).toBe(
      workspace,
    );
    expect(workspace.transactions[parent].vout).toHaveLength(3);
    expect(workspace.inputContext).toEqual({ [parent]: [2] });
  });

  it('preserves explicit visible prevouts and existing context without exposing giant parent siblings', () => {
    const workspace = fixture();
    workspace.transactions[grandparent] = tx(grandparent);
    workspace.inputContext = { [grandparent]: [0] };
    const funding = { ...tx(parent, 50), vin: [{ txid: 'd'.repeat(64), vout: 0 }] };
    const merged = mergeWalletFlowInputs(
      workspace,
      walletId,
      child,
      [input(parent, 2), input()],
      [funding],
    );
    expect(merged.inputContext).toEqual({ [grandparent]: [0], [parent]: [0, 2] });
    expect(merged.contextTransactionIds).toContain(parent);
    expect(merged.transactions[parent].vout).toHaveLength(50);
    const graphIds = buildGraph(merged).nodes.map((node) => node.id);
    expect(graphIds).toContain(`out:${parent}:2`);
    expect(graphIds).not.toContain(`out:${parent}:1`);
    expect(graphIds).not.toContain(`out:${'d'.repeat(64)}:0`);
    expect(merged.annotations).toBe(workspace.annotations);
    expect(parseWorkspace(merged).inputContext).toEqual(merged.inputContext);
  });

  it('rejects arrivals for a removed source, removed wallet or no longer relevant prevout', () => {
    const workspace = fixture();
    const absentSource = { ...workspace, transactions: {} };
    expect(mergeWalletFlowInputs(absentSource, walletId, child, [input()], [tx(parent)])).toBe(
      absentSource,
    );
    const absentWallet = { ...workspace, wallets: [] };
    expect(mergeWalletFlowInputs(absentWallet, walletId, child, [input()], [tx(parent)])).toBe(
      absentWallet,
    );
    expect(
      mergeWalletFlowInputs(workspace, walletId, child, [input(grandparent)], [tx(grandparent)]),
    ).toBe(workspace);
  });

  it('does not substitute another outpoint or admit wrong-network transaction metadata', () => {
    const workspace = fixture();
    expect(
      mergeWalletFlowInputs(workspace, walletId, child, [input(parent, 2)], [tx(parent)]),
    ).toBe(workspace);
    workspace.network = 'testnet4';
    expect(
      mergeWalletFlowInputs(workspace, walletId, child, [input()], [transactions[TX_FUNDING]]),
    ).toBe(workspace);
  });

  it('admits only matching requested transactions and does not walk their ancestry', () => {
    const workspace = fixture();
    const merged = mergeWalletFlowInputs(
      workspace,
      walletId,
      child,
      [input()],
      [{ ...tx(parent), vin: [{ txid: grandparent, vout: 0 }] }, tx(grandparent)],
    );
    expect(merged.transactions[parent]).toBeDefined();
    expect(merged.transactions[grandparent]).toBeUndefined();
    expect(walletFlowInputPlan(merged, walletId, child, [input()]).transactionIds).toEqual([]);
  });
});

describe('bounded Wallet input request waves', () => {
  it('deduplicates requests, limits each wave and never exceeds four concurrent fetches', async () => {
    const ids = Array.from({ length: 25 }, (_, index) => index.toString(16).padStart(64, '0'));
    let active = 0;
    let maximum = 0;
    const fetch = vi.fn(async (network: string, id: string) => {
      expect(network).toBe('mainnet');
      active++;
      maximum = Math.max(active, maximum);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return tx(id);
    });
    const result = await loadWalletFlowInputWave(
      'mainnet',
      [...ids, ...ids],
      fetch,
      new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledTimes(20);
    expect(maximum).toBe(4);
    expect(result.loaded).toHaveLength(20);
    expect(result.failed).toEqual([]);
  });

  it('rejects late results after cancellation and never starts queued ancestry requests', async () => {
    const controller = new AbortController();
    const releases: (() => void)[] = [];
    const fetch = vi.fn(async (_network: string, id: string) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return tx(id);
    });
    const wave = loadWalletFlowInputWave(
      'mainnet',
      Array.from({ length: 8 }, (_, index) => index.toString(16).padStart(64, '0')),
      fetch,
      controller.signal,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    controller.abort();
    releases.forEach((release) => release());
    await expect(wave).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('categorizes wrong identity, network mismatch and backend failures without exposing raw exceptions', async () => {
    const ids = [parent, grandparent, child];
    const result = await loadWalletFlowInputWave(
      'testnet4',
      ids,
      async (_network, id) => {
        if (id === parent) return transactions[TX_FUNDING];
        if (id === grandparent) return tx(child);
        throw new Error('Synthetic upstream diagnostic must not appear in UI');
      },
      new AbortController().signal,
    );
    expect(result.loaded).toEqual([]);
    expect(result.failed.sort()).toEqual(ids.sort());
  });
});
