import { describe, expect, it } from 'vitest';
import { openFlowPanel, setFlowPanelTransaction } from './panelState';

describe('workspace panel state', () => {
  it('opens collapsed flow state without shrinking full-height state', () => {
    expect(openFlowPanel({ height: 'collapsed' })).toEqual({ height: 'expanded' });
    expect(openFlowPanel({ height: 'full' }, { transactionId: 'a'.repeat(64) })).toEqual({
      height: 'full',
      transactionId: 'a'.repeat(64),
    });
  });

  it('changes the displayed transaction without changing flow height', () => {
    const transactionId = 'b'.repeat(64);

    expect(
      setFlowPanelTransaction(
        { height: 'collapsed', transactionId: 'a'.repeat(64), expandedInputs: true },
        transactionId,
      ),
    ).toEqual({ height: 'collapsed', transactionId, expandedInputs: true });
    expect(setFlowPanelTransaction({ height: 'full' }, transactionId)).toEqual({
      height: 'full',
      transactionId,
    });
  });
});
