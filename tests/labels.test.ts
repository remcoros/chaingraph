import { describe, expect, it } from 'vitest';
import { exportLabels, importLabels } from '../src/lib/labels';
import { newWorkspace } from '../src/domain/workspace';

// Public BIP84/BIP32 vectors (CC0); the xprv is BIP32 test vector 1.
const zpub =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const masterXpub =
  'xpub661MyMwAqRbcEYS8w7XLSVeEsBXy79zSzH1J8vCdxAZningWLdN3zgtU6LBpB85b3D2yc8sfvZU521AAwdZafEz7mnzBBsz4wKY5fTtTQBm';
const masterXprv =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
const txid = 'a'.repeat(64);
const addr = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

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

  it('skips records without a usable label so existing labels are never erased', () => {
    const result = importLabels(
      [
        JSON.stringify({ type: 'tx', ref: txid }),
        JSON.stringify({ type: 'tx', ref: txid, label: '' }),
        JSON.stringify({ type: 'tx', ref: txid, label: '   ' }),
        JSON.stringify({ type: 'output', ref: `${txid}:0`, spendable: false }),
      ].join('\n'),
    );
    expect(result.annotations).toEqual({});
    expect(result.skipped).toBe(4);
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
    expect(
      importLabels(JSON.stringify({ type: 'xpub', ref: masterXpub, label: 'Root account' }))
        .annotations[`xpub:${masterXpub}`].label,
    ).toBe('Root account');
    for (const ref of [masterXprv, 'xpub-invalid', 'O'.repeat(111)]) {
      expect(() => importLabels(JSON.stringify({ type: 'xpub', ref, label: 'Secret' }))).toThrow(
        `Invalid reference on line 1`,
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
    const w = newWorkspace('Round trip', 'mainnet');
    w.annotations[`tx:${txid}`] = { label: 'Tx label', note: 'note', icon: '★', bookmarked: true };
    w.annotations[`out:${txid}:0`] = {
      label: 'Out label',
      note: '',
      icon: '',
      bookmarked: false,
    };
    w.annotations[`addr:${addr}`] = { label: 'Addr label', note: '', icon: '', bookmarked: false };
    w.annotations[`tx:${'c'.repeat(64)}`] = {
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
