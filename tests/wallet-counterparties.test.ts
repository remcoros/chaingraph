import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, it, vi } from 'vitest';
import type { Transaction, Wallet, Workspace } from '../src/domain/types';
import { groupWalletRelationships, walletCounterparties } from '../src/domain/walletRelationships';
import { newWorkspace } from '../src/domain/workspace';
import { addressToScriptHash } from '../src/lib/wallet';
import {
  createWalletCounterpartyLoader,
  mergeWalletCounterpartyInputs,
  walletCounterpartyInputPlan,
  type WalletCounterpartyOptions,
} from '../src/lib/walletCounterparties';

const id = (n: number) => n.toString(16).padStart(64, '0');
const mine = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const other = bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'bc');
const output = (n = 0, address = other) => ({
  n,
  value: 1,
  scriptPubKey: { hex: bytesToHex(bitcoinAddress.toOutputScript(address)) },
});
const transaction = (txid: string, count = 1): Transaction => ({
  txid,
  vin: [{ coinbase: '00' }],
  vout: Array.from({ length: count }, (_, n) => output(n)),
});
const wallet: Wallet = {
  id: 'wallet',
  name: 'Public fixture',
  key: '',
  scriptType: 'p2wpkh',
  color: '#27c4a7',
  addresses: [
    {
      address: mine,
      scripthash: addressToScriptHash(mine, 'mainnet'),
      path: '',
      index: 0,
      branch: 0,
    },
  ],
};
const fixture = (count = 1): Workspace => ({
  ...newWorkspace('Counterparty inputs', 'mainnet'),
  wallets: [wallet],
  transactions: {
    [id(1)]: {
      txid: id(1),
      vin: Array.from({ length: count }, (_, n) => ({ txid: id(100 + n), vout: 0 })),
      vout: [output(0, mine)],
    },
  },
});

function harness(workspace: Workspace, fetch: WalletCounterpartyOptions['fetch'], active = true) {
  const loader = createWalletCounterpartyLoader();
  let options: WalletCounterpartyOptions;
  const configure = (patch: Partial<WalletCounterpartyOptions> = {}) => {
    options = { ...options, ...patch };
    if (!patch.groups) options.groups = groupWalletRelationships(options.workspace, options.wallet);
    loader.configure(options);
  };
  const update = vi.fn(
    (workspaceId: string, change: (current: Workspace) => Workspace, undo?: boolean) => {
      expect(workspaceId).toBe(options.workspace.id);
      expect(undo).toBe(false);
      configure({ workspace: change(options.workspace) });
    },
  );
  options = {
    workspace,
    wallet,
    groups: groupWalletRelationships(workspace, wallet),
    active,
    enabled: true,
    fetch,
    update,
  };
  configure();
  return {
    loader,
    configure,
    update,
    get workspace() {
      return options.workspace;
    },
  };
}
const settled = (loader: ReturnType<typeof createWalletCounterpartyLoader>) =>
  vi.waitFor(() => expect(loader.getSnapshot().loading).toBe(false));

describe('counterparty projection', () => {
  it('excludes the selected wallet but not another imported wallet matching the other address', () => {
    const workspace = fixture();
    workspace.transactions[id(100)] = transaction(id(100));
    workspace.transactions[id(2)] = {
      txid: id(2),
      vin: [{ txid: id(1), vout: 0 }],
      vout: [output(0, mine), output(1, other)],
    };
    workspace.wallets.push({
      ...wallet,
      id: 'other-wallet',
      addresses: [
        {
          ...wallet.addresses[0],
          address: other,
          scripthash: addressToScriptHash(other, 'mainnet'),
        },
      ],
    });
    const raw = groupWalletRelationships(workspace, wallet);
    expect(raw.sources.some((group) => group.ownership === 'wallet')).toBe(true);
    expect(raw.destinations.some((group) => group.ownership === 'wallet')).toBe(true);
    const result = walletCounterparties(raw);
    expect(result.sources.map((group) => group.address)).toEqual([other]);
    expect(result.destinations.map((group) => group.address)).toEqual([other]);
  });
});

