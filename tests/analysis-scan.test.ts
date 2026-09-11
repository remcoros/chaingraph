import { describe, expect, it } from 'vitest';
import { analysisTools } from '../src/domain/analysis';
import {
  analysisScanScope,
  analysisScopeChoice,
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
  it('defaults to workspace without a wallet, even with a selected graph entity', () => {
    const workspace = fixture();
    const selected = { id: `tx:${id(1)}`, kind: 'transaction' as const, txid: id(1), label: '' };
    for (const node of [undefined, selected]) {
      const choice = analysisScopeChoice(workspace, undefined, node);
      expect(choice.mode).toBe('workspace');
      expect(choice.scope.txids).toEqual([1, 2, 3, 4].map(id));
    }
  });
  it('defaults absent or invalid choices to Workspace while labeling the available selection', () => {
    const workspace = fixture();
    const selected = { id: `tx:${id(1)}`, kind: 'transaction' as const, txid: id(1), label: '' };
    for (const choice of [undefined, 'invalid-scope', 'wallet:']) {
      const walletScope = analysisScopeChoice(workspace, choice, undefined, wallet());
      expect(walletScope.mode).toBe('workspace');
      expect(walletScope.selectionLabel).toBe('Selection (Wallet)');
      expect(walletScope.scope).toMatchObject({
        kind: 'workspace',
        label: 'Workspace',
        txids: [1, 2, 3, 4].map(id),
      });
      const entityScope = analysisScopeChoice(workspace, choice, selected, wallet());
      expect(entityScope.mode).toBe('workspace');
      expect(entityScope.selectionLabel).toBe('Selection (Transaction)');
      expect(entityScope.scope.txids).toEqual([1, 2, 3, 4].map(id));
    }
  });
  it('keeps explicit Selection graph-first with the current wallet as fallback', () => {
    const workspace = fixture();
    const selected = { id: `tx:${id(1)}`, kind: 'transaction' as const, txid: id(1), label: '' };
    const walletScope = analysisScopeChoice(workspace, 'context', undefined, wallet());
    expect(walletScope.selectionLabel).toBe('Selection (Wallet)');
    expect(walletScope.scope.kind).toBe('wallet');
    const entityScope = analysisScopeChoice(workspace, 'context', selected, wallet());
    expect(entityScope.mode).toBe('context');
    expect(entityScope.selectionLabel).toBe('Selection (Transaction)');
    expect(entityScope.scope.txids).toEqual([id(1)]);
  });
  it('isolates an explicit wallet from the active wallet and graph selection', () => {
    const workspace = fixture();
    const otherAddress = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
    const otherWallet: Wallet = {
      ...wallet(),
      id: 'other-public-fixture',
      name: 'Other public fixture',
      addresses: [
        {
          ...wallet().addresses[0],
          address: otherAddress,
          scripthash: addressToScriptHash(otherAddress, 'mainnet'),
        },
      ],
    };
    const received = tx(5);
    received.vout[0].scriptPubKey.address = otherAddress;
    const spent = tx(6, 5);
    workspace.transactions[id(5)] = received;
    workspace.transactions[id(6)] = spent;
    workspace.wallets = [wallet(), otherWallet];
    for (const selected of [
      undefined,
      { id: `tx:${id(1)}`, kind: 'transaction' as const, txid: id(1), label: '' },
      { id: `out:${id(2)}:0`, kind: 'output' as const, txid: id(2), vout: 0, label: '' },
    ]) {
      const choice = analysisScopeChoice(
        workspace,
        `wallet:${otherWallet.id}`,
        selected,
        workspace.wallets[0],
      );
      expect(choice).toMatchObject({
        mode: `wallet:${otherWallet.id}`,
        walletUnavailable: false,
        scope: { kind: 'wallet', label: `Wallet ${otherWallet.name}`, txids: [id(5), id(6)] },
      });
    }
  });
  it('keeps a removed explicit wallet empty even if a stale wallet and graph selection remain', async () => {
    const workspace = fixture();
    const imported = wallet();
    workspace.wallets = [imported];
    const mode = `wallet:${imported.id}`;
    expect(analysisScopeChoice(workspace, mode).scope.txids).toEqual([1, 2, 3, 4].map(id));
    workspace.wallets = [];
    const choice = analysisScopeChoice(
      workspace,
      mode,
      { id: `tx:${id(1)}`, kind: 'transaction', txid: id(1), label: '' },
      imported,
    );
    expect(choice).toMatchObject({
      mode,
      walletUnavailable: true,
      scope: { kind: 'wallet', label: 'Wallet unavailable', txids: [] },
    });
    const scan = await scanAnalysis(workspace, choice.scope);
    expect(scan.findings).toEqual([]);
    expect(scan.reports.every((report) => report.status === 'skipped')).toBe(true);
  });
  it('keeps explicit and legacy session choices through selection changes and scans', async () => {
    const workspace = fixture();
    for (const mode of ['context', 'workspace']) {
      for (const selected of [
        { id: `tx:${id(1)}`, kind: 'transaction' as const, txid: id(1), label: '' },
        { id: `out:${id(1)}:0`, kind: 'output' as const, txid: id(1), vout: 0, label: '' },
        { id: `addr:${address}`, kind: 'address' as const, address, label: '' },
      ]) {
        const choice = analysisScopeChoice(workspace, mode, selected, wallet());
        expect(choice.mode).toBe(mode);
        expect(choice.selectionLabel).toBe(
          `Selection (${selected.kind[0].toUpperCase() + selected.kind.slice(1)})`,
        );
        expect(choice.scope.kind).toBe(mode === 'context' ? selected.kind : 'workspace');
        const scan = await scanAnalysis(workspace, choice.scope);
        const updated = { ...workspace, findings: mergeScanFindings(workspace.findings, scan) };
        expect(analysisScopeChoice(updated, mode, selected, wallet())).toEqual(choice);
      }
    }
  });
  it('keeps a lost explicit selection empty and distinguishes unavailable evidence', () => {
    const workspace = fixture();
    const missing = analysisScopeChoice(workspace, 'context');
    expect(missing).toMatchObject({
      mode: 'context',
      hasSelection: false,
      selectionLabel: 'Selection (None)',
      scope: {
        label: 'No current selection',
        explanation: 'Select a wallet or graph entity, or choose Workspace.',
        txids: [],
      },
    });
    const unavailable = analysisScopeChoice(workspace, 'context', {
      id: `tx:${id(99)}`,
      kind: 'transaction',
      txid: id(99),
      label: '',
    });
    expect(unavailable.hasSelection).toBe(true);
    expect(unavailable.scope.txids).toEqual([]);
    expect(analysisScopeChoice(workspace, undefined).mode).toBe('workspace');
    expect(analysisScopeChoice(workspace, undefined, undefined, wallet()).mode).toBe('workspace');
  });
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
