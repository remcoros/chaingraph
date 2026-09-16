import { formatBitcoinAmount } from '../../Controls/Display/amountFormat';
import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { analysisTools } from './analysis';
import { outputNodeId } from '../../../Domain/Metadata/entityReferences';
import type { Transaction, TxOutput } from '../../../Domain/Chain/transaction';
import type { Wallet } from '../../../Domain/Wallet/walletTypes';
import { newWorkspace, parseWorkspace } from '../../../Domain/Workspace/workspace';
import { outputScriptHex } from '../../../Domain/Chain/prevouts';
const id = (n: number) => n.toString(16).padStart(64, '0');
const addrA = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const addrB = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
const tool = (name: string) => analysisTools.find((candidate) => candidate.id === name)!;
const output = (
  n: number,
  value = 0.01,
  address = addrA,
  type = 'witness_v0_keyhash',
): TxOutput => ({ n, value, scriptPubKey: { address, type } });
const transaction = (
  n: number,
  parents: number[] = [1],
  outputs: TxOutput[] = [output(0)],
): Transaction => ({
  txid: id(n),
  vin: parents.map((parent) => ({ txid: id(parent), vout: 0 })),
  vout: outputs,
  vsize: 100,
});
function workspace(...transactions: Transaction[]) {
  const w = newWorkspace('Analysis fixture', 'mainnet');
  w.transactions = Object.fromEntries(transactions.map((tx) => [tx.txid, tx]));
  return w;
}
const stat = (report: ReturnType<(typeof analysisTools)[number]['analyze']>, label: string) =>
  report.stats.find((entry) => entry.label === label)?.value;
function wallet(n: number, address: string, scripthash = id(n)): Wallet {
  return {
    id: `wallet-${n}`,
    name: `Wallet ${n}`,
    key: 'public fixture',
    scriptType: 'p2wpkh',
    color: '#ffaa00',
    addresses: [{ address, scripthash, path: '0/0', index: 0, branch: 0 }],
  };
}

