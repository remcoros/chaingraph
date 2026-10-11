import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
  applyEntityNote,
  createBatchTag,
  planBatchIcon,
  planBatchLabel,
  planBatchTag,
} from './batchMetadata';
import {
  applyBatchLabel as applyNativeLabel,
  createBatchTag as createNativeTag,
} from './batchEdits';
import { clampAnnotationText } from './annotations';
import { defaultLabelExportOptions, inspectLabels, planLabelExport } from './labels';
import { createWorkspace } from '../createWorkspace';
import type { Workspace } from '../workspace';

const id = (n: number) => n.toString(16).padStart(64, '0');
const OUT_A = `out:${id(1)}:0`;
const OUT_B = `out:${id(1)}:1`;
const OUT_C = `out:${id(2)}:0`;
const TX = `tx:${id(3)}`;

function fixture(): Workspace {
  return {
    ...createWorkspace('Batch fixture', 'mainnet'),
    annotations: {
      ...createWorkspace('Batch fixture', 'mainnet').annotations,
      entities: {
        [OUT_A]: { label: 'Kept label', note: 'A note', icon: '★', bookmarked: true },
      },
    },
  };
}

describe('batch label and icon edits', () => {
  it('preserves existing labels unless replacement is explicit', () => {
    const workspace = fixture();
    const plan = planBatchLabel(workspace, [OUT_A, OUT_B, OUT_C]);
    expect(plan.targets).toEqual([OUT_B, OUT_C]);
    expect(plan.preserved).toBe(1);
    const applied = applyBatchLabel(workspace, [OUT_A, OUT_B, OUT_C], 'Exchange A withdrawal');
    expect(applied.annotations.entities[OUT_A].label).toBe('Kept label');
    expect(applied.annotations.entities[OUT_B].label).toBe('Exchange A withdrawal');
    expect(applied.annotations.entities[OUT_C].label).toBe('Exchange A withdrawal');
    const replaced = applyBatchLabel(workspace, [OUT_A, OUT_B], 'Shop payment', true);
    expect(replaced.annotations.entities[OUT_A].label).toBe('Shop payment');
    // Replacing a label never discards other user metadata.
    expect(replaced.annotations.entities[OUT_A].note).toBe('A note');
    expect(replaced.annotations.entities[OUT_A].icon).toBe('★');
    expect(replaced.annotations.entities[OUT_A].bookmarked).toBe(true);
  });

  it('produces one workspace result per batch and no result without a change', () => {
    const workspace = fixture();
    const applied = applyBatchLabel(workspace, [OUT_B, OUT_C], 'Savings');
    expect(applied).not.toBe(workspace);
    expect(applyBatchLabel(applied, [OUT_B, OUT_C], 'Savings')).toBe(applied);
    expect(applyBatchLabel(workspace, [OUT_A], 'Anything')).toBe(workspace);
  });

  it('keeps all 255 characters when applying a label to selected records', () => {
    const label = 'é'.repeat(255);
    const applied = applyBatchLabel(fixture(), [OUT_A, OUT_B], label, true);
    expect(applied.annotations.entities[OUT_A]).toEqual({
      label,
      note: 'A note',
      icon: '★',
      bookmarked: true,
    });
    expect(applied.annotations.entities[OUT_B].label).toBe(label);
  });

  it('scopes edits to supplied identifiers and rejects unusable references', () => {
    const workspace = fixture();
    const applied = applyBatchLabel(workspace, [OUT_B, 'not-a-reference', 'addr:xyz'], 'Scoped');
    expect(Object.keys(applied.annotations.entities).sort()).toEqual([OUT_A, OUT_B].sort());
    // Duplicate and differently cased references collapse to one target.
    const plan = planBatchLabel(workspace, [OUT_B, OUT_B, OUT_B.toUpperCase()]);
    expect(plan.ids).toEqual([OUT_B]);
  });

  it('keeps forgiving references and metadata length limits at the shared mutation boundary', () => {
    const workspace = fixture();
    const invalid = [
      'invalid',
      `addr:${bitcoinAddress.toBech32(new Uint8Array(20).fill(3), 0, 'tb')}`,
    ];
    const labeled = applyBatchLabel(workspace, [...invalid, OUT_B], 'L'.repeat(256));
    expect(labeled.annotations.entities[OUT_B].label).toHaveLength(255);
    const icons = applyBatchIcon(labeled, [...invalid, OUT_A, OUT_B], 'I'.repeat(21));
    expect(icons.annotations.entities[OUT_A]).toEqual(workspace.annotations.entities[OUT_A]);
    expect(icons.annotations.entities[OUT_B].icon).toHaveLength(20);
    expect(Object.keys(icons.annotations.entities).sort()).toEqual([OUT_A, OUT_B].sort());
    expect(applyBatchIcon(icons, invalid, 'ignored')).toBe(icons);
  });

  it('sets icons only where unset unless replacement is explicit', () => {
    const workspace = fixture();
    expect(planBatchIcon(workspace, [OUT_A, OUT_B]).targets).toEqual([OUT_B]);
    const applied = applyBatchIcon(workspace, [OUT_A, OUT_B], '🛒');
    expect(applied.annotations.entities[OUT_A].icon).toBe('★');
    expect(applied.annotations.entities[OUT_B].icon).toBe('🛒');
    expect(applyBatchIcon(workspace, [OUT_A], '🛒', true).annotations.entities[OUT_A].icon).toBe(
      '🛒',
    );
    expect(applyBatchIcon(workspace, [OUT_A], '', true).annotations.entities[OUT_A].icon).toBe('');
  });
});

