import { describe, expect, it } from 'vitest';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { parseExtendedPublicKey } from '../../Bitcoin';
import { createWorkspace } from '../createWorkspace';
import { emptyAnnotation } from './emptyAnnotation';
import {
  inspectLabels,
  planLabelImport,
  applyLabelImport,
  planLabelExport,
  defaultLabelImportOptions,
  defaultLabelExportOptions,
} from './labels';
import { PUBLIC_ZPUB } from '../../../../tests/fixtures/bitcoin';
import type { Workspace } from '../workspace';

const txid = 'a'.repeat(64),
  addr = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const parentXpub =
  'xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5';
const privateShapedXpub =
  'xpub661MyMwAqRbcEYS8w7XLSVeEsBXy79zSzH1J8vCdxAZningWLdN3zgtU6LBpB85b3D2yc8sfvZU521AAwdZafEz7mnzBBsz4wKY5fTtTQBm';
const masterXprv =
  'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi';
// Public BIP32/BIP84 vectors; attribution in docs/references.md.
const row = (type: string, ref: string, label?: unknown, origin?: string) =>
  JSON.stringify({ type, ref, label, origin });
function wallet(
  workspace: Workspace,
  key = PUBLIC_ZPUB,
  scriptType: 'p2wpkh' | 'p2pkh' = 'p2wpkh',
) {
  const item = {
    id: crypto.randomUUID(),
    name: 'Wallet display name',
    key,
    scriptType,
    color: '#aabbcc',
    addresses: [],
  };
  workspace.wallets.definitions.push(item);
  return item;
}
function importPlan(
  workspace: Workspace,
  content: string,
  options: Partial<ReturnType<typeof defaultLabelImportOptions>> = {},
) {
  return planLabelImport(workspace, inspectLabels(content, workspace.network), {
    ...defaultLabelImportOptions(workspace.network),
    ...options,
  });
}

