import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import {
  viewSchema,
  parseGraphNodeIds,
  parseHiddenNodeIds,
  validateGraphCamera,
  validateGraphSnapshot,
  type GraphFilters,
  type GraphPanelsState,
} from './view';

describe('saved presentation contract', () => {
  it('keeps saved filter and panel types aligned with their schemas', () => {
    expectTypeOf<
      NonNullable<z.output<typeof viewSchema>['filters']>
    >().toEqualTypeOf<GraphFilters>();
    expectTypeOf<
      NonNullable<z.output<typeof viewSchema>['panels']>
    >().toEqualTypeOf<GraphPanelsState>();
    const parsed = viewSchema.parse({
      dimensions: 3,
      sizeBy: 'uniform',
      glow: false,
      showAddresses: false,
      filters: { excludeIds: ['tx:transient'], walletIds: ['wallet', 'wallet'] },
    });
    expect(parsed.filters).toEqual({ walletIds: ['wallet'] });
  });

  it('canonicalizes document references without changing the supplied array', () => {
    const txid = 'a'.repeat(64);
    const supplied = [`tx:${txid}`, `tx:${txid}`];
    expect(parseGraphNodeIds(supplied, 'mainnet')).toEqual([`tx:${txid}`]);
    expect(parseHiddenNodeIds(supplied, 'mainnet')).toEqual([`tx:${txid}`]);
    expect(supplied).toHaveLength(2);
    expect(() => parseHiddenNodeIds(['addr:not-an-address'], 'mainnet')).toThrow();
  });

  it('shares camera validity between full snapshots and the camera-only fast path', () => {
    const position = { x: 0, y: 0, z: 10 };
    const camera = { position, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } };
    const snapshot = { version: 1, dimensions: 3, camera, nodes: [] };
    expect(validateGraphCamera(camera).success).toBe(true);
    expect(validateGraphSnapshot(snapshot).success).toBe(true);
    const invalid = { ...camera, target: position };
    expect(validateGraphCamera(invalid).success).toBe(false);
    expect(validateGraphSnapshot({ ...snapshot, camera: invalid }).success).toBe(false);
  });
});
