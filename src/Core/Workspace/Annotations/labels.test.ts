import { describe, expect, it } from 'vitest';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { exportLabels, importLabels } from './labels';
import { isExtendedPublicKey } from '../../Bitcoin';
import { createWorkspace } from '../createWorkspace';

// Public BIP32/BIP86 vectors (BSD-2-Clause) and BIP84 vectors (CC0).
// Sources and attribution: docs/references.md.
const parentXpub =
  'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5';
const taprootXpub =
  'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const masterXprv =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
// BIP32 invalid-key test vector: public version with private key data.
// It must be rejected despite its public version and valid checksum.
const privateShapedXpub =
  'xpub661MyMwAqRbcEYS8w7XLSVeEsBXy79zSzH1J8vCdxAZningWLdN3zgtU6LBpB85b3D2yc8sfvZU521AAwdZafEz7mnzBBsz4wKY5fTtTQBm';
const txid = 'a'.repeat(64);
const addr = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const base58 = base58check(sha256);
/** Re-encode a public vector with selected bytes changed; checksums stay valid. */
function mutateKey(key: string, changes: Record<number, number>): string {
  const bytes = base58.decode(key);
  for (const [offset, value] of Object.entries(changes)) bytes[Number(offset)] = value;
  return base58.encode(bytes);
}

