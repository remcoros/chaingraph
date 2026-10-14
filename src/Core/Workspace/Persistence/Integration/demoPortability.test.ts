import { expect, it } from 'vitest';
import { createTemplateWorkspace } from '../../../../App/Examples/workspaceTemplates';
import { encryptWorkspace, decryptWorkspace } from '../Codec/encryptedEnvelope';
import { parseWorkspace } from '../index';
import { createChainDataAcquisition } from '../../Session/chainDataAcquisition';
import { TransactionFetchScope } from '../../../ChainData/transactionScheduler';

it('carries captured wallet evidence and edits through encrypted export/import without a saved offline restriction', async () => {
  const data = await createTemplateWorkspace('demo-public-wallet');
  const id = Object.keys(data.chainData.transactions)[0];
  data.annotations.entities[`tx:${id}`] = {
    label: 'My public example review',
    note: 'Keep this observation for another installation.',
    icon: '🔗',
    bookmarked: true,
  };
  const password = 'public portability test';
  const imported = parseWorkspace(
    await decryptWorkspace(await encryptWorkspace(data, password), password),
  );
  expect(imported).toEqual(data);
  expect(imported.demo).toBe(false);
  expect(Object.keys(imported.chainData.addressUtxos!)).toHaveLength(20);
  const scope = new TransactionFetchScope(imported.network);
  try {
    const session = { data: imported, fetchScope: scope, locking: false, edit: () => {} };
    const acquisition = createChainDataAcquisition({
      activeWorkspace: imported,
      getUnlocked: () => session,
      fetchScope: scope,
      allowNetwork: false,
    });
    expect(await acquisition.read.transaction(id)).toEqual(imported.chainData.transactions[id]);
  } finally {
    scope.close();
  }
});