describe('BIP329 inspection and reviewed import', () => {
  it('recovers valid rows, preserves duplicates/origins and reports physical lines', () => {
    const result = inspectLabels(
      [
        row('tx', txid, 'A', 'account A'),
        '',
        '{bad',
        row('tx', txid, 'B', 'account B'),
        row('input', `${txid}:0`, 'Unsupported'),
        row('tx', 'b'.repeat(64)),
        row('addr', addr, 'valid'),
      ].join('\n'),
      'mainnet',
    );
    expect(result.records.map((record) => [record.line, record.label])).toEqual([
      [1, 'A'],
      [4, 'B'],
      [7, 'valid'],
    ]);
    expect(result.origins).toEqual(['account A', 'account B']);
    expect(result.issues.map((issue) => [issue.line, issue.reason])).toEqual([
      [3, 'malformed'],
      [5, 'unsupported'],
      [6, 'no-label'],
    ]);
    expect(result.issues.find((issue) => issue.reason === 'unsupported')?.recordType).toBe('input');
  });
  it('accepts BOM, CRLF, Unicode, literal punctuation and canonical references', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    const plan = importPlan(
      workspace,
      `\uFEFF${row('tx', txid.toUpperCase(), 'literal, [tag] é')}\r\n${row('output', `${txid.toUpperCase()}:007`, 'output')}\r\n${row('addr', addr.toUpperCase(), 'address')}`,
    );
    expect(Object.keys(plan.next.annotations.entities).sort()).toEqual([
      `addr:${addr}`,
      `out:${txid}:7`,
      `tx:${txid}`,
    ]);
    expect(plan.next.annotations.entities[`tx:${txid}`].label).toBe('literal, [tag] é');
    expect(workspace.annotations.entities).toEqual({});
  });
  it('rejects invalid shapes, checksums, private-shaped and off-curve keys per record', () => {
    const bytes = base58check(sha256).decode(PUBLIC_ZPUB);
    bytes.fill(0xff, 45, 78);
    bytes[45] = 2;
    const offCurve = base58check(sha256).encode(bytes);
    const records = [
      null,
      [],
      3,
      { type: 'tx', ref: 42, label: 'bad' },
      { type: 'tx', ref: txid, label: {} },
      { type: 'tx', ref: 'short', label: 'bad' },
      { type: 'output', ref: `${txid}:4294967296`, label: 'bad' },
      { type: 'addr', ref: addr.slice(0, -1) + 'x', label: 'bad' },
      ...[masterXprv, privateShapedXpub, offCurve].map((ref) => ({
        type: 'xpub',
        ref,
        label: 'bad',
      })),
    ];
    const result = inspectLabels(
      records.map((record) => JSON.stringify(record)).join('\n'),
      'mainnet',
    );
    expect(result.records).toEqual([]);
    expect(result.issues).toHaveLength(records.length);
    expect(result.issues.every((issue) => issue.reason === 'malformed')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(masterXprv);
  });
  it('accepts any-depth public key records and rejects wrong-network keys/addresses', () => {
    expect(inspectLabels(row('xpub', parentXpub, 'Parent'), 'mainnet').records).toHaveLength(1);
    const main = inspectLabels(
      [row('addr', addr, 'Main'), row('xpub', PUBLIC_ZPUB, 'Main')].join('\n'),
      'testnet4',
    );
    expect(main.records).toEqual([]);
    expect(main.issues.map((issue) => issue.reason)).toEqual(['wrong-network', 'wrong-network']);
    const workspace = createWorkspace('fixture', 'mainnet');
    expect(
      importPlan(workspace, row('tx', txid, 'unknown network'), { sourceNetwork: 'testnet4' })
        .changes,
    ).toEqual([]);
  });
  it('excludes source conflicts until an account or first/last policy is chosen', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    const content = [row('tx', txid, 'A', 'account A'), row('tx', txid, 'B', 'account B')].join(
      '\n',
    );
    expect(importPlan(workspace, content).changes).toEqual([]);
    expect(
      importPlan(workspace, content, { origin: 'account A' }).next.annotations.entities[
        `tx:${txid}`
      ].label,
    ).toBe('A');
    expect(
      importPlan(workspace, content, { conflicts: 'last' }).next.annotations.entities[`tx:${txid}`]
        .label,
    ).toBe('B');
    expect(
      importPlan(workspace, `${row('tx', txid, 'A')}\n${row('tx', txid, 'A')}`).changes,
    ).toHaveLength(1);
  });
  it('preserves native fields and existing text; clears and replacement are explicit', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    workspace.annotations.entities[`tx:${txid}`] = {
      label: 'Existing',
      note: 'Note',
      icon: '★',
      bookmarked: true,
    };
    expect(importPlan(workspace, row('tx', txid, 'New')).next).toBe(workspace);
    expect(importPlan(workspace, row('tx', txid, '')).next).toBe(workspace);
    const clear = importPlan(workspace, row('tx', txid, ''), { applyClears: true });
    expect(clear.next.annotations.entities[`tx:${txid}`]).toEqual({
      label: '',
      note: 'Note',
      icon: '★',
      bookmarked: true,
    });
    const replace = importPlan(workspace, row('tx', txid, 'New'), { existingText: 'replace' });
    expect(replace.next.annotations.entities[`tx:${txid}`].note).toBe('Note');
    expect(applyLabelImport(workspace, replace).annotations.entities[`tx:${txid}`].label).toBe(
      'New',
    );
    expect(() =>
      applyLabelImport({ ...workspace, annotations: { ...workspace.annotations } }, replace),
    ).toThrow('Workspace changed');
    expect(applyLabelImport({ ...workspace, name: 'View-only change' }, replace).name).toBe(
      'View-only change',
    );
  });
  it('distinguishes protected text from already matching text or tag membership', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    workspace.annotations.entities[`tx:${txid}`] = { ...emptyAnnotation, label: 'Existing' };
    const kept = importPlan(workspace, row('tx', txid, 'Incoming'));
    expect(kept.issues[0]).toMatchObject({
      line: 1,
      reason: 'kept',
      text: { current: 'Existing', incoming: 'Incoming' },
    });
    expect(kept.next).toBe(workspace);
    expect(importPlan(workspace, row('tx', txid, 'Existing')).issues[0].reason).toBe('unchanged');
    const firstTag = importPlan(workspace, row('tx', txid, 'business'), { profile: 'btcpay' });
    const secondTag = importPlan(firstTag.next, row('tx', txid, 'business'), { profile: 'btcpay' });
    expect(secondTag.issues[0].reason).toBe('unchanged');
    expect(secondTag.changes).toEqual([]);
    expect(secondTag.next).toBe(firstTag.next);
  });
  it.each([201, 255])(
    'round trips a %i-unit label through reviewed import and export',
    (length) => {
      const workspace = createWorkspace('fixture', 'mainnet'),
        label = 'é'.repeat(length);
      const imported = applyLabelImport(workspace, importPlan(workspace, row('tx', txid, label)));
      const exported = planLabelExport(imported, defaultLabelExportOptions());
      expect(
        importPlan(workspace, exported.content).next.annotations.entities[`tx:${txid}`].label,
      ).toBe(label);
    },
  );
  it('only shortens explicitly, without splitting a surrogate pair', () => {
    const workspace = createWorkspace('fixture', 'mainnet'),
      label = 'a'.repeat(254) + '😀';
    expect(importPlan(workspace, row('tx', txid, label)).issues[0].reason).toBe('length');
    const plan = importPlan(workspace, row('tx', txid, label), { shorten: true });
    expect(plan.changes[0].after).toBe('a'.repeat(254));
    expect(plan.changes[0].original).toBe(label);
  });
  it('excludes escaped lone surrogates without losing valid tag records', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    const plan = importPlan(
      workspace,
      [
        row('tx', txid, 'Valid tag 😀'),
        row('tx', txid, '\ud800'),
        row('tx', txid, '\udfff'),
        row('tx', txid, 'Bad origin', '\ud800'),
      ].join('\n'),
      { profile: 'btcpay', shorten: true },
    );
    expect(plan.next.annotations.tags?.map((tag) => tag.name)).toEqual(['Valid tag 😀']);
    expect(plan.issues.map((issue) => [issue.line, issue.reason])).toEqual([
      [2, 'malformed'],
      [3, 'malformed'],
      [4, 'malformed'],
    ]);
  });
  it('preserves repeated BTCPay tags and literal punctuation without duplicating labels', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    workspace.annotations.entities[`tx:${txid}`] = {
      ...emptyAnnotation,
      label: 'Keep',
      note: 'Keep note',
    };
    const plan = importPlan(
      workspace,
      [
        row('tx', txid, 'business'),
        row('tx', txid, 'reviewed'),
        row('tx', txid, 'literal, punctuation'),
        row('tx', txid, 'business'),
      ].join('\n'),
      { profile: 'btcpay' },
    );
    expect(plan.next.annotations.tags?.map((tag) => tag.name)).toEqual([
      'business',
      'reviewed',
      'literal, punctuation',
    ]);
    expect(plan.next.annotations.entities).toEqual(workspace.annotations.entities);
    expect(plan.changes).toHaveLength(3);
    expect(
      importPlan(plan.next, row('tx', txid, 'business'), { profile: 'btcpay' }).changes,
    ).toEqual([]);
  });
  it('maps BlueWallet/Keeper transaction text to Notes and Keeper chips to tags', () => {
    const workspace = createWorkspace('fixture', 'mainnet'),
      memo = 'memo, [literal]\n' + 'é'.repeat(300);
    for (const profile of ['bluewallet', 'keeper'] as const) {
      const plan = importPlan(workspace, row('tx', txid, memo), { profile });
      expect(plan.next.annotations.entities[`tx:${txid}`]).toEqual({
        ...emptyAnnotation,
        note: memo,
      });
    }
    expect(
      importPlan(workspace, row('addr', addr, 'chip'), { profile: 'keeper' }).next.annotations
        .tags?.[0].name,
    ).toBe('chip');
    expect(
      importPlan(workspace, row('tx', txid, 'as label'), {
        profile: 'bluewallet',
        transactionText: 'label',
      }).next.annotations.entities[`tx:${txid}`].label,
    ).toBe('as label');
  });
  it('excludes shortening collisions and observes native tag limits', () => {
    const workspace = createWorkspace('fixture', 'mainnet'),
      prefix = 'x'.repeat(100);
    const plan = importPlan(
      workspace,
      [row('tx', txid, prefix + 'A'), row('tx', txid, prefix + 'B')].join('\n'),
      { profile: 'btcpay', shorten: true },
    );
    expect(plan.changes).toEqual([]);
    expect(plan.issues.map((issue) => issue.reason)).toEqual(['collision', 'collision']);
    workspace.annotations.tags = Array.from({ length: 200 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `tag ${index}`,
      color: '#aabbcc',
      nodeIds: [],
    }));
    const budget = importPlan(
      workspace,
      [row('tx', txid, 'new tag'), row('tx', txid, 'tag 0')].join('\n'),
      { profile: 'btcpay' },
    );
    expect(budget.issues[0].reason).toBe('tag-budget');
    expect(budget.changes).toHaveLength(1);
  });
  it('matches equivalent public encodings while keeping wallet rename explicit and policy safe', () => {
    const workspace = createWorkspace('fixture', 'mainnet'),
      w = wallet(workspace);
    const xpub = parseExtendedPublicKey(PUBLIC_ZPUB, 'mainnet').bip32Key;
    const plan = importPlan(workspace, row('xpub', xpub, 'é'.repeat(255)));
    expect(plan.next.annotations.entities[`xpub:${PUBLIC_ZPUB}`].label).toHaveLength(255);
    expect(plan.next.wallets.definitions[0].name).toBe(w.name);
    expect(
      importPlan(workspace, row('xpub', xpub, 'New name'), { renameWallets: true }).next.wallets
        .definitions[0].name,
    ).toBe('New name');
    wallet(workspace, xpub, 'p2pkh');
    expect(
      importPlan(workspace, row('xpub', xpub, 'Ambiguous'), {
        renameWallets: true,
      }).next.wallets.definitions.map((item) => item.name),
    ).toEqual([w.name, w.name]);
    expect(
      importPlan(workspace, row('xpub', PUBLIC_ZPUB, 'Native only'), {
        renameWallets: true,
      }).next.wallets.definitions.map((item) => item.name),
    ).toEqual(['Native only', w.name]);
    workspace.annotations.entities[`xpub:${xpub}`] = {
      ...emptyAnnotation,
      label: 'Existing plain key annotation',
    };
    expect(
      importPlan(workspace, row('xpub', PUBLIC_ZPUB, 'Native only'), {
        renameWallets: true,
      }).next.wallets.definitions.map((item) => item.name),
    ).toEqual(['Native only', w.name]);
  });
  it('rejects overall byte/record budgets before recovering individual rows', () => {
    expect(() => inspectLabels('é'.repeat(2_500_001), 'mainnet')).toThrow('5 MB');
    expect(() =>
      inspectLabels(
        Array(10001)
          .fill(row('tx', txid, 'A'))
          .join('\n'),
        'mainnet',
      ),
    ).toThrow('10,000');
    const workspace = createWorkspace('fixture', 'mainnet');
    expect(
      importPlan(
        workspace,
        Array(10000)
          .fill(row('xpub', PUBLIC_ZPUB, 'same'))
          .join('\n'),
      ).changes,
    ).toHaveLength(1);
  });
});

