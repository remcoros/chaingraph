import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  applyEntityNote,
  applyBatchIcon,
  applyBatchLabel,
  applyBatchTag,
  createBatchTag,
  planBatchIcon,
  planBatchLabel,
  planBatchTag,
} from '../src/Domain/Metadata/batchMetadata';
import { newWorkspace, parseWorkspace } from '../src/Domain/Workspace/workspace';
import type { Workspace } from '../src/Domain/types';

const id = (n: number) => n.toString(16).padStart(64, '0');
const OUT_A = `out:${id(1)}:0`;
const OUT_B = `out:${id(1)}:1`;
const OUT_C = `out:${id(2)}:0`;
const ADDRESS = bitcoinAddress.toBech32(new Uint8Array(20).fill(3), 0, 'bc');

function fixture(): Workspace {
  return {
    ...newWorkspace('Batch fixture', 'mainnet'),
    annotations: {
      [OUT_A]: { label: 'Kept label', note: 'A note', icon: '★', bookmarked: true },
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
    expect(applied.annotations[OUT_A].label).toBe('Kept label');
    expect(applied.annotations[OUT_B].label).toBe('Exchange A withdrawal');
    expect(applied.annotations[OUT_C].label).toBe('Exchange A withdrawal');
    const replaced = applyBatchLabel(workspace, [OUT_A, OUT_B], 'Shop payment', true);
    expect(replaced.annotations[OUT_A].label).toBe('Shop payment');
    // Replacing a label never discards other user metadata.
    expect(replaced.annotations[OUT_A].note).toBe('A note');
    expect(replaced.annotations[OUT_A].icon).toBe('★');
    expect(replaced.annotations[OUT_A].bookmarked).toBe(true);
  });

  it('produces one workspace result per batch and no result without a change', () => {
    const workspace = fixture();
    const applied = applyBatchLabel(workspace, [OUT_B, OUT_C], 'Savings');
    expect(applied).not.toBe(workspace);
    expect(applyBatchLabel(applied, [OUT_B, OUT_C], 'Savings')).toBe(applied);
    expect(applyBatchLabel(workspace, [OUT_A], 'Anything')).toBe(workspace);
  });

  it('scopes edits to supplied identifiers and rejects unusable references', () => {
    const workspace = fixture();
    const applied = applyBatchLabel(workspace, [OUT_B, 'not-a-reference', 'addr:xyz'], 'Scoped');
    expect(Object.keys(applied.annotations).sort()).toEqual([OUT_A, OUT_B].sort());
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
    const labeled = applyBatchLabel(workspace, [...invalid, OUT_B], 'L'.repeat(201));
    expect(labeled.annotations[OUT_B].label).toHaveLength(200);
    const icons = applyBatchIcon(labeled, [...invalid, OUT_A, OUT_B], 'I'.repeat(21));
    expect(icons.annotations[OUT_A]).toEqual(workspace.annotations[OUT_A]);
    expect(icons.annotations[OUT_B].icon).toHaveLength(20);
    expect(Object.keys(icons.annotations).sort()).toEqual([OUT_A, OUT_B].sort());
    expect(applyBatchIcon(icons, invalid, 'ignored')).toBe(icons);
  });

  it('sets icons only where unset unless replacement is explicit', () => {
    const workspace = fixture();
    expect(planBatchIcon(workspace, [OUT_A, OUT_B]).targets).toEqual([OUT_B]);
    const applied = applyBatchIcon(workspace, [OUT_A, OUT_B], '🛒');
    expect(applied.annotations[OUT_A].icon).toBe('★');
    expect(applied.annotations[OUT_B].icon).toBe('🛒');
    expect(applyBatchIcon(workspace, [OUT_A], '🛒', true).annotations[OUT_A].icon).toBe('🛒');
    expect(applyBatchIcon(workspace, [OUT_A], '', true).annotations[OUT_A].icon).toBe('');
  });
});

