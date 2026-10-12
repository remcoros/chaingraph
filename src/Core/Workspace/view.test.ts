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
  it('stores wallet and Review branch selections independently and accepts older documents', () => {
    const base = { dimensions: 3, sizeBy: 'uniform', glow: false, showAddresses: false };
    const wallet = {
      first: {
        browsing: { tab: 'addresses', addressBranch: 'change' },
        review: { typeIds: ['address-description'], addressBranch: 'receive' },
      },
    };
    expect(viewSchema.parse({ ...base, wallet }).wallet).toEqual(wallet);
    expect(
      viewSchema.parse({ ...base, wallet: { first: { browsing: { tab: 'addresses' } } } }).wallet!
        .first.browsing!.addressBranch,
    ).toBeUndefined();
    expect(
      viewSchema.safeParse({
        ...base,
        wallet: { first: { browsing: { addressBranch: 'invalid' } } },
      }).success,
    ).toBe(false);
  });
  it('keeps ordinary browsing separate from a resumable review position for each wallet', () => {
    const base = { dimensions: 3, sizeBy: 'uniform', glow: false, showAddresses: false };
    const wallet = {
      first: {
        activeTab: 'review',
        browsing: {
          tab: 'transactions',
          query: 'savings',
          selectedKey: 'tx:first',
          scrollTop: 480,
        },
        review: { status: 'open', query: '', selectedKey: 'tx:later', scrollTop: 60 },
      },
      second: { browsing: { tab: 'utxos', query: 'reserved' } },
    };
    expect(viewSchema.parse({ ...base, wallet }).wallet).toEqual(wallet);
    expect(viewSchema.parse(base).wallet).toBeUndefined();
    expect(
      viewSchema.safeParse({ ...base, wallet: { first: { browsing: { tab: 'invalid' } } } })
        .success,
    ).toBe(false);
  });
  it('keeps automatic refresh optional for existing documents and validates persisted choices', () => {
    const base = { dimensions: 3, sizeBy: 'uniform', glow: false, showAddresses: false };
    expect(viewSchema.parse(base).automaticWalletRefresh).toBeUndefined();
    expect(
      viewSchema.parse({ ...base, automaticWalletRefresh: false }).automaticWalletRefresh,
    ).toBe(false);
    expect(viewSchema.safeParse({ ...base, automaticWalletRefresh: 'false' }).success).toBe(false);
  });
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

it('validates the saved refresh interval without requiring it in older workspaces', () => {
  const base = { dimensions: 3, sizeBy: 'uniform', glow: false, showAddresses: false };
  expect(viewSchema.parse(base).walletRefreshIntervalSeconds).toBeUndefined();
  expect(
    viewSchema.parse({ ...base, walletRefreshIntervalSeconds: 120 }).walletRefreshIntervalSeconds,
  ).toBe(120);
  for (const interval of [0, 9, 10.5, 86401, '60'])
    expect(viewSchema.safeParse({ ...base, walletRefreshIntervalSeconds: interval }).success).toBe(
      false,
    );
});