describe('destination-aware BIP329 export', () => {
  it('omits empty/key labels by default and explicit key labels win over equivalent-key fallback', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    wallet(workspace);
    const xpub = parseExtendedPublicKey(PUBLIC_ZPUB, 'mainnet').bip32Key;
    workspace.annotations.entities[`xpub:${xpub}`] = {
      ...emptyAnnotation,
      label: 'Explicit key label',
    };
    workspace.annotations.entities[`xpub:${PUBLIC_ZPUB}`] = { ...emptyAnnotation };
    expect(planLabelExport(workspace, defaultLabelExportOptions()).recordCount).toBe(0);
    const plan = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      includeKeyLabels: true,
      walletNameFallback: true,
    });
    expect(plan.issues).toEqual([]);
    expect(plan.recordCount).toBe(1);
    expect(JSON.parse(plan.content)).toEqual({
      type: 'xpub',
      ref: xpub,
      label: 'Explicit key label',
    });
    workspace.annotations.entities[`xpub:${xpub}`] = { ...emptyAnnotation };
    workspace.annotations.entities[`xpub:${PUBLIC_ZPUB}`] = {
      ...emptyAnnotation,
      label: 'Explicit key label',
    };
    const reversed = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      includeKeyLabels: true,
      walletNameFallback: true,
    });
    expect(reversed.issues).toEqual([]);
    expect(reversed.content).toBe(plan.content);
    const overLimit = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      profile: 'sparrow',
      includeKeyLabels: true,
      walletNameFallback: true,
    });
    expect(overLimit.recordCount).toBe(0);
    expect(overLimit.issues.map((issue) => issue.reason)).toEqual(['length']);
  });
  it('uses one canonical key record and excludes conflicting equivalent labels', () => {
    const workspace = createWorkspace('fixture', 'mainnet'),
      xpub = parseExtendedPublicKey(PUBLIC_ZPUB, 'mainnet').bip32Key;
    workspace.annotations.entities[`xpub:${xpub}`] = { ...emptyAnnotation, label: 'One' };
    workspace.annotations.entities[`xpub:${PUBLIC_ZPUB}`] = { ...emptyAnnotation, label: 'Two' };
    const plan = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      includeKeyLabels: true,
    });
    expect(plan.recordCount).toBe(0);
    expect(plan.issues.every((issue) => issue.reason === 'conflict')).toBe(true);
  });
  it('exports BTCPay tags, trims before length checking, deduplicates destination text and detects collisions', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    workspace.annotations.entities[`tx:${txid}`] = { ...emptyAnnotation, label: ' business ' };
    workspace.annotations.tags = [
      { id: crypto.randomUUID(), name: 'business', color: '#aabbcc', nodeIds: [`tx:${txid}`] },
    ];
    const options = {
      ...defaultLabelExportOptions(),
      profile: 'btcpay' as const,
      includeEntityLabels: true,
    };
    const plan = planLabelExport(workspace, options);
    expect(plan.recordCount).toBe(1);
    expect(JSON.parse(plan.content).label).toBe('business');
    workspace.annotations.tags = ['A', 'B'].map((suffix) => ({
      id: crypto.randomUUID(),
      name: 'x'.repeat(50) + suffix,
      color: '#aabbcc',
      nodeIds: [`tx:${txid}`],
    }));
    expect(
      planLabelExport(workspace, {
        ...options,
        includeEntityLabels: false,
        shorten: true,
      }).issues.map((issue) => issue.reason),
    ).toEqual(['collision', 'collision']);
    expect(workspace.annotations.tags[0].name).toHaveLength(51);
  });
  it('composes readable tags only when selected and keeps the result literal on import', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    workspace.annotations.entities[`tx:${txid}`] = { ...emptyAnnotation, label: 'Shop payment' };
    workspace.annotations.tags = ['business', 'reviewed'].map((name) => ({
      id: crypto.randomUUID(),
      name,
      color: '#aabbcc',
      nodeIds: [`tx:${txid}`],
    }));
    const plan = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      includeTagsInLabels: true,
    });
    const fresh = createWorkspace('fresh', 'mainnet');
    expect(importPlan(fresh, plan.content).next.annotations.entities[`tx:${txid}`].label).toBe(
      'Shop payment [business, reviewed]',
    );
    expect(importPlan(fresh, plan.content).next.annotations.tags).toEqual([]);
  });
  it('exports Notes with label fallback; BlueWallet is mainnet-only and Keeper requires a wallet', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    workspace.annotations.entities[`tx:${txid}`] = {
      ...emptyAnnotation,
      label: 'Label',
      note: 'Note',
    };
    const options = { ...defaultLabelExportOptions(), profile: 'bluewallet' as const };
    expect(JSON.parse(planLabelExport(workspace, options).content).label).toBe('Note');
    expect(
      JSON.parse(planLabelExport(workspace, { ...options, transactionText: 'label' }).content)
        .label,
    ).toBe('Label');
    expect(planLabelExport(createWorkspace('test', 'testnet4'), options).blocked).toContain(
      'mainnet',
    );
    expect(planLabelExport(workspace, { ...options, profile: 'keeper' }).blocked).toContain(
      'one wallet',
    );
  });
  it('shows destination length exclusions and explicit transformations without mutating native text', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    wallet(workspace);
    workspace.annotations.entities[`xpub:${PUBLIC_ZPUB}`] = {
      ...emptyAnnotation,
      label: 'Long keystore label',
    };
    const options = {
      ...defaultLabelExportOptions(),
      profile: 'sparrow' as const,
      includeKeyLabels: true,
    };
    expect(planLabelExport(workspace, options).issues[0].reason).toBe('length');
    const shortened = planLabelExport(workspace, { ...options, shorten: true });
    expect(JSON.parse(shortened.content).label).toBe('Long keystore la');
    expect(shortened.textChanges[0].original).toBe('Long keystore label');
    expect(workspace.annotations.entities[`xpub:${PUBLIC_ZPUB}`].label).toBe('Long keystore label');
  });
  it('blocks record and UTF-8 byte overflows and never builds an oversized download', () => {
    const workspace = createWorkspace('fixture', 'mainnet');
    for (let index = 0; index < 10001; index++)
      workspace.annotations.entities[`tx:${index.toString(16).padStart(64, '0')}`] = {
        ...emptyAnnotation,
        label: 'A',
      };
    const records = planLabelExport(workspace, defaultLabelExportOptions());
    expect(records.blocked).toContain('10,000');
    expect(records.content).toBe('');
    workspace.annotations.entities = {};
    for (let index = 0; index < 260; index++)
      workspace.annotations.entities[`tx:${index.toString(16).padStart(64, '0')}`] = {
        ...emptyAnnotation,
        note: 'é'.repeat(10000),
      };
    const bytes = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      profile: 'bluewallet',
    });
    expect(bytes.recordCount).toBe(260);
    expect(bytes.blocked).toContain('5 MB');
    expect(bytes.content).toBe('');
    workspace.annotations.entities = {};
    workspace.annotations.tags = [
      {
        id: crypto.randomUUID(),
        name: 'x'.repeat(50),
        color: '#aabbcc',
        nodeIds: Array.from(
          { length: 7000 },
          (_, index) => `tx:${index.toString(16).padStart(64, '0')}`,
        ),
      },
    ];
    const btcpay = planLabelExport(workspace, {
      ...defaultLabelExportOptions(),
      profile: 'btcpay',
    });
    expect(btcpay.blocked).toContain('1 MB');
    expect(btcpay.content).toBe('');
  });
});
