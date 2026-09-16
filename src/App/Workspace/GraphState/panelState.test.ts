import { describe, expect, it } from 'vitest';
import { openFlowPanel } from './panelState';

describe('workspace panel state', () => {
  it('opens collapsed flow state without shrinking full-height state', () => {
    expect(openFlowPanel({ height: 'collapsed' })).toEqual({ height: 'expanded' });
    expect(openFlowPanel({ height: 'full' }, { transactionId: 'a'.repeat(64) })).toEqual({
      height: 'full',
      transactionId: 'a'.repeat(64),
    });
  });
});
