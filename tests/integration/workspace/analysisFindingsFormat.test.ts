import { describe, expect, it } from 'vitest';
import { analysisTools } from '../../../src/Core/Workspace/Analysis/analysis';
import type { Transaction } from '../../../src/Core/ChainData';
import type { TxOutput } from '../../../src/Core/Bitcoin';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
const id = (n: number) => n.toString(16).padStart(64, '0');
const addrA = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
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
  const w = createWorkspace('Analysis fixture', 'mainnet');
  w.chainData.transactions = Object.fromEntries(transactions.map((tx) => [tx.txid, tx]));
  return w;
}

describe('capability results survive workspace format validation', () => {
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
      expect(
        parseWorkspace({ ...w, analysis: { ...w.analysis, findings: report.findings } }).analysis
          .findings,
      ).toHaveLength(report.findings.length);
      expect(candidate.run(w, [])).toEqual([]);
    }
    expect(JSON.stringify(w)).toBe(before);
    expect(() => tool('equal-outputs').run(w, undefined, { minEqualOutputs: 1 })).toThrow();
    expect(() => tool('value-flow').run(w, undefined, { highFeeRate: NaN })).toThrow();
    expect(() => tool('cioh').run(w, undefined, { skipEqualOutputs: 'true' })).toThrow();
  });
});
