import { afterEach, expect, it, vi } from 'vitest';
import {
  DEMO_WORKSPACE_TEMPLATES,
  WORKSPACE_TEMPLATES,
  createTemplateWorkspace,
} from './workspaceTemplates';
import { parseWorkspace } from '../../Core/Workspace/Persistence';
import { indexPreviousOutputs } from '../../Core/ChainData';
import {
  listWalletTransactions,
  verifyWalletUtxo,
} from '../../Core/Workspace/Wallets/walletRecords';
import { readWalletUtxoCheck } from '../../Core/Workspace/Wallets/WalletUtxos/walletUtxoCheck';
import { WalletPreparationCache } from '../../Core/Workspace/Wallets/walletPreparation';
import {
  scanAnalysis,
  scanDefaults,
  analysisScanScope,
} from '../../Core/Workspace/Analysis/analysisScan';
import { createConnectionScanFetch } from '../../Core/Workspace/ConnectionScan/connectionScanFetch';
import {
  runConnectionScan,
  DEFAULT_SCAN_SETTINGS,
} from '../../Core/Workspace/ConnectionScan/connectionScan';
import { TransactionFetchScope } from '../../Core/ChainData/transactionScheduler';

afterEach(() => vi.restoreAllMocks());
it('keeps three captured investigations separate from the normal nine-example catalog', () => {
  expect(DEMO_WORKSPACE_TEMPLATES).toHaveLength(3);
  expect(WORKSPACE_TEMPLATES).toHaveLength(9);
  expect(
    DEMO_WORKSPACE_TEMPLATES.every(
      (entry) => !WORKSPACE_TEMPLATES.some((normal) => normal.id === entry.id),
    ),
  ).toBe(true);
});

it.each(DEMO_WORKSPACE_TEMPLATES)(
  'opens $id with portable, usable saved evidence and local analysis',
  async (template) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
    const workspace = await createTemplateWorkspace(template.id);
    expect(workspace.demo).toBe(false);
    expect(parseWorkspace(JSON.parse(JSON.stringify(workspace)))).toEqual(workspace);
    const prevouts = indexPreviousOutputs({
      network: workspace.network,
      transactions: workspace.chainData.transactions,
    });
    for (const tx of Object.values(workspace.chainData.transactions)) {
      expect(tx.status?.observation?.observedAt).toBeDefined();
      for (const input of tx.vin) {
        if (!input.txid) continue;
        expect(['loaded', 'attached']).toContain(
          prevouts.get(`${input.txid}:${input.vout}`)?.status,
        );
      }
    }
    expect(
      Object.values(workspace.annotations.entities).filter((entry) => entry.bookmarked).length,
    ).toBeGreaterThanOrEqual(3);
    expect(workspace.annotations.tags!.length).toBeGreaterThanOrEqual(2);
    const analysis = await scanAnalysis(
      workspace,
      analysisScanScope(workspace),
      scanDefaults(),
      new AbortController().signal,
    );
    expect(analysis.reports.some((report) => report.status === 'error')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('supplies every bounded wallet history row, known net changes, flows and dated coin coverage', async () => {
  const workspace = await createTemplateWorkspace('demo-public-wallet');
  const wallet = workspace.wallets.definitions[0];
  const history = new Set(
    wallet.addresses.flatMap((address) => address.history!.map((entry) => entry.tx_hash)),
  );
  expect(history.size).toBeGreaterThan(200);
  expect(wallet.pendingTransactionIds).toEqual([]);
  expect(wallet.scanComplete).toBe(false);
  for (const id of history) expect(workspace.chainData.transactions[id]).toBeDefined();
  const records = listWalletTransactions(workspace, wallet);
  expect(records.length).toBe(history.size);
  expect(
    records.every(
      (record) =>
        record.transaction && record.netSats !== undefined && record.feeSats !== undefined,
    ),
  ).toBe(true);
  const coins = readWalletUtxoCheck(workspace, wallet)!;
  expect(coins.checkedAddresses).toBe(wallet.addresses.length);
  expect(coins.nextCursor).toBeUndefined();
  expect(Date.parse(coins.checkedAt)).toBeGreaterThan(0);
  for (const coin of coins.records)
    expect(
      verifyWalletUtxo(coin, workspace.chainData.transactions[coin.txid], workspace.network),
    ).toBe(true);
  const prepared = new WalletPreparationCache().prepare(workspace, wallet, coins);
  expect(prepared.invalidCount).toBe(0);
  expect(prepared.transactionRecords.slice(0, 40).every((record) => !!record.transaction)).toBe(
    true,
  );
  expect(
    prepared.relationships.sources.length + prepared.relationships.destinations.length,
  ).toBeGreaterThan(0);
  expect(workspace.view.workbench).toBe('wallet');
});

it('retains exact paths beyond the initial canvas for reveal and loaded-only connection scans', async () => {
  const workspace = await createTemplateWorkspace('demo-branching-path');
  const txs = Object.values(workspace.chainData.transactions);
  const links = txs.flatMap((child) =>
    child.vin.filter((input) => input.txid && workspace.chainData.transactions[input.txid]),
  );
  expect(txs).toHaveLength(7);
  expect(links.length).toBeGreaterThanOrEqual(6);
  expect(txs.some((tx) => !workspace.view.graphNodeIds!.includes(`tx:${tx.txid}`))).toBe(true);
  const scope = new TransactionFetchScope(workspace.network);
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No backend'));
  try {
    const resolver = createConnectionScanFetch({
      network: workspace.network,
      transactions: workspace.chainData.transactions,
      scope,
      signal: scope.signal,
      allowNetwork: false,
    });
    const run = await runConnectionScan({
      id: 'captured-path',
      source: workspace.view.selectionId!,
      targetIds: ['tx:a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d'],
      displayedNodeIds: workspace.view.graphNodeIds!,
      settings: { ...DEFAULT_SCAN_SETTINGS, targetScope: 'custom' },
      resolveNeighbors: resolver.resolveNeighbors,
    });
    expect(run.results.some((result) => result.relationship === 'direct')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    scope.close();
  }
});