describe('bounded counterparty input resolution', () => {
  it('loads at most 20 distinct parents per activation, six concurrently, without cascading into new wallet ancestry', async () => {
    let active = 0;
    let maximum = 0;
    const fetch = vi.fn(async (network: string, txid: string) => {
      expect(network).toBe('mainnet');
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { txid, vin: [{ txid: id(900), vout: 0 }], vout: [output(0, mine)] };
    });
    const run = harness(fixture(25), fetch);
    await settled(run.loader);
    expect(fetch).toHaveBeenCalledTimes(20);
    expect(maximum).toBe(6);
    expect(run.workspace.transactions[id(900)]).toBeUndefined();
    expect(run.loader.getSnapshot()).toMatchObject({ missingCount: 6, failedCount: 0 });
    run.configure();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(20);
    run.loader.loadMore();
    await settled(run.loader);
    expect(fetch).toHaveBeenCalledTimes(26);
    run.loader.stop();
  });

  it('merges all grouped output references from a shared new parent, but cache-only work is a no-op', async () => {
    const workspace = fixture();
    const parent = id(175);
    workspace.transactions[id(1)].vin = [{ txid: parent.toUpperCase(), vout: 0 }];
    workspace.transactions[id(2)] = {
      txid: id(2),
      vin: [{ txid: parent, vout: 2 }],
      vout: [output(0, mine)],
    };
    const fetch = vi.fn(async (_network, txid: string) => transaction(txid, 5));
    const run = harness(workspace, fetch);
    await settled(run.loader);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(run.workspace.inputContext?.[parent]).toEqual([0, 2]);
    expect(run.workspace.contextTransactionIds).toContain(parent);
    expect(run.workspace.transactions[parent].vout).toHaveLength(5);
    expect(run.update).toHaveBeenCalledTimes(1);
    run.configure({ active: false });
    run.configure({ active: true });
    run.loader.loadMore();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(run.update).toHaveBeenCalledTimes(1);
    const plan = walletCounterpartyInputPlan(
      run.workspace,
      wallet,
      groupWalletRelationships(run.workspace, wallet),
    );
    expect(mergeWalletCounterpartyInputs(run.workspace, plan, [transaction(parent, 8)])).toBe(
      run.workspace,
    );
    run.loader.stop();
  });

  it('skips cached parents with absent outpoints and distinguishes decoded non-address evidence', () => {
    const workspace = fixture(2);
    workspace.transactions[id(1)].vin[0].vout = 2;
    workspace.transactions[id(100)] = transaction(id(100));
    workspace.transactions[id(101)] = {
      ...transaction(id(101)),
      vout: [{ n: 0, value: 0, scriptPubKey: { hex: '6a00' } }],
    };
    const fetch = vi.fn(async (_network, txid: string) => transaction(txid));
    const run = harness(workspace, fetch);
    expect(run.loader.getSnapshot()).toMatchObject({
      missingCount: 0,
      unavailableCount: 1,
      nonAddressCount: 1,
    });
    run.loader.loadMore();
    run.loader.retry();
    expect(fetch).not.toHaveBeenCalled();
    expect(run.update).not.toHaveBeenCalled();
    run.loader.stop();
  });

  it('does not load parents when attached evidence already resolves counterparty inputs', async () => {
    const workspace = fixture();
    workspace.transactions[id(1)].vin[0].prevout = {
      value: 1,
      scriptPubKey: output().scriptPubKey,
    };
    const fetch = vi.fn(async (_network, txid: string) => transaction(txid));
    const run = harness(workspace, fetch);
    await Promise.resolve();
    expect(run.loader.getSnapshot()).toMatchObject({
      missingCount: 0,
      unavailableCount: 0,
      nonAddressCount: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(run.workspace.transactions[id(100)]).toBeUndefined();
    run.loader.stop();
  });

  it('skips parents cached by another loader while requests are queued, without cache-only context edits', async () => {
    const releases: (() => void)[] = [];
    const fetch = vi.fn(async (_network, txid: string) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return transaction(txid);
    });
    const run = harness(fixture(8), fetch);
    expect(fetch).toHaveBeenCalledTimes(6);
    run.configure({
      workspace: {
        ...run.workspace,
        transactions: {
          ...run.workspace.transactions,
          [id(106)]: transaction(id(106)),
          [id(107)]: transaction(id(107)),
        },
      },
    });
    releases.forEach((release) => release());
    await settled(run.loader);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(run.loader.getSnapshot().missingCount).toBe(0);
    expect(run.workspace.inputContext?.[id(106)]).toBeUndefined();
    expect(run.workspace.contextTransactionIds).not.toContain(id(106));
    expect(run.update).toHaveBeenCalledTimes(1);
    run.loader.stop();
  });

  it.each(['activation', 'enabled', 'wallet', 'workspace', 'network', 'source'] as const)(
    'cancels obsolete %s work and rejects late responses without starting queued requests',
    async (change) => {
      const releases: (() => void)[] = [];
      const signals: AbortSignal[] = [];
      const fetch = vi.fn(async (_network, txid: string, signal: AbortSignal) => {
        signals.push(signal);
        await new Promise<void>((resolve) => releases.push(resolve));
        return transaction(txid);
      });
      const run = harness(fixture(8), fetch);
      expect(fetch).toHaveBeenCalledTimes(6);
      if (change === 'activation') run.configure({ active: false });
      else if (change === 'enabled') run.configure({ enabled: false });
      else if (change === 'wallet') run.configure({ wallet: { ...wallet, id: 'removed' } });
      else if (change === 'workspace')
        run.configure({ workspace: { ...run.workspace, id: 'replacement' }, enabled: false });
      else if (change === 'network')
        run.configure({ workspace: { ...run.workspace, network: 'testnet4' } });
      else run.configure({ workspace: { ...run.workspace, transactions: {} } });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      releases.forEach((release) => release());
      await settled(run.loader);
      expect(run.update).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(6);
      run.loader.stop();
    },
  );

  it('revalidates a deferred workspace updater so removed history cannot be restored', async () => {
    const workspace = fixture();
    const loader = createWalletCounterpartyLoader();
    let apply: ((current: Workspace) => Workspace) | undefined;
    loader.configure({
      workspace,
      wallet,
      groups: groupWalletRelationships(workspace, wallet),
      active: true,
      enabled: true,
      fetch: async (_network, txid) => transaction(txid),
      update: (_id, change) => {
        apply = change;
      },
    });
    await settled(loader);
    expect(apply).toBeDefined();
    const removed = { ...workspace, transactions: {} };
    expect(apply!(removed)).toBe(removed);
    const changed = {
      ...workspace,
      transactions: {
        [id(1)]: { ...workspace.transactions[id(1)], vin: [{ txid: id(800), vout: 0 }] },
      },
    };
    expect(apply!(changed)).toBe(changed);
    const foreign = { ...workspace, network: 'testnet4' as const };
    expect(apply!(foreign)).toBe(foreign);
    const noWalletReceipt = {
      ...workspace,
      transactions: {
        ...workspace.transactions,
        [id(1)]: { ...workspace.transactions[id(1)], vout: [output(0, other)] },
      },
    };
    expect(apply!(noWalletReceipt)).toBe(noWalletReceipt);
    loader.stop();
  });

  it('does not automatically restart after source references change within the same activation', async () => {
    let release: (() => void) | undefined;
    const fetch = vi.fn(async (_network, txid: string) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return transaction(txid);
    });
    const run = harness(fixture(), fetch);
    const changed = fixture();
    changed.transactions[id(1)].vin = [{ txid: id(800), vout: 0 }];
    run.configure({ workspace: { ...changed, id: run.workspace.id } });
    release!();
    await settled(run.loader);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(run.loader.getSnapshot().missingCount).toBe(1);
    run.loader.loadMore();
    expect(fetch).toHaveBeenCalledTimes(2);
    release!();
    await settled(run.loader);
    expect(run.workspace.transactions[id(800)]).toBeDefined();
    run.loader.stop();
  });

  it('reports sanitized failures, rejects foreign-network results, and retries only failed parents explicitly', async () => {
    let fail = true;
    const fetch = vi.fn(async (_network, txid: string) => {
      if (fail && txid === id(100)) throw new Error('Synthetic upstream diagnostic');
      if (fail)
        return {
          ...transaction(txid),
          vout: [
            {
              n: 0,
              value: 1,
              scriptPubKey: {
                address: bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'tb'),
              },
            },
          ],
        };
      return transaction(txid);
    });
    const run = harness(fixture(2), fetch);
    await settled(run.loader);
    expect(run.loader.getSnapshot()).toMatchObject({ failedCount: 2, missingCount: 2 });
    expect(run.update).not.toHaveBeenCalled();
    run.configure();
    run.loader.loadMore();
    expect(fetch).toHaveBeenCalledTimes(2);
    fail = false;
    run.loader.retry();
    await settled(run.loader);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(run.loader.getSnapshot()).toMatchObject({ failedCount: 0, missingCount: 0 });
    expect(JSON.stringify(run.loader.getSnapshot())).not.toContain('Synthetic');
    run.loader.stop();
  });

  it('checks the latest activation before accepting a response even before the hook effect runs', async () => {
    const workspace = fixture();
    let release: (() => void) | undefined;
    const update = vi.fn();
    let options: WalletCounterpartyOptions = {
      workspace,
      wallet,
      groups: groupWalletRelationships(workspace, wallet),
      active: true,
      enabled: true,
      fetch: async (_network, txid) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return transaction(txid);
      },
      update,
    };
    const loader = createWalletCounterpartyLoader(() => options);
    loader.configure(options);
    options = { ...options, active: false };
    release!();
    await settled(loader);
    expect(update).not.toHaveBeenCalled();
    loader.stop();
  });
});
