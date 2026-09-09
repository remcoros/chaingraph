import { expect, it, vi } from 'vitest';
import { analysisScriptType } from '../src/domain/analysis/scripts';
import { analysisTools } from '../src/domain/analysis';
import { recoverAnalysisData } from '../src/domain/analysisRecovery';
import { newWorkspace } from '../src/domain/workspace';
import type { TxOutput } from '../src/domain/types';
const output = (hex?: string, type?: string): TxOutput => ({
  n: 0,
  value: 1,
  scriptPubKey: { hex, type },
});

it('recognizes exact standard script templates even without node-supplied type labels', () => {
  for (const [hex, type] of [
    ['76a914' + 'ab'.repeat(20) + '88ac', 'P2PKH'],
    ['a914' + 'ab'.repeat(20) + '87', 'P2SH'],
    ['0014' + 'ab'.repeat(20), 'P2WPKH'],
    ['0020' + 'ab'.repeat(32), 'P2WSH'],
    ['5120' + 'ab'.repeat(32), 'Taproot'],
  ]) {
    expect(analysisScriptType(output(hex.toUpperCase()))).toBe(type);
    expect(analysisScriptType(output(hex + '00'))).toBeUndefined();
    expect(analysisScriptType(output(hex.slice(0, -2)))).toBeUndefined();
  }
  expect(analysisScriptType(output('0020' + 'ab'.repeat(32), 'nonstandard'))).toBe('P2WSH');
});
it('does not identify unsupported scripts, hidden P2SH contents, or contradictory labels', () => {
  expect(
    analysisScriptType(output('0014' + 'ab'.repeat(20), 'witness_v1_taproot')),
  ).toBeUndefined();
  expect(analysisScriptType(output('5220' + 'ab'.repeat(32)))).toBeUndefined();
  expect(analysisScriptType(output(undefined, 'invented_type'))).toBeUndefined();
  expect(analysisScriptType(output('a914' + 'ab'.repeat(20) + '87'))).toBe('P2SH');
  expect(analysisScriptType(output(undefined, 'multisig'))).toBe('bare multisig');
});
it('compares available script bytes without unnecessary recovery requests or change/owner assignments', async () => {
  const w = newWorkspace('Public script fixture', 'mainnet');
  const txid = 'a'.repeat(64);
  w.transactions[txid] = {
    txid,
    vin: [{ txid: 'b'.repeat(64), vout: 0, prevout: output('0014' + 'ab'.repeat(20)) }],
    vout: [output('5120' + 'cd'.repeat(32))],
  };
  const tool = analysisTools.find((tool) => tool.id === 'script-types')!;
  const report = tool.analyze(w);
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0].kind).toBe('observation');
  expect(report.findings[0].description).toContain('Known input types: P2WPKH');
  expect(report.findings[0].description).toContain('Known output types: Taproot');
  expect(report.findings[0].description).toContain('do not identify change');
  expect(report.stats.find((stat) => stat.label === 'Unavailable input types')?.value).toBe(0);
  const fetch = vi.fn();
  await recoverAnalysisData(w, [txid], fetch, new AbortController().signal);
  expect(fetch).not.toHaveBeenCalled();
});
it('does not request complete script bytes again when the comparison cannot recognize their type', async () => {
  const w = newWorkspace('Public unsupported script fixture', 'mainnet');
  const txid = 'a'.repeat(64);
  w.transactions[txid] = {
    txid,
    vin: [{ txid: 'b'.repeat(64), vout: 0, prevout: output('51') }],
    vout: [output('5120' + 'cd'.repeat(32))],
  };
  const tool = analysisTools.find((tool) => tool.id === 'script-types')!;
  expect(tool.run(w)[0]).toMatchObject({
    kind: 'incomplete',
    title: 'Script comparison incomplete',
  });
  const fetch = vi.fn();
  const result = await recoverAnalysisData(w, [txid], fetch, new AbortController().signal);
  expect(fetch).not.toHaveBeenCalled();
  expect(result.workspace).toBe(w);
});
