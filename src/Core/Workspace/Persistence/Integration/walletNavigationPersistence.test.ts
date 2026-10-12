import { expect, it } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import { parseWorkspace } from '../index';
import { decryptWorkspace, encryptWorkspace } from '../Codec/encryptedEnvelope';

it('retains independent Wallet tab positions through encryption and reopening', async () => {
  const workspace = createWorkspace('Public wallet navigation fixture', 'mainnet');
  workspace.view.wallet = {
    first: {
      activeTab: 'addresses',
      tabs: {
        transactions: {
          query: 'income',
          selectedKey: `tx:${'a'.repeat(64)}`,
          scrollTop: 180,
          limit: 80,
        },
        addresses: { addressScope: 'sources', query: 'contact', scrollTop: 90 },
        counterparties: { query: 'supplier', selectedKey: 'party:public' },
        review: { status: 'later', typeIds: ['address-description'], addressBranch: 'change' },
      },
    },
    second: { activeTab: 'utxos', tabs: { utxos: { labelFilter: 'unlabeled', scrollTop: 60 } } },
  };
  const password = 'public navigation fixture password';
  const restored = parseWorkspace(
    await decryptWorkspace(await encryptWorkspace(workspace, password), password),
  );
  expect(restored.view.wallet).toEqual(workspace.view.wallet);
});
