import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { isOpReturn } from '../../../Core/Bitcoin';

/** A UI budget, not a Bitcoin consensus or relay-policy limit. */
const OP_RETURN_DISPLAY_LIMIT = 65_536;

export interface OpReturnData {
  /** Includes the opcode name and at most 72 data code points. */
  preview: string;
  /** Bounded, safe display data. Push boundaries are separated by ` | `. */
  display: string;
  /** Space-separated pushed bytes, or the script tail if it cannot be parsed. */
  hex: string;
  format: 'text' | 'hex' | 'empty' | 'unavailable';
  byteLength: number;
  pushes: number;
  warning?: string;
}

function result(
  display: string,
  hex: string,
  format: OpReturnData['format'],
  byteLength: number,
  pushes = 0,
  warning?: string,
): OpReturnData {
  const characters = Array.from(display);
  return {
    preview: `OP_RETURN${display ? ` ${characters.slice(0, 72).join('')}${characters.length > 72 ? '…' : ''}` : ''}`,
    display,
    hex,
    format,
    byteLength,
    pushes,
    warning,
  };
}

function hasBinaryControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      (codePoint >= 0 && codePoint <= 8) ||
      (codePoint >= 11 && codePoint <= 12) ||
      (codePoint >= 14 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159)
    );
  });
}

/** Inspect literal push data only. Never executes a script or interprets a protocol. */
export function decodeOpReturn(hex?: string): OpReturnData | undefined {
  if (!isOpReturn(hex)) return undefined;
  if (hex.length > OP_RETURN_DISPLAY_LIMIT * 2)
    return result(
      'data exceeds display limit',
      '',
      'unavailable',
      Math.floor(hex.length / 2),
      0,
      'Script exceeds the 64 KiB data-display limit. Inspect the original script hex instead.',
    );
  if (hex.length % 2 || !/^[0-9a-fA-F]+$/.test(hex))
    return result('invalid script hex', '', 'unavailable', 0, 0, 'Script hex is malformed.');

  const bytes = hexToBytes(hex);
  const chunks: Uint8Array[] = [];
  let offset = 1;
  const fallback = (warning: string) => {
    const tail = hex.slice(2).toLowerCase();
    return result(tail ? `0x${tail}` : '', tail, 'hex', bytes.length - 1, 0, warning);
  };
  while (offset < bytes.length) {
    const opcode = bytes[offset++];
    if (opcode > 0x4e)
      return fallback(
        'Contains additional opcodes. Showing script bytes after OP_RETURN, not decoded message data.',
      );
    let length = opcode;
    if (opcode >= 0x4c) {
      const width = opcode === 0x4c ? 1 : opcode === 0x4d ? 2 : 4;
      if (bytes.length - offset < width)
        return fallback('Truncated push length. Showing the original script tail.');
      length = 0;
      for (let index = 0; index < width; index++) length += bytes[offset++] * 2 ** (index * 8);
    }
    if (length > bytes.length - offset)
      return fallback('Truncated push data. Showing the original script tail.');
    chunks.push(bytes.subarray(offset, offset + length));
    offset += length;
  }

  const byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!byteLength) return result('', chunks.map(bytesToHex).join(' '), 'empty', 0, chunks.length);
  const dataHex = chunks.map(bytesToHex).join(' ');
  try {
    // Keep BOM bytes visible instead of silently consuming a leading U+FEFF.
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const text = chunks.map((chunk) => decoder.decode(chunk));
    // A valid UTF-8 encoding can still be binary data. Keep these bytes as hex.
    if (text.some(hasBinaryControlCharacter))
      return result(`0x${dataHex}`, dataHex, 'hex', byteLength, chunks.length);
    let escaped = false;
    const display = text
      .map((part) =>
        part.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
          escaped = true;
          if (character === '\n') return '\\n';
          if (character === '\r') return '\\r';
          if (character === '\t') return '\\t';
          return `\\u{${character.codePointAt(0)!.toString(16)}}`;
        }),
      )
      .join(' | ');
    return result(
      display,
      dataHex,
      'text',
      byteLength,
      chunks.length,
      escaped
        ? 'Control and formatting characters are shown as escapes. Copy hex for exact bytes.'
        : undefined,
    );
  } catch {
    return result(`0x${dataHex}`, dataHex, 'hex', byteLength, chunks.length);
  }
}