describe('batch tag edits', () => {
  it('adds and removes membership for the exact selected records', () => {
    const base = createBatchTag(fixture(), { name: 'Exchange A', color: '#65cbbb' }, [
      OUT_A,
      OUT_B,
    ]);
    expect(base.annotations.tags).toHaveLength(1);
    expect(base.annotations.tags![0].nodeIds).toEqual([OUT_A, OUT_B]);
    const tagId = base.annotations.tags![0].id;
    expect(planBatchTag(base, [OUT_A, OUT_C], tagId, true).targets).toEqual([OUT_C]);
    const added = applyBatchTag(base, [OUT_A, OUT_C], tagId, true);
    expect(added.annotations.tags![0].nodeIds).toEqual([OUT_A, OUT_B, OUT_C]);
    const removed = applyBatchTag(added, [OUT_A], tagId, false);
    expect(removed.annotations.tags![0].nodeIds).toEqual([OUT_B, OUT_C]);
    expect(applyBatchTag(removed, [OUT_A], tagId, false)).toBe(removed);
  });

  it('reuses an existing tag name instead of creating a duplicate', () => {
    const base = createBatchTag(fixture(), { name: 'Exchange A', color: '#65cbbb' }, [OUT_A]);
    const again = createBatchTag(base, { name: 'exchange a', color: '#e4af67' }, [OUT_B]);
    expect(again.annotations.tags).toHaveLength(1);
    expect(again.annotations.tags![0].nodeIds).toEqual([OUT_A, OUT_B]);
    expect(again.annotations.tags![0].color).toBe('#65cbbb');
  });

  it('keeps descriptions on creation and preserves existing tag metadata when reusing a name', () => {
    const tagged = createBatchTag(
      fixture(),
      { name: ' Merchant ', color: '#65cbbb', description: ' Reviewed evidence ' },
      ['invalid', OUT_A],
    );
    expect(tagged.annotations.tags![0]).toMatchObject({
      name: 'Merchant',
      description: 'Reviewed evidence',
      nodeIds: [OUT_A],
    });
    const reused = createBatchTag(
      tagged,
      { name: 'merchant', color: '#e4af67', description: 'Replacement' },
      [OUT_B, 'invalid'],
    );
    expect(reused.annotations.tags![0]).toEqual({
      ...tagged.annotations.tags![0],
      nodeIds: [OUT_A, OUT_B],
    });
  });

  it('refuses to edit a tag that no longer exists', () => {
    expect(() => applyBatchTag(fixture(), [OUT_A], 'missing', true)).toThrow(/no longer exists/);
  });
});