describe('batch tag edits', () => {
  it('adds and removes membership for the exact selected records', () => {
    const base = createBatchTag(fixture(), { name: 'Exchange A', color: '#65cbbb' }, [
      OUT_A,
      OUT_B,
    ]);
    expect(base.tags).toHaveLength(1);
    expect(base.tags![0].nodeIds).toEqual([OUT_A, OUT_B]);
    const tagId = base.tags![0].id;
    expect(planBatchTag(base, [OUT_A, OUT_C], tagId, true).targets).toEqual([OUT_C]);
    const added = applyBatchTag(base, [OUT_A, OUT_C], tagId, true);
    expect(added.tags![0].nodeIds).toEqual([OUT_A, OUT_B, OUT_C]);
    const removed = applyBatchTag(added, [OUT_A], tagId, false);
    expect(removed.tags![0].nodeIds).toEqual([OUT_B, OUT_C]);
    expect(applyBatchTag(removed, [OUT_A], tagId, false)).toBe(removed);
  });

  it('reuses an existing tag name instead of creating a duplicate', () => {
    const base = createBatchTag(fixture(), { name: 'Exchange A', color: '#65cbbb' }, [OUT_A]);
    const again = createBatchTag(base, { name: 'exchange a', color: '#e4af67' }, [OUT_B]);
    expect(again.tags).toHaveLength(1);
    expect(again.tags![0].nodeIds).toEqual([OUT_A, OUT_B]);
    expect(again.tags![0].color).toBe('#65cbbb');
  });

  it('keeps address membership canonical and workspace-valid', () => {
    const tagged = createBatchTag(fixture(), { name: 'Shop', color: '#9c9aed' }, [
      `addr:${ADDRESS.toUpperCase()}`,
    ]);
    expect(tagged.tags![0].nodeIds).toEqual([`addr:${ADDRESS}`]);
    expect(parseWorkspace(tagged, false).tags![0].name).toBe('Shop');
  });

  it('keeps descriptions on creation and preserves existing tag metadata when reusing a name', () => {
    const tagged = createBatchTag(
      fixture(),
      { name: ' Merchant ', color: '#65cbbb', description: ' Reviewed evidence ' },
      ['invalid', OUT_A],
    );
    expect(tagged.tags![0]).toMatchObject({
      name: 'Merchant',
      description: 'Reviewed evidence',
      nodeIds: [OUT_A],
    });
    const reused = createBatchTag(
      tagged,
      { name: 'merchant', color: '#e4af67', description: 'Replacement' },
      [OUT_B, 'invalid'],
    );
    expect(reused.tags![0]).toEqual({ ...tagged.tags![0], nodeIds: [OUT_A, OUT_B] });
  });

  it('refuses to edit a tag that no longer exists', () => {
    expect(() => applyBatchTag(fixture(), [OUT_A], 'missing', true)).toThrow(/no longer exists/);
  });
});

describe('single entity notes', () => {
  it('preserves other metadata and entities, supports clearing and canonical identity', () => {
    const workspace = fixture();
    const result = applyEntityNote(workspace, OUT_A, 'Evidence\nSecond line');
    expect(result.annotations[OUT_A]).toEqual({
      ...workspace.annotations[OUT_A],
      note: 'Evidence\nSecond line',
    });
    expect(workspace.annotations[OUT_A].note).toBe('A note');
    expect(applyEntityNote(result, OUT_A, 'Evidence\nSecond line')).toBe(result);
    expect(applyEntityNote(result, OUT_A, '').annotations[OUT_A].note).toBe('');
    const address = applyEntityNote(result, `addr:${ADDRESS.toUpperCase()}`, 'Address note');
    expect(address.annotations[`addr:${ADDRESS}`].note).toBe('Address note');
    expect(address.annotations[OUT_A]).toEqual(result.annotations[OUT_A]);
    expect(applyEntityNote(result, 'invalid', 'ignored')).toBe(result);
    parseWorkspace(address);
  });
});
