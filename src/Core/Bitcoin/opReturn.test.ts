import { describe, expect, it } from 'vitest';
import { isOpReturn, isProvablyUnspendable } from './opReturn';

describe('OP_RETURN script classification', () => {
  it.each(['6a', '6A026162', '6a4c', '6a4effffffff'])(
    'accepts valid raw bytes beginning with OP_RETURN: %s',
    (hex) => {
      expect(isOpReturn(hex)).toBe(true);
      expect(isProvablyUnspendable({ value: 0, scriptPubKey: { hex } })).toBe(true);
    },
  );

  it.each(['516a', '6az', '6a0', '', '6a 00'])(
    'does not classify malformed or non-OP_RETURN bytes: %s',
    (hex) => {
      expect(isOpReturn(hex)).toBe(false);
      expect(isProvablyUnspendable({ value: 0, scriptPubKey: { hex, type: 'nulldata' } })).toBe(
        false,
      );
    },
  );
});
