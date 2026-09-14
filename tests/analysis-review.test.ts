import { describe, expect, it } from 'vitest';
import { analysisTools } from '../src/Domain/Analysis/analysis';
import {
  filterAnalysisFindings,
  findingReview,
  reviewPriorities,
} from '../src/Domain/Analysis/analysisReview';
import { newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';
import type { AnalysisFinding, Transaction } from '../src/Domain/types';
const id = (n: number) => n.toString(16).padStart(64, '0');
const finding = (
  algorithm: string,
  kind: AnalysisFinding['kind'] = 'observation',
  reviewRule?: AnalysisFinding['reviewRule'],
): AnalysisFinding => ({
  id: algorithm + kind,
  algorithm: algorithm + '-v2',
  kind,
  reviewRule,
  title: 'Fixture',
  description: 'Public synthetic evidence',
  txids: [],
  nodeIds: [],
  createdAt: new Date().toISOString(),
});

describe('Analysis review priority and faceted results', () => {
  it('uses a calculated per-finding fee threshold, not an algorithm-wide priority', () => {
    const w = newWorkspace('Fixture', 'mainnet');
    const transaction = (n: number, value: number): Transaction => ({
      txid: id(n),
      vin: [
        {
          txid: id(1),
          vout: 0,
          prevout: { value: 1, scriptPubKey: { hex: '00141111', type: 'witness_v0_keyhash' } },
        },
      ],
      vout: [{ n: 0, value, scriptPubKey: { hex: '00141111', type: 'witness_v0_keyhash' } }],
      vsize: 100,
    });
    w.transactions = {
      [id(2)]: transaction(2, 0.99999),
      [id(3)]: transaction(3, 0.99995),
      [id(4)]: transaction(4, 0.9999),
    };
    const fees = analysisTools.find((tool) => tool.id === 'value-flow')!;
    const results = fees.run(w, undefined, { highFeeRate: 50 });
    expect(results.map((f) => findingReview(f).priority)).toEqual(['low', 'high', 'high']);
    expect(
      fees
        .run(w, undefined, { highFeeRate: 101 })
        .every((f) => findingReview(f).priority === 'low'),
    ).toBe(true);
    w.findings = results;
    expect(parseWorkspace(w).findings.map((f) => f.reviewRule)).toEqual([
      undefined,
      'fee-threshold',
      'fee-threshold',
    ]);
  });
  it('keeps missing evidence low even with a stored review trigger; legacy hypotheses remain usable', () => {
    expect(findingReview(finding('value-flow', 'incomplete', 'fee-threshold')).priority).toBe(
      'low',
    );
    expect(findingReview(finding('cioh', 'hypothesis')).priority).toBe('medium');
    const legacy = finding('retired');
    delete legacy.kind;
    expect(findingReview(legacy).priority).toBe('medium');
    expect(
      findingReview(finding('address-reuse', 'observation', 'repeated-address')).priority,
    ).toBe('medium');
    expect(findingReview(finding('address-reuse')).priority).toBe('low');
    expect(
      findingReview(finding('wallet-intersections', 'observation', 'distinct-wallet-inputs'))
        .priority,
    ).toBe('medium');
    expect(findingReview(finding('wallet-intersections')).priority).toBe('low');
  });
  it('matches types and priorities with OR, facets with AND, and counts against other facets including zero', () => {
    const values = [
      finding('value-flow', 'observation', 'fee-threshold'),
      finding('value-flow', 'incomplete'),
      finding('cioh', 'hypothesis'),
      finding('address-reuse', 'observation', 'repeated-address'),
    ];
    const options = {
      types: ['value-flow', 'cioh'],
      priorities: [...reviewPriorities],
      kind: 'all',
    };
    const all = filterAnalysisFindings(values, options);
    expect(all.findings).toHaveLength(3);
    expect(all.types.get('value-flow')).toBe(2);
    expect(all.types.get('address-reuse')).toBe(1);
    expect(all.types.get('script-types')).toBe(0);
    expect(all.priorities).toEqual({ high: 1, medium: 1, low: 1 });
    const high = filterAnalysisFindings(values, { ...options, priorities: ['high'] });
    expect(high.findings).toHaveLength(1);
    expect(high.types.get('value-flow')).toBe(1);
    expect(high.types.get('cioh')).toBe(0);
    expect(high.priorities).toEqual(all.priorities);
    expect(filterAnalysisFindings(values, { ...options, types: [] }).findings).toEqual([]);
    expect(filterAnalysisFindings(values, { ...options, priorities: [] }).findings).toEqual([]);
    const missing = filterAnalysisFindings(values, { ...options, kind: 'incomplete' });
    expect(missing.findings).toHaveLength(1);
    expect(missing.priorities).toEqual({ high: 0, medium: 0, low: 1 });
    expect(filterAnalysisFindings([...values].reverse(), options).types).toEqual(all.types);
  });
});
