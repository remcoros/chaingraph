import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decodeOpReturn, OP_RETURN_DISPLAY_LIMIT } from '../src/domain/opReturn';

const utf8 = (value: string) => bytesToHex(new TextEncoder().encode(value));
function push(hex: string): string {
  const length = hex.length / 2;
  if (length < 76) return length.toString(16).padStart(2, '0') + hex;
  if (length < 256) return `4c${length.toString(16).padStart(2, '0')}${hex}`;
  return `4d${(length & 255).toString(16).padStart(2, '0')}${(length >> 8).toString(16).padStart(2, '0')}${hex}`;
}

describe('OP_RETURN display decoding', () => {
  it('only classifies a leading OP_RETURN opcode, including empty data', () => {
    expect(decodeOpReturn()).toBeUndefined();
    expect(decodeOpReturn('')).toBeUndefined();
    expect(decodeOpReturn('006a')).toBeUndefined();
    expect(decodeOpReturn('016a')).toBeUndefined();
    expect(decodeOpReturn('6A')).toMatchObject({
      preview: 'OP_RETURN',
      format: 'empty',
      byteLength: 0,
    });
    expect(decodeOpReturn('6a00')).toMatchObject({ format: 'empty', pushes: 1 });
  });

  it('reads literal pushes and keeps multiple data boundaries visible', () => {
    expect(decodeOpReturn(`6a${push(utf8('Hello'))}${push(utf8('Bitcoin ₿'))}`)).toMatchObject({
      preview: 'OP_RETURN Hello | Bitcoin ₿',
      display: 'Hello | Bitcoin ₿',
      hex: `${utf8('Hello')} ${utf8('Bitcoin ₿')}`,
      format: 'text',
      pushes: 2,
    });
  });

  it('supports all push length forms without assuming minimal encoding', () => {
    for (const length of ['01', '4c01', '4d0100', '4e01000000']) {
      expect(decodeOpReturn(`6a${length}41`)).toMatchObject({
        display: 'A',
        hex: '41',
        byteLength: 1,
      });
      expect(decodeOpReturn(`6a${length}01`)).toMatchObject({
        display: '0x01',
        hex: '01',
        format: 'hex',
      });
    }
  });

  it.each(['6a4c', '6a4d01', '6a4e010000', '6a0341', '6a4effffffff'])(
    'keeps malformed push bytes as hex: %s',
    (hex) => {
      expect(decodeOpReturn(hex)).toMatchObject({
        format: 'hex',
        hex: hex.slice(2),
        warning: expect.stringContaining('Truncated'),
      });
    },
  );

  it('does not decode a partial message before an opcode or malformed tail', () => {
    expect(decodeOpReturn('6a014161')).toMatchObject({
      format: 'hex',
      display: '0x014161',
      warning: expect.stringContaining('additional opcodes'),
    });
    expect(decodeOpReturn('6a01414c')).toMatchObject({
      format: 'hex',
      display: '0x01414c',
      warning: expect.stringContaining('Truncated'),
    });
    // OP_1 is an opcode, not a literal byte push. Do not turn it into text data.
    expect(decodeOpReturn('6a51')?.display).toBe('0x51');
  });

  it.each(['ff', 'c080', 'eda080', '00', '417f42', 'c285'])(
    'uses hex for invalid UTF-8 or binary controls: %s',
    (hex) => {
      expect(decodeOpReturn(`6a${push(hex)}`)).toMatchObject({
        display: `0x${hex}`,
        format: 'hex',
      });
    },
  );

  it('escapes line and directional controls, including a leading BOM', () => {
    const text = '\ufeffHello\nworld\t\u202eexe\u2066\u2028';
    expect(decodeOpReturn(`6a${push(utf8(text))}`)).toMatchObject({
      display: '\\u{feff}Hello\\nworld\\t\\u{202e}exe\\u{2066}\\u{2028}',
      format: 'text',
      warning: expect.stringContaining('shown as escapes'),
      hex: utf8(text),
    });
  });

  it('retains HTML-shaped content as plain text for React to escape', () => {
    const text = '<img src=x onerror=alert(1)>';
    expect(decodeOpReturn(`6a${push(utf8(text))}`)?.display).toBe(text);
  });

  it('shortens by code point, retains full copyable data, and bounds script work', () => {
    const text = '₿😀'.repeat(1000);
    const decoded = decodeOpReturn(`6a${push(utf8(text))}`)!;
    expect(decoded.preview).toBe(`OP_RETURN ${'₿😀'.repeat(36)}…`);
    expect(decoded.display).toBe(text);
    expect(decoded.byteLength).toBe(7000);
    expect(decodeOpReturn(`6a${'00'.repeat(OP_RETURN_DISPLAY_LIMIT)}`)).toMatchObject({
      format: 'unavailable',
      hex: '',
      warning: expect.stringContaining('64 KiB'),
    });
  });

  it.each(['6a0', '6aZZ', '6a 00'])(
    'marks invalid script hex rather than decoding it: %s',
    (hex) => {
      expect(decodeOpReturn(hex)).toMatchObject({
        format: 'unavailable',
        warning: 'Script hex is malformed.',
      });
    },
  );
});
