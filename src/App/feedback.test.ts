import { describe, expect, it } from 'vitest';
import { createBackendErrorFeedback, createFeedback } from './feedback';

describe('feedback presentation', () => {
  it('normalizes and persistently presents backend errors', () => {
    expect(createBackendErrorFeedback('  Address history\n exceeds\t its limit  ')).toEqual({
      message: 'Address history exceeds its limit',
      visibleMessage: 'Address history exceeds its limit',
      kind: 'error',
      lifetime: 'persistent',
    });
  });

  it('caps backend error presentation without changing authored feedback', () => {
    const backend = createBackendErrorFeedback('x'.repeat(1_001));
    expect(backend.message).toHaveLength(1_000);
    expect(backend.message.endsWith('…')).toBe(true);
    expect(backend.visibleMessage).toHaveLength(120);
    expect(backend.visibleMessage.endsWith('…')).toBe(true);

    expect(createFeedback('x'.repeat(121)).visibleMessage).toHaveLength(121);
  });
});
