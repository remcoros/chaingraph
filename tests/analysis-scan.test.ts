import { describe, expect, it } from 'vitest';
import { analysisTools } from '../src/domain/analysis';
import {
  analysisScanScope,
  mergeScanFindings,
  scanAnalysis,
  scanDefaults,
} from '../src/domain/analysisScan';
import { newWorkspace } from '../src/domain/workspace';
import { addressToScriptHash } from '../src/lib/wallet';
import { type Transaction, type Wallet } from '../src/domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
function tx(n: number, parent?: number, vout = 0): Transaction {
  return {
    txid: id(n),
    vin: parent ? [{ txid: id(parent), vout }] : [{ coinbase: '00' }],
    vout: [{ n: 0, value: 0.1, scriptPubKey: { address, type: 'witness_v0_keyhash' } }],
    vsize: 120,
  };
}
function fixture() {
  const workspace = newWorkspace('Public analysis fixture', 'mainnet');
  workspace.transactions = Object.fromEntries(
    [tx(1), tx(2, 1), tx(3, 1, 1), tx(4, 2)].map((item) => [item.txid, item]),
  );
  return workspace;
}
function wallet(): Wallet {
  return {
    id: 'public-fixture',
    name: 'Public fixture',
    key: 'public-fixture',
    color: '#aaaaaa',
    scriptType: 'p2wpkh',
    addresses: [
      {
        address,
        scripthash: addressToScriptHash(address, 'mainnet'),
        path: '0/0',
        index: 0,
        branch: 0,
      },
    ],
  };
}

describe('contextual scan scope', () => {
  it('scans all loaded records regardless of visibility or include filters', () => {
    const workspace = fixture();
    workspace.view.hiddenNodeIds = [`tx:${id(2)}`];
    workspace.view.filters = { includeIds: [`tx:${id(1)}`] } as typeof workspace.view.filters;
    expect(analysisScanScope(workspace).txids).toEqual([1, 2, 3, 4].map(id));
  });
  it('limits an output to creating and exact loaded spending transactions, one branch only', () => {
    expect(
      analysisScanScope(fixture(), {
        id: `out:${id(1)}:0`,
        kind: 'output',
        label: '',
        txid: id(1),
        vout: 0,
      }).txids,
    ).toEqual([id(1), id(2)]);
  });
  it('keeps an unavailable selection empty instead of falling back to whole workspace', () => {
    const scope = analysisScanScope(
      fixture(),
      { id: `tx:${id(99)}`, txid: id(99), kind: 'transaction', label: '' },
      wallet(),
    );
    expect(scope.kind).toBe('transaction');
    expect(scope.txids).toEqual([]);
  });
  it('uses verified wallet history and ignores unloaded transactions', () => {
    const workspace = fixture();
    const imported = wallet();
    imported.addresses[0].history = [{ tx_hash: id(99), height: 1 }];
    expect(analysisScanScope(workspace, undefined, imported).txids).toEqual([1, 2, 3, 4].map(id));
    workspace.network = 'testnet4';
    expect(analysisScanScope(workspace, undefined, imported).txids).toEqual([]);
  });
  it('matches address transactions only on the workspace network', () => {
    const workspace = fixture();
    const selected = { id: `addr:${address}`, address, kind: 'address' as const, label: '' };
    expect(analysisScanScope(workspace, selected).txids).toEqual([1, 2, 3, 4].map(id));
    workspace.network = 'testnet4';
    expect(analysisScanScope(workspace, selected).txids).toEqual([]);
  });
});

describe('scan-all registry orchestration', () => {
  it('runs every registry entry with report coverage and explicit wallet unavailability', async () => {
    const workspace = fixture();
    const scan = await scanAnalysis(workspace, analysisScanScope(workspace));
    expect(scan.reports.map((item) => item.toolId)).toEqual(analysisTools.map((tool) => tool.id));
    expect(scan.reports.filter((item) => item.status === 'complete')).toHaveLength(6);
    expect(scan.reports.find((item) => item.toolId === 'wallet-intersections')).toMatchObject({
      status: 'skipped',
      message: expect.stringContaining('at least two wallets'),
    });
    expect(scan.findings.length).toBeGreaterThan(0);
    expect(workspace.findings).toEqual([]);
  });
  it('explains every unavailable tool in an empty scope', async () => {
    const workspace = newWorkspace('Empty fixture', 'testnet4');
    const scan = await scanAnalysis(workspace, analysisScanScope(workspace));
    expect(scan.findings).toEqual([]);
    expect(scan.reports).toHaveLength(analysisTools.length);
    expect(
      scan.reports.every(
        (item) => item.status === 'skipped' && item.message.includes('No loaded transactions'),
      ),
    ).toBe(true);
  });
  it('reports invalid settings while continuing the other analyses', async () => {
    const workspace = fixture();
    const options = scanDefaults();
    options['equal-outputs'].minEqualOutputs = NaN;
    const scan = await scanAnalysis(workspace, analysisScanScope(workspace), options);
    expect(scan.reports[0].status).toBe('error');
    expect(scan.reports).toHaveLength(analysisTools.length);
    expect(scan.findings.length).toBeGreaterThan(0);
  });
  it('cancels before starting or while yielding without returning partial findings', async () => {
    const workspace = fixture();
    const before = new AbortController();
    before.abort();
    await expect(
      scanAnalysis(workspace, analysisScanScope(workspace), undefined, before.signal),
    ).rejects.toThrow();
    const pending = new AbortController();
    const promise = scanAnalysis(
      workspace,
      analysisScanScope(workspace),
      undefined,
      pending.signal,
    );
    pending.abort();
    await expect(promise).rejects.toThrow();
    expect(workspace.findings).toEqual([]);
  });
  it('retains exclusions for identical evidence and unrelated scope findings', async () => {
    const workspace = fixture();
    const scan = await scanAnalysis(
      workspace,
      analysisScanScope(workspace, {
        id: `tx:${id(2)}`,
        txid: id(2),
        label: '',
        kind: 'transaction',
      }),
    );
    const existing = { ...scan.findings[0], excluded: true };
    const unrelated = { ...existing, id: 'unrelated', txids: [id(99)], scopeTxids: [id(99)] };
    const merged = mergeScanFindings([existing, unrelated], scan);
    expect(merged.find((finding) => finding.id === existing.id)?.excluded).toBe(true);
    expect(merged).toContainEqual(unrelated);
    const changed = { ...existing, nodeIds: ['different-evidence'] };
    expect(
      mergeScanFindings([changed], scan).find((finding) => finding.id === existing.id)?.excluded,
    ).toBeUndefined();
    for (const changed of [
      { ...existing, kind: 'incomplete' as const },
      { ...existing, reviewRule: 'fee-threshold' as const },
      { ...existing, description: 'Earlier, incomplete evidence' },
    ])
      expect(
        mergeScanFindings([changed], scan).find((finding) => finding.id === existing.id)?.excluded,
      ).toBeUndefined();
  });
});