describe('BIP329 label import boundary', () => {
  it('imports well-formed records and skips unsupported types', () => {
    const result = importLabels(
      [
        JSON.stringify({ type: 'tx', ref: txid, label: 'Funding' }),
        JSON.stringify({ type: 'output', ref: `${txid}:1`, label: 'Change' }),
        JSON.stringify({ type: 'addr', ref: addr, label: 'Savings' }),
        JSON.stringify({ type: 'xpub', ref: zpub, label: 'Wallet' }),
        JSON.stringify({ type: 'pubkey', ref: '02'.padEnd(67, 'ab'), label: 'Public key' }),
        JSON.stringify({ type: 'input', ref: `${txid}:0`, label: 'Input' }),
        JSON.stringify({ type: 'spscan', ref: 'spscan1qexample', label: 'Silent payments' }),
      ].join('\n'),
    );
    expect(Object.keys(result.annotations).sort()).toEqual([
      `addr:${addr}`,
      `out:${txid}:1`,
      `tx:${txid}`,
      `xpub:${zpub}`,
    ]);
    expect(result.annotations[`tx:${txid}`]).toEqual({
      label: 'Funding',
      note: '',
      icon: '',
      bookmarked: false,
    });
    expect(result.skipped).toBe(3);
  });

  it('accepts a UTF-8 byte-order mark and CRLF line endings', () => {
    const result = importLabels(`\uFEFF${JSON.stringify({ type: 'tx', ref: txid, label: 'BOM' })}`);
    expect(result.annotations[`tx:${txid}`].label).toBe('BOM');
    const crlf = importLabels(
      `${JSON.stringify({ type: 'tx', ref: txid, label: 'A' })}\r\n${JSON.stringify({ type: 'tx', ref: 'b'.repeat(64), label: 'B' })}\r\n`,
    );
    expect(Object.keys(crlf.annotations)).toHaveLength(2);
  });

  it('skips records with an omitted label while honoring explicit empty and whitespace labels', () => {
    const result = importLabels(
      [
        JSON.stringify({ type: 'tx', ref: txid }),
        JSON.stringify({ type: 'output', ref: `${txid}:0`, spendable: false }),
        JSON.stringify({ type: 'tx', ref: 'b'.repeat(64), label: '' }),
        JSON.stringify({ type: 'tx', ref: 'c'.repeat(64), label: '   ' }),
      ].join('\n'),
    );
    // Omitted labels leave existing values unchanged (BIP329); explicit empty
    // or whitespace strings are valid values and clear or replace labels.
    expect(result.skipped).toBe(2);
    expect(result.annotations[`tx:${'b'.repeat(64)}`].label).toBe('');
    expect(result.annotations[`tx:${'c'.repeat(64)}`].label).toBe('   ');
  });

  it('normalizes hexadecimal references and bech32 addresses to canonical lowercase', () => {
    const upper = txid.toUpperCase();
    const result = importLabels(
      [
        JSON.stringify({ type: 'tx', ref: upper, label: 'Upper' }),
        JSON.stringify({ type: 'output', ref: `${upper}:007`, label: 'Padded index' }),
        JSON.stringify({ type: 'addr', ref: addr.toUpperCase(), label: 'Upper bech32' }),
      ].join('\n'),
    );
    expect(Object.keys(result.annotations).sort()).toEqual([
      `addr:${addr}`,
      `out:${txid}:7`,
      `tx:${txid}`,
    ]);
  });

  it('accepts extended public keys at any depth and rejects private key material', () => {
    for (const ref of [parentXpub, taprootXpub, zpub]) {
      expect(
        importLabels(JSON.stringify({ type: 'xpub', ref, label: 'Key record' })).annotations[
          `xpub:${ref}`
        ].label,
      ).toBe('Key record');
    }
    for (const ref of [masterXprv, 'xpub-invalid', 'O'.repeat(111)]) {
      expect(() => importLabels(JSON.stringify({ type: 'xpub', ref, label: 'Secret' }))).toThrow(
        `Invalid reference on line 1`,
      );
    }
  });

  it('validates the complete key payload, not only the public version bytes', () => {
    // Public vector payloads mutated then re-checksummed; no secrets used.
    const uncompressedPrefix = mutateKey(taprootXpub, { 45: 4 }); // not a compressed point
    const offCurveBytes = base58.decode(taprootXpub);
    offCurveBytes.fill(0xff, 45, 78); // x = 2^256 - 1, beyond the secp256k1 field order
    offCurveBytes[45] = 2;
    const offCurve = base58.encode(offCurveBytes);
    expect(isExtendedPublicKey(parentXpub)).toBe(true);
    expect(isExtendedPublicKey(taprootXpub)).toBe(true);
    expect(isExtendedPublicKey(zpub)).toBe(true);
    for (const ref of [privateShapedXpub, uncompressedPrefix, offCurve]) {
      expect(isExtendedPublicKey(ref)).toBe(false);
      expect(() => importLabels(JSON.stringify({ type: 'xpub', ref, label: 'Bad' }))).toThrow(
        'Invalid reference on line 1',
      );
    }
  });

  it('rejects malformed references, invalid addresses, and out-of-range output indexes', () => {
    for (const record of [
      { type: 'tx', ref: 'abcd', label: 'Short' },
      { type: 'tx', ref: `${txid} `, label: 'Padded' },
      { type: 'output', ref: `${txid}:`, label: 'Missing index' },
      { type: 'output', ref: `${txid}:4294967296`, label: 'Beyond uint32' },
      { type: 'output', ref: `${txid}:-1`, label: 'Negative index' },
      { type: 'addr', ref: 'not-an-address', label: 'Junk' },
      { type: 'addr', ref: addr.slice(0, -1) + 'x', label: 'Bad checksum' },
    ]) {
      expect(() => importLabels(JSON.stringify(record))).toThrow('Invalid reference on line 1');
    }
    // Addresses from either supported network are well-formed references.
    expect(
      importLabels(
        JSON.stringify({
          type: 'addr',
          ref: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          label: 'Genesis',
        }),
      ).skipped,
    ).toBe(0);
  });

  it('rejects malformed JSON and invalid label shapes with their line numbers', () => {
    expect(() => importLabels(`{"type":"tx"`)).toThrow('Invalid JSON on label line 1');
    expect(() =>
      importLabels(`${JSON.stringify({ type: 'tx', ref: txid, label: 'ok' })}\nnot json`),
    ).toThrow('Invalid JSON on label line 2');
    for (const label of [123, null, {}, 'x'.repeat(201)]) {
      expect(() => importLabels(JSON.stringify({ type: 'tx', ref: txid, label }))).toThrow(
        'Invalid label on line 1',
      );
    }
    expect(() =>
      importLabels(JSON.stringify({ type: 'tx', ref: 42, label: 'No string ref' })),
    ).toThrow('Invalid label on line 1');
  });

  it('enforces file size and record count limits before importing', () => {
    expect(() => importLabels('x'.repeat(5_000_001))).toThrow('5 MB');
    const lines = Array.from({ length: 10001 }, () =>
      JSON.stringify({ type: 'tx', ref: txid, label: 'A' }),
    ).join('\n');
    expect(() => importLabels(lines)).toThrow('10,000');
  });

  it('round trips exported labels through import without loss', () => {
    const w = createWorkspace('Round trip', 'mainnet');
    w.annotations.entities[`tx:${txid}`] = {
      label: 'Tx label',
      note: 'note',
      icon: '★',
      bookmarked: true,
    };
    w.annotations.entities[`out:${txid}:0`] = {
      label: 'Out label',
      note: '',
      icon: '',
      bookmarked: false,
    };
    w.annotations.entities[`addr:${addr}`] = {
      label: 'Addr label',
      note: '',
      icon: '',
      bookmarked: false,
    };
    w.annotations.entities[`tx:${'c'.repeat(64)}`] = {
      label: '',
      note: 'unlabeled note stays private',
      icon: '',
      bookmarked: false,
    };
    const imported = importLabels(exportLabels(w));
    expect(Object.keys(imported.annotations).sort()).toEqual([
      `addr:${addr}`,
      `out:${txid}:0`,
      `tx:${txid}`,
    ]);
    expect(imported.annotations[`tx:${txid}`].label).toBe('Tx label');
  });
});
