import { describe, expect, it } from 'vitest';
import { selectedWalletFilterIds } from '../../../src/App/Workspace/Workbenches/Graph/Filters/graphFilters';
import { createWorkspace } from '../../../src/App/Workspace/createWorkspace';
import { parseWorkspace } from '../../../src/App/Workspace/Persistence/Format';
import {
  decryptWorkspace,
  encryptWorkspace,
} from '../../../src/App/Workspace/Persistence/Encryption/encryptedEnvelope';

describe('saved graph wallet selections', () => {
  it('retains wallet selection together with the other filter dimensions after encryption', async () => {
    const workspace = createWorkspace('Public wallet filter fixture', 'mainnet');
    workspace.view.filters = {
      walletIds: ['savings', 'spending'],
      walletMatch: 'matched',
      tagState: 'tagged',
      tagId: 'salary',
      minSats: 1000,
      maxSats: 100000,
      focus: { id: 'out:public-fixture:0', hops: 2 },
    };
    const password = 'public fixture password';
    const encrypted = await encryptWorkspace(workspace, password);
    const restored = parseWorkspace(await decryptWorkspace(encrypted, password));
    expect(restored.view.filters).toEqual(workspace.view.filters);
  });

  it.each([
    { filters: { walletId: 'legacy-wallet' }, expected: ['legacy-wallet'] },
    {
      filters: { walletIds: ['savings', 'spending', 'savings'] },
      expected: ['savings', 'spending'],
    },
    { filters: { walletId: 'legacy-wallet', walletIds: [] }, expected: [] },
  ])(
    'restores encrypted selections without discarding the filter: $filters',
    async ({ filters, expected }) => {
      const workspace = createWorkspace('Public wallet filter fixture', 'mainnet');
      workspace.view.filters = filters;
      const password = 'public fixture password';
      const encrypted = await encryptWorkspace(workspace, password);
      const restored = parseWorkspace(await decryptWorkspace(encrypted, password));
      expect(selectedWalletFilterIds(restored.view.filters!)).toEqual(expected);
      if (filters.walletIds) expect(restored.view.filters?.walletIds).toEqual(expected);
      expect(workspace.view.filters).toEqual(filters);
    },
  );

  it('bounds imported selections by the supported wallet count and identifier size', () => {
    const workspace = createWorkspace('Public wallet filter fixture', 'mainnet');
    const parse = (walletIds: unknown) =>
      parseWorkspace({ ...workspace, view: { ...workspace.view, filters: { walletIds } } });
    expect(
      parse(Array.from({ length: 100 }, (_, index) => `wallet-${index}`)).view.filters?.walletIds,
    ).toHaveLength(100);
    for (const invalid of [Array(101).fill('wallet'), ['x'.repeat(201)], [''], [42], 'wallet']) {
      expect(() => parse(invalid)).toThrow();
    }
  });
});