describe('Unicode text limits', () => {
  it('keeps complete supplementary characters within the UTF-16 budget', () => {
    expect(clampAnnotationText(`abc😀`, 4)).toBe('abc');
    expect(clampAnnotationText(`abc😀`, 5)).toBe('abc😀');
    expect(clampAnnotationText('😀x', 0)).toBe('');
    expect(clampAnnotationText('plain', 4)).toBe('plai');
  });

  it('clamps native labels, Notes and icons without splitting a surrogate pair', () => {
    const base = createWorkspace('Unicode fixture', 'mainnet');
    const label = `${'L'.repeat(254)}😀`;
    const native = applyNativeLabel(base, [TX], label);
    expect(native.annotations.entities[TX].label).toBe('L'.repeat(254));
    const batch = applyBatchLabel(base, [TX], label);
    expect(batch.annotations.entities[TX].label).toBe(native.annotations.entities[TX].label);
    expect(applyBatchLabel(base, [TX], `${'L'.repeat(253)}😀`).annotations.entities[TX].label).toBe(
      `${'L'.repeat(253)}😀`,
    );
    const noted = applyEntityNote(base, TX, `${'N'.repeat(9_999)}😀`);
    expect(noted.annotations.entities[TX].note).toBe('N'.repeat(9_999));
    expect(applyEntityNote(base, TX, `${'N'.repeat(9_998)}😀`).annotations.entities[TX].note).toBe(
      `${'N'.repeat(9_998)}😀`,
    );
    expect(applyBatchIcon(base, [TX], `${'I'.repeat(19)}😀`).annotations.entities[TX].icon).toBe(
      'I'.repeat(19),
    );
  });

  it('clamps tag names at both mutation entry points without splitting a surrogate pair', () => {
    const base = createWorkspace('Unicode fixture', 'mainnet');
    const value = { name: `${'T'.repeat(99)}😀`, color: '#65cbbb' };
    expect(createNativeTag(base, [TX], value).annotations.tags![0].name).toBe('T'.repeat(99));
    expect(createBatchTag(base, value, [TX]).annotations.tags![0].name).toBe('T'.repeat(99));
    expect(
      createBatchTag(base, { ...value, name: `${'T'.repeat(98)}😀` }, [TX]).annotations.tags![0]
        .name,
    ).toBe(`${'T'.repeat(98)}😀`);
  });

  it('exports clamped native text into records accepted by BIP329 inspection', () => {
    const base = createWorkspace('Unicode fixture', 'mainnet');
    const cases = [
      {
        workspace: applyBatchLabel(base, [TX], `${'L'.repeat(254)}😀`),
        options: defaultLabelExportOptions(),
        expected: 'L'.repeat(254),
      },
      {
        workspace: applyEntityNote(base, TX, `${'N'.repeat(9_999)}😀`),
        options: { ...defaultLabelExportOptions(), profile: 'bluewallet' as const },
        expected: 'N'.repeat(9_999),
      },
      {
        workspace: createBatchTag(base, { name: `${'T'.repeat(99)}😀`, color: '#65cbbb' }, [TX]),
        options: { ...defaultLabelExportOptions(), includeTagsInLabels: true },
        expected: `[${'T'.repeat(99)}]`,
      },
    ];
    for (const { workspace, options, expected } of cases) {
      const exported = planLabelExport(workspace, options);
      expect(exported.recordCount).toBe(1);
      const inspected = inspectLabels(exported.content, workspace.network);
      expect(inspected.issues).toEqual([]);
      expect(inspected.records.map((record) => record.label)).toEqual([expected]);
    }
  });
});
