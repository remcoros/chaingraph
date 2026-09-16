import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { analysisTools } from '../../../Analysis/analysis';
import type { AnalysisScan } from '../../../Analysis/analysisScan';
import {
  matchesReviewCategories,
  walletReviewCategories,
  walletReviewCategoryScanState,
} from './reviewCategories';
import { REVIEW_REASONS, type WalletReviewItem } from '../../../Wallet/walletReview';
import { createWorkspace } from '../../../createWorkspace';

const id = (n: number) => n.toString(16).padStart(64, '0');
const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(1), 0, 'bc');
const makeItem = (n: number, overrides: Partial<WalletReviewItem> = {}): WalletReviewItem => ({
  key: `wallet|current-utxo|${id(n)}:0`,
  nodeId: `out:${id(n)}:0`,
  nodeIds: [`out:${id(n)}:0`],
  reason: 'current-utxo',
  title: 'Checked output',
  detail: '',
  label: '',
  tags: [],
  evidence: 'unchanged',
  status: 'open',
  changed: false,
  ...overrides,
});

describe('discoverable wallet finding categories', () => {
  it('never counts wallet matches or unknown ownership as unidentified counterparties', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const items = [
      makeItem(1, {
        reason: 'source-address',
        nodeId: `addr:${address}`,
        address,
        ownership: 'wallet',
      }),
      makeItem(2, {
        reason: 'destination-address',
        nodeId: `addr:${address}`,
        address,
        ownership: 'unknown',
      }),
    ];
    expect(
      items.some((item) =>
        matchesReviewCategories(
          item,
          ['unidentified-sources', 'unidentified-destinations'],
          workspace,
        ),
      ),
    ).toBe(false);
  });

  it('includes actionable review types and registry tools, not output-only compatibility types', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const catalog = walletReviewCategories(workspace, []);
    expect(catalog.map((category) => category.id)).toEqual([
      ...REVIEW_REASONS.filter(
        (reason) => reason !== 'counterparty' && reason !== 'funding-source',
      ),
      'unidentified-sources',
      'unidentified-destinations',
      'utxo-missing-label',
      'utxo-missing-tags',
      'utxo-unidentified',
      ...analysisTools.map((tool) => `heuristic:${tool.id}`),
    ]);
    expect(new Set(catalog.map((category) => category.id)).size).toBe(catalog.length);
    expect(
      catalog.every((category) => category.count === 0 && category.label && category.description),
    ).toBe(true);
    for (const tool of analysisTools)
      expect(catalog.find((category) => category.id === `heuristic:${tool.id}`)).toMatchObject({
        algorithm: tool.id,
        kind: tool.kind,
        heuristic: true,
      });
    expect(walletReviewCategoryScanState(workspace)).toMatchObject({
      status: 'not-scanned',
      partial: true,
    });
    expect(
      walletReviewCategoryScanState(workspace).tools.every((tool) => tool.status === 'not-scanned'),
    ).toBe(true);
  });

  it('counts overlapping missing label, tags and neither before an OR selection', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const items = [makeItem(1), makeItem(2), makeItem(3), makeItem(4)];
    workspace.annotations = {
      [items[0].nodeId]: {
        label: ' \n ',
        note: 'A note is not a label',
        icon: 'gift',
        bookmarked: false,
      },
      [items[1].nodeId]: { label: 'Label only', note: '', icon: '', bookmarked: false },
      [items[3].nodeId]: { label: 'Both', note: '', icon: '', bookmarked: false },
    };
    items[2].address = address;
    workspace.tags = [
      {
        id: 'fixture-tag',
        name: 'Known context',
        color: '#27c4a7',
        nodeIds: [`addr:${address}`, items[3].nodeId],
      },
    ];
    const counts = Object.fromEntries(
      walletReviewCategories(workspace, items).map((category) => [category.id, category.count]),
    );
    expect(counts).toMatchObject({
      'current-utxo': 4,
      'utxo-missing-label': 2,
      'utxo-missing-tags': 2,
      'utxo-unidentified': 1,
    });
    const missingAny = items.filter((item) =>
      matchesReviewCategories(item, ['utxo-missing-label', 'utxo-missing-tags'], workspace),
    );
    expect(missingAny.map((item) => item.nodeId)).toEqual(
      items.slice(0, 3).map((item) => item.nodeId),
    );
    expect(
      items.filter((item) =>
        matchesReviewCategories(item, new Set(['utxo-unidentified']), workspace),
      ),
    ).toEqual([items[0]]);
    expect(items.filter((item) => matchesReviewCategories(item, [], workspace))).toEqual([]);
    expect(
      items.filter((item) => matchesReviewCategories(item, ['unsupported'], workspace)),
    ).toEqual([]);
    expect(
      items.every((item) =>
        matchesReviewCategories(
          item,
          walletReviewCategories(workspace, []).map((category) => category.id),
          workspace,
        ),
      ),
    ).toBe(true);
    expect(
      Object.fromEntries(
        walletReviewCategories(workspace, items).map((category) => [category.id, category.count]),
      ),
    ).toEqual(counts);
  });

  it('counts only primary address groups, not earlier receipts, UTXOs, legacy outputs or missing exceptions', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const items = [
      makeItem(1, { reason: 'source', relationshipKinds: ['source'], status: 'unknown' }),
      makeItem(2, { reason: 'funding-source', status: 'reviewed' }),
      makeItem(3, { reason: 'source' }),
      makeItem(4, { relationshipKinds: ['source', 'destination'] }),
      makeItem(5, { reason: 'counterparty', status: 'later' }),
      makeItem(6, {
        reason: 'source-address',
        nodeId: `addr:${address}`,
        address,
        ownership: 'external',
      }),
      makeItem(7, {
        reason: 'destination-address',
        nodeId: `addr:${address}`,
        address,
        ownership: 'external',
      }),
    ];
    const catalog = walletReviewCategories(workspace, items);
    expect(catalog.find((category) => category.id === 'unidentified-sources')?.count).toBe(1);
    expect(catalog.find((category) => category.id === 'unidentified-destinations')?.count).toBe(1);
    expect(matchesReviewCategories(items[2], ['unidentified-sources'], workspace)).toBe(false);
    expect(matchesReviewCategories(items[0], ['unidentified-sources'], workspace)).toBe(false);
    expect(matchesReviewCategories(items[5], ['unidentified-sources'], workspace)).toBe(true);
    expect(matchesReviewCategories(items[6], ['unidentified-destinations'], workspace)).toBe(true);
    expect(items[0].status).toBe('unknown');
    workspace.annotations[items[1].nodeId] = {
      label: 'Recorded',
      note: '',
      icon: '',
      bookmarked: false,
    };
    expect(matchesReviewCategories(items[1], ['unidentified-sources'], workspace)).toBe(false);
    expect(matchesReviewCategories(items[1], ['funding-source'], workspace)).toBe(true);
    expect(matchesReviewCategories(items[5], ['unidentified-sources'], workspace)).toBe(true);
    workspace.annotations[`addr:${address}`] = {
      label: 'Address label',
      note: '',
      icon: '',
      bookmarked: false,
    };
    expect(matchesReviewCategories(items[5], ['unidentified-sources'], workspace)).toBe(false);
    expect(matchesReviewCategories(items[6], ['unidentified-destinations'], workspace)).toBe(false);
    expect(matchesReviewCategories(items[5], ['source-address'], workspace)).toBe(true);
  });

  it('uses address metadata independently from all constituent output labels and tags', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const item = makeItem(1, {
      reason: 'source-address',
      ownership: 'external',
      nodeId: `addr:${address}`,
      address,
      outpointIds: [`out:${id(1)}:0`, `out:${id(2)}:0`],
    });
    workspace.annotations[`out:${id(1)}:0`] = {
      label: 'One output',
      note: '',
      icon: '',
      bookmarked: false,
    };
    workspace.tags = [
      {
        id: 'tag',
        name: 'Output tag',
        color: '#27c4a7',
        nodeIds: [`out:${id(1)}:0`, `out:${id(2)}:0`],
      },
    ];
    expect(matchesReviewCategories(item, ['unidentified-sources'], workspace)).toBe(true);
    workspace.tags[0].nodeIds.push(item.nodeId);
    expect(matchesReviewCategories(item, ['unidentified-sources'], workspace)).toBe(false);
    expect(item.status).toBe('open');
    workspace.tags = [];
    workspace.annotations[item.nodeId] = {
      label: '  ',
      note: 'Note only',
      icon: 'gift',
      bookmarked: false,
    };
    expect(matchesReviewCategories(item, ['unidentified-sources'], workspace)).toBe(true);
  });

  it('uses effective address tags but does not inherit address labels or tags from a transaction', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const item = makeItem(1, { address });
    workspace.annotations[`addr:${address}`] = {
      label: 'Address label',
      note: '',
      icon: '',
      bookmarked: false,
    };
    workspace.tags = [
      { id: 'tx-tag', name: 'Transaction context', color: '#27c4a7', nodeIds: [`tx:${id(1)}`] },
    ];
    expect(matchesReviewCategories(item, ['utxo-unidentified'], workspace)).toBe(true);
    workspace.tags[0].nodeIds = [`addr:${address}`];
    expect(matchesReviewCategories(item, ['utxo-unidentified'], workspace)).toBe(false);
    expect(matchesReviewCategories(item, ['utxo-missing-label'], workspace)).toBe(true);
    expect(matchesReviewCategories(item, ['utxo-missing-tags'], workspace)).toBe(false);
  });

  it('matches exact supported algorithms and does not equate saved findings with a completed scan', () => {
    const workspace = createWorkspace('Categories', 'mainnet');
    const finding = {
      id: 'cioh:fixture',
      algorithm: 'cioh-v2',
      title: 'Possible group',
      description: 'Hypothesis',
      nodeIds: [`out:${id(1)}:0`],
      txids: [id(2)],
      createdAt: '2026-09-09T00:00:00.000Z',
      kind: 'hypothesis' as const,
    };
    workspace.findings = [finding];
    const item = makeItem(1, { key: `wallet|link|${finding.id}`, reason: 'link' });
    const catalog = walletReviewCategories(workspace, [item]);
    expect(catalog.find((category) => category.id === 'heuristic:cioh')?.count).toBe(1);
    expect(catalog.find((category) => category.id === 'link')?.count).toBe(1);
    expect(
      matchesReviewCategories(
        { ...item, algorithm: 'unrelated-cioh-v2' },
        ['heuristic:cioh'],
        workspace,
      ),
    ).toBe(false);
    expect(walletReviewCategoryScanState(workspace)).toMatchObject({
      status: 'saved-findings',
      partial: true,
    });
    const scan: AnalysisScan = {
      scope: { kind: 'workspace', label: 'Loaded workspace', explanation: '', txids: [id(2)] },
      options: {},
      findings: [],
      runAt: '2026-09-09T01:00:00.000Z',
      reports: analysisTools.map((tool) => ({
        toolId: tool.id,
        status: 'complete',
        message: 'Completed',
      })),
    };
    expect(walletReviewCategoryScanState(workspace, scan)).toMatchObject({
      status: 'scanned',
      runAt: scan.runAt,
      partial: false,
    });
    scan.reports[0].status = 'error';
    expect(walletReviewCategoryScanState(workspace, scan).partial).toBe(true);
  });
});