describe('scoped analysis and honest evidence', () => {
  it('highlights each exact amount group without unrelated outputs, data outputs or zeros', () => {
    const tx = transaction(
      10,
      [1, 2],
      [
        output(0),
        output(1),
        output(2),
        output(3, 0.02),
        output(4, 0.02),
        output(5, 0.02),
        output(6, 0.03),
        output(7, 0),
        { n: 8, value: 0.01, scriptPubKey: { hex: '6a01ff', type: 'nulldata' } },
      ],
    );
    const results = tool('equal-outputs').run(workspace(tx));
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.nodeIds)).toEqual([
      [0, 1, 2].map((n) => outputNodeId(tx.txid, n)),
      [3, 4, 5].map((n) => outputNodeId(tx.txid, n)),
    ]);
    expect(results.every((result) => result.kind === 'observation')).toBe(true);
    expect(results[0].details).toContain('does not identify a CoinJoin');
    expect(
      tool('equal-outputs').run(workspace(tx), undefined, { minEqualOutputs: 4 }),
    ).toHaveLength(0);
  });
  it('makes CIOH exclusion coverage explicit and allows a deliberate override', () => {
    const tx = transaction(10, [1, 2], [output(0), output(1), output(2)]);
    const report = tool('cioh').analyze(workspace(tx));
    expect(report.findings).toEqual([]);
    expect(stat(report, 'Equal-output candidates skipped')).toBe(1);
    expect(report.emptyReason).toContain('excluding 1');
    const enabled = tool('cioh').analyze(workspace(tx), undefined, { skipEqualOutputs: false });
    expect(enabled.findings).toHaveLength(1);
    expect(enabled.findings[0].kind).toBe('hypothesis');
    expect(enabled.findings[0].details).toContain('PayJoin');
    expect(stat(enabled, 'Missing previous-output details')).toBe(2);
  });
  it('joins known identical locking scripts across decoded and raw input representations', () => {
    const a = transaction(1, [], [output(0, 0.02, addrA)]);
    a.vout[0].scriptPubKey.hex = '00141111';
    const b = transaction(2, [], [output(0, 0.02, addrB)]);
    b.vout[0].scriptPubKey.hex = '00142222';
    const c = transaction(3, [], [{ n: 0, value: 0.03, scriptPubKey: { hex: '00141111' } }]);
    const d = transaction(4, [], [{ n: 0, value: 0.03, scriptPubKey: { hex: '00143333' } }]);
    const first = transaction(10, [1, 2]),
      second = transaction(11, [3, 4]);
    const report = tool('cioh').analyze(workspace(a, b, c, d, first, second), [id(10), id(11)]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].nodeIds).toHaveLength(4);
    expect(report.findings[0].txids).toEqual([id(10), id(11)]);
    expect(tool('cioh').run(workspace(a, c, transaction(12, [1, 3])))).toHaveLength(0);
  });
  it('restricts reuse counts to the requested transactions and distinguishes repeats within one transaction', () => {
    const a = transaction(10, [1], [output(0), output(1)]),
      b = transaction(11, [2]);
    const w = workspace(a, b);
    expect(tool('address-reuse').run(w)[0].nodeIds).toHaveLength(3);
    expect(tool('address-reuse').run(w, [a.txid])[0].nodeIds).toHaveLength(2);
    expect(tool('address-reuse').run(w, [a.txid], { acrossTransactionsOnly: true })).toEqual([]);
    expect(tool('address-reuse').run(w, [b.txid])).toEqual([]);
    expect(tool('address-reuse').analyze(w, []).emptyReason).toContain('No loaded transactions');
  });
  it('reports missing evidence only for the co-spent group it belongs to', () => {
    const complete = transaction(10, [1, 2]);
    complete.vin[0].prevout = { value: 1, scriptPubKey: { hex: '51' } };
    complete.vin[1].prevout = { value: 1, scriptPubKey: { hex: '52' } };
    const incomplete = transaction(11, [3, 4]);
    const report = tool('cioh').analyze(workspace(complete, incomplete));
    expect(report.findings).toHaveLength(2);
    expect(report.findings.find((f) => f.txids.includes(complete.txid))?.details).not.toContain(
      'lack usable',
    );
    expect(report.findings.find((f) => f.txids.includes(incomplete.txid))?.details).toContain(
      '2 outputs in this group lack usable previous-output details',
    );
    expect(stat(report, 'Missing previous-output details')).toBe(2);
  });
  it('joins address-only and raw-script inputs without learning script mappings from other records', () => {
    const first = transaction(10, [1, 2]);
    const second = transaction(11, [3, 4]);
    first.vin[0].prevout = output(0, 1, addrA);
    first.vin[1].prevout = { value: 1, scriptPubKey: { hex: '51' } };
    second.vin[0].prevout = {
      value: 1,
      scriptPubKey: { hex: outputScriptHex(output(0, 1, addrA), 'mainnet') },
    };
    second.vin[1].prevout = { value: 1, scriptPubKey: { hex: '52' } };
    expect(tool('cioh').run(workspace(first, second))).toHaveLength(1);
    // A conflicting address label on another script cannot establish a connection.
    second.vin[0].prevout.scriptPubKey = { hex: '53', address: addrA };
    expect(tool('cioh').run(workspace(first, second))).toHaveLength(2);
  });
  it('keeps a partial script comparison visible and retains its ID when evidence resolves', () => {
    const spend = transaction(10, [1]);
    const w = workspace(spend);
    const partial = tool('script-types').run(w)[0];
    expect(partial).toMatchObject({ kind: 'incomplete', title: 'Script comparison incomplete' });
    expect(partial.nodeIds).toContain(outputNodeId(id(1), 0));
    spend.vin[0].prevout = output(0, 1, addrA, 'pubkeyhash');
    const resolved = tool('script-types').run(w)[0];
    expect(resolved).toMatchObject({ id: partial.id, kind: 'observation' });
    expect(resolved.details).not.toContain('unavailable');
    spend.vin[0].prevout = output(0, 1);
    expect(tool('script-types').run(w)).toEqual([]);
  });
  it('includes unknown outputs and malformed input references in incomplete script evidence', () => {
    const spend = transaction(10, [1], [{ n: 0, value: 1, scriptPubKey: {} }]);
    spend.vin = [{}];
    const report = tool('script-types').analyze(workspace(spend));
    expect(report.findings[0].kind).toBe('incomplete');
    expect(report.findings[0].nodeIds).toContain(outputNodeId(spend.txid, 0));
    expect(stat(report, 'Unavailable input types')).toBe(1);
    expect(stat(report, 'Unavailable output types')).toBe(1);
  });
  it('reconciles exact satoshi totals using parents outside the scope', () => {
    const a = transaction(1, [], [output(0, 0.10000001)]),
      b = transaction(2, [], [output(0, 0.2)]);
    const spend = transaction(10, [1, 2], [output(0, 0.3)]);
    const report = tool('value-flow').analyze(workspace(a, b, spend), [spend.txid]);
    expect(report.findings).toHaveLength(1);
    expect(report.emptyReason).toBeUndefined();
    expect(report.findings[0].title).toBe(`Network fee: ${formatBitcoinAmount(1)}`);
    expect(report.findings[0].details).toContain('0.01 sat/vB');
    expect(report.findings[0].scopeTxids).toEqual([spend.txid]);
    expect(report.findings[0].txids).toEqual([spend.txid, a.txid, b.txid]);
  });
  it('reconciles fees from attached prevouts without loading parent transactions', () => {
    const spend = transaction(10, [1, 2], [output(0, 0.3)]);
    spend.vin = [
      {
        txid: id(1),
        vout: 0,
        prevout: { value: 0.10000001, scriptPubKey: { hex: '51', type: 'pubkeyhash' } },
      },
      {
        txid: id(2),
        vout: 0,
        prevout: { value: 0.2, scriptPubKey: { hex: '52', type: 'witness_v0_keyhash' } },
      },
    ];
    const report = tool('value-flow').analyze(workspace(spend), [spend.txid]);
    expect(report.findings[0]).toMatchObject({
      title: `Network fee: ${formatBitcoinAmount(1)}`,
      kind: 'observation',
    });
    expect(report.findings[0].details).toContain('Known inputs total');
  });
  it('never calculates a fee from partial input history, even when known inputs exceed outputs', () => {
    const parent = transaction(1, [], [output(0, 1)]),
      spend = transaction(10, [1, 2]);
    const report = tool('value-flow').analyze(workspace(parent, spend), [spend.txid]);
    expect(report.findings[0].kind).toBe('incomplete');
    expect(report.findings[0].title).toContain('Fee unknown');
    expect(report.findings[0].nodeIds).toEqual([outputNodeId(id(2), 0)]);
    expect(report.findings[0].details).toContain('1/2 input values available');
    expect(stat(report, 'Reconciled transactions')).toBe(0);
  });
  it('flags inconsistent totals, skips coinbase, and does not substitute byte size for vsize', () => {
    const parent = transaction(1, [], [output(0, 0.01)]),
      invalid = transaction(10, [1], [output(0, 0.02)]);
    expect(tool('value-flow').run(workspace(parent, invalid), [invalid.txid])[0]).toMatchObject({
      kind: 'incomplete',
      title: 'Inconsistent values: outputs exceed inputs',
    });
    const coinbase = { ...transaction(11), vin: [{ coinbase: '0101' }] };
    expect(tool('value-flow').run(workspace(coinbase))).toEqual([]);
    const spend = transaction(12, [1], [output(0, 0.009)]);
    delete spend.vsize;
    spend.size = 100;
    const result = tool('value-flow').run(workspace(parent, spend), [spend.txid], {
      feeMode: 'attention',
    })[0];
    expect(result.title).toBe(`Network fee: ${formatBitcoinAmount(100_000)}`);
    expect(result.details).toContain('Fee rate is unknown');
  });
  it('filters fee reviews by a configurable threshold with inclusive equality', () => {
    const parent = transaction(1, [], [output(0, 0.01)]),
      spend = transaction(10, [1], [output(0, 0.00999)]);
    const w = workspace(parent, spend);
    expect(
      tool('value-flow').run(w, [spend.txid], { feeMode: 'attention', highFeeRate: 10 })[0].title,
    ).toContain('threshold reached');
    expect(
      tool('value-flow').run(w, [spend.txid], { feeMode: 'attention', highFeeRate: 10.1 }),
    ).toEqual([]);
  });
  it('finds structural shapes under explicit thresholds, ignoring data outputs and coinbase', () => {
    const fanout = transaction(
      10,
      [1],
      Array.from({ length: 5 }, (_, n) => output(n)),
    );
    const consolidation = transaction(11, [1, 2, 3, 4, 5], [output(0)]);
    const fakeFanout = transaction(
      12,
      [1],
      [
        output(0),
        ...Array.from({ length: 5 }, (_, n) => ({
          n: n + 1,
          value: 0,
          scriptPubKey: { type: 'nulldata' },
        })),
      ],
    );
    const w = workspace(fanout, consolidation, fakeFanout);
    expect(
      tool('transaction-shapes')
        .run(w)
        .map((result) => result.title),
    ).toEqual(['5 outputs created in one transaction', '5 amounts spent together']);
    expect(tool('transaction-shapes').run(w, undefined, { minInputs: 6, minOutputs: 6 })).toEqual(
      [],
    );
    expect(tool('transaction-shapes').run(w, [fanout.txid], { fanoutRatio: 6 })).toEqual([]);
  });
  it('reports known script differences without fabricating missing input types or change attribution', () => {
    const a = transaction(1, [], [output(0, 0.1, addrA, 'pubkeyhash')]);
    const spend = transaction(10, [1, 2], [output(0)]);
    const report = tool('script-types').analyze(workspace(a, spend), [spend.txid]);
    expect(report.findings[0].title).toBe(
      'Known input and output script types differ (partial data)',
    );
    expect(report.findings[0].details).toContain(
      '1 input and 0 output types are unavailable or unrecognized',
    );
    expect(report.findings[0].details).toContain('do not identify change');
    expect(
      tool('script-types').run(workspace(a, spend), [spend.txid], { scriptMode: 'outputs' }),
    ).toEqual([]);
  });
  it('detects imported wallet paths and limits co-spend mode to inputs', () => {
    const parent = transaction(1, [], [output(0, 0.1, addrA)]),
      spend = transaction(10, [1], [output(0, 0.09, addrB)]);
    const w = workspace(parent, spend);
    w.wallets = [wallet(1, addrA), wallet(2, addrB)];
    const results = tool('wallet-intersections').run(w, [spend.txid]);
    expect(results).toHaveLength(1);
    expect(results[0].nodeIds).toEqual([outputNodeId(parent.txid, 0), outputNodeId(spend.txid, 0)]);
    expect(tool('wallet-intersections').run(w, [spend.txid], { walletMode: 'co-spent' })).toEqual(
      [],
    );
  });
  it('identifies overlapping wallet imports without claiming different participants and matches raw scripts', () => {
    const script = '0014' + '11'.repeat(20),
      hash = bytesToHex(sha256(hexToBytes(script)).reverse());
    const tx = transaction(10, [1], [{ n: 0, value: 0.01, scriptPubKey: { hex: script } }]);
    const w = workspace(tx);
    w.wallets = [wallet(1, addrA, hash), wallet(2, addrA, hash)];
    const result = tool('wallet-intersections').run(w)[0];
    expect(result.title).toContain('overlapping coverage');
    expect(result.details).toContain('not necessarily distinct participants');
    expect(result.nodeIds).toEqual([outputNodeId(tx.txid, 0)]);
  });
  it('matches attached wallet inputs and avoids distinct-wallet priority for overlapping imports', () => {
    const tx = transaction(10, [1, 2]);
    tx.vin[0].prevout = output(0, 1, addrA);
    tx.vin[1].prevout = output(0, 1, addrB);
    const w = workspace(tx);
    w.wallets = [wallet(1, addrA), wallet(2, addrB)];
    const result = tool('wallet-intersections').run(w, [tx.txid], { walletMode: 'co-spent' })[0];
    expect(result.reviewRule).toBe('distinct-wallet-inputs');
    expect(result.nodeIds).toEqual([outputNodeId(id(1), 0), outputNodeId(id(2), 0)]);
    w.wallets.push(wallet(3, addrA));
    const overlap = tool('wallet-intersections').run(w, [tx.txid], { walletMode: 'co-spent' })[0];
    expect(overlap.id).toBe(result.id);
    expect(overlap.reviewRule).toBeUndefined();
    expect(overlap.title).toContain('overlapping coverage');
  });
  it('provides serializable findings, rejects invalid parameters and does not mutate workspace data', () => {
    const tx = transaction(10, [1, 2], [output(0), output(1), output(2)]),
      w = workspace(tx);
    const before = JSON.stringify(w);
    for (const candidate of analysisTools) {
      const report = candidate.analyze(w);
      expect(report.toolId).toBe(candidate.id);
      expect(report.scopeTxids).toEqual([tx.txid]);
      expect(report.findings.every((result) => result.id.length <= 100)).toBe(true);
      expect(candidate.run(w).map((result) => result.id)).toEqual(
        report.findings.map((result) => result.id),
      );
      expect(parseWorkspace({ ...w, findings: report.findings }).findings).toHaveLength(
        report.findings.length,
      );
      expect(candidate.run(w, [])).toEqual([]);
    }
    expect(JSON.stringify(w)).toBe(before);
    expect(() => tool('equal-outputs').run(w, undefined, { minEqualOutputs: 1 })).toThrow();
    expect(() => tool('value-flow').run(w, undefined, { highFeeRate: NaN })).toThrow();
    expect(() => tool('cioh').run(w, undefined, { skipEqualOutputs: 'true' })).toThrow();
  });
});
