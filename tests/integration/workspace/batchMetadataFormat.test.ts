import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import {
  applyEntityNote,
  createBatchTag,
} from '../../../src/Core/Workspace/Annotations/batchMetadata';
import { createWorkspace } from '../../../src/Core/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/Core/Workspace/Persistence';
import type { Workspace } from '../../../src/Core/Workspace/workspace';

const id = (n: number) => n.toString(16).padStart(64, '0');
const OUT_A = `out:${id(1)}:0`;
const ADDRESS = bitcoinAddress.toBech32(new Uint8Array(20).fill(3), 0, 'bc');

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

describe('capability results survive workspace format validation', () => {
  it('keeps address membership canonical and workspace-valid', () => {
    const tagged = createBatchTag(fixture(), { name: 'Shop', color: '#9c9aed' }, [
      `addr:${ADDRESS.toUpperCase()}`,
    ]);
    expect(tagged.annotations.tags![0].nodeIds).toEqual([`addr:${ADDRESS}`]);
    expect(parseWorkspace(tagged).annotations.tags![0].name).toBe('Shop');
  });
  it('preserves other metadata and entities, supports clearing and canonical identity', () => {
    const workspace = fixture();
    const result = applyEntityNote(workspace, OUT_A, 'Evidence\nSecond line');
    expect(result.annotations.entities[OUT_A]).toEqual({
      ...workspace.annotations.entities[OUT_A],
      note: 'Evidence\nSecond line',
    });
    expect(workspace.annotations.entities[OUT_A].note).toBe('A note');
    expect(applyEntityNote(result, OUT_A, 'Evidence\nSecond line')).toBe(result);
    expect(applyEntityNote(result, OUT_A, '').annotations.entities[OUT_A].note).toBe('');
    const address = applyEntityNote(result, `addr:${ADDRESS.toUpperCase()}`, 'Address note');
    expect(address.annotations.entities[`addr:${ADDRESS}`].note).toBe('Address note');
    expect(address.annotations.entities[OUT_A]).toEqual(result.annotations.entities[OUT_A]);
    expect(applyEntityNote(result, 'invalid', 'ignored')).toBe(result);
    parseWorkspace(address);
  });
});
