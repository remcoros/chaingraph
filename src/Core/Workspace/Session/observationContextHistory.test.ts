import { describe, expect, it } from 'vitest';
import { carryObservationContext } from './observationContextHistory';
import { createWorkspace } from '../createWorkspace';
const a = 'a'.repeat(64),
  b = 'b'.repeat(64);
function workspace() {
  const w = createWorkspace('Context delta fixture', 'mainnet');
  for (const id of [a, b])
    w.chainData.transactions[id] = {
      txid: id,
      vin: [{ coinbase: '00' }],
      vout: [
        { n: 0, value: 1, scriptPubKey: { hex: '51' } },
        { n: 1, value: 1, scriptPubKey: { hex: '51' } },
      ],
    };
  return w;
}
describe('quiet observation context deltas', () => {
  it('keeps historical removed ancestry unchanged on camera-only saves', () => {
    const history = {
      ...workspace(),
      chainData: { ...workspace().chainData, contextTransactionIds: [a] },
      view: { ...workspace().view, inputContext: { [a]: [0] } },
    };
    const before = workspace();
    delete before.chainData.transactions[a];
    const after = { ...before, view: { ...before.view, glow: false } };
    expect(carryObservationContext(history, before, after)).toBe(history);
  });
  it('applies only changed transaction scopes and provenance, retaining unrelated historical context', () => {
    const history = {
      ...workspace(),
      chainData: { ...workspace().chainData, contextTransactionIds: [a, b] },
      view: { ...workspace().view, inputContext: { [a]: [0], [b]: [0] } },
    };
    const before = {
      ...workspace(),
      chainData: { ...workspace().chainData, contextTransactionIds: [b] },
      view: { ...workspace().view, inputContext: { [b]: [0] } },
    };
    const after = {
      ...before,
      chainData: { ...before.chainData, contextTransactionIds: undefined },
      view: { ...before.view, inputContext: { [b]: [1] } },
    };
    const next = carryObservationContext(history, before, after);
    expect(next.view.inputContext).toEqual({ [a]: [0], [b]: [1] });
    expect(next.chainData.contextTransactionIds).toEqual([a]);
    expect(history.view.inputContext[b]).toEqual([0]);
  });
  it('does not install context for a transaction absent from a historical snapshot', () => {
    const history = workspace();
    delete history.chainData.transactions[b];
    const before = workspace();
    const after = {
      ...before,
      chainData: { ...before.chainData, contextTransactionIds: [b] },
      view: { ...before.view, inputContext: { [b]: [0] } },
    };
    expect(carryObservationContext(history, before, after)).toBe(history);
  });
  it('does not churn snapshots for semantically identical context records', () => {
    const before = {
      ...workspace(),
      chainData: { ...workspace().chainData, contextTransactionIds: [a] },
      view: { ...workspace().view, inputContext: { [a]: [0] } },
    };
    const after = {
      ...before,
      chainData: { ...before.chainData, contextTransactionIds: [a] },
      view: { ...before.view, inputContext: { [a]: [0] } },
    };
    expect(carryObservationContext(before, before, after)).toBe(before);
  });
});
