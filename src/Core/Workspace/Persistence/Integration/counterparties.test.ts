import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../../createWorkspace';
import { outpointReference } from '../../entityReferences';
import { counterpartyReference } from '../../annotationReferences';
import { saveCounterparty } from '../../Counterparties/counterparties';
import { decryptAndValidateWorkspace, validateAndEncryptWorkspace } from '../Codec/workspaceCodec';
import { createBrowserWorkspaceStore } from './workspaceStoreFixture';

const partyId = '10000000-0000-4000-8000-000000000001';
const walletId = '20000000-0000-4000-8000-000000000001';
const txid = 'a'.repeat(64);
const password = 'public counterparty fixture';

function fixture() {
  const workspace = createWorkspace('Encrypted parties', 'mainnet');
  workspace.chainData.transactions[txid] = {
    txid,
    vin: [{ coinbase: '00' }],
    vout: [{ n: 0, value: 1, scriptPubKey: { hex: '51' } }],
    status: { kind: 'confirmed', confirmations: 1 },
  };
  return workspace;
}

describe('counterparty metadata at persistence and session boundaries', () => {
  it('round-trips removed-wallet relationships only inside the encrypted document', async () => {
    const workspace = saveCounterparty(
      fixture(),
      { id: partyId, name: 'Friend A', category: 'Friend', note: 'Public fixture context' },
      {
        kind: 'wallet-transaction',
        walletId,
        transactionId: txid,
        direction: 'received',
        walletOutputIds: [outpointReference(txid, 0)],
      },
    );
    const envelope = await validateAndEncryptWorkspace(workspace, password);
    expect(JSON.stringify(envelope)).not.toContain('Friend A');
    const restored = await decryptAndValidateWorkspace(envelope, password);
    expect(restored).toEqual(workspace);
    expect(restored.wallets.definitions).toEqual([]);
  });

  it('undoes identity/link edits without rolling back accepted observations', () => {
    const store = createBrowserWorkspaceStore({
      storage: { getItem: () => null, setItem: () => {} },
    });
    const workspace = fixture();
    store.open(workspace, password);
    const data = () => store.getUnlocked(workspace.id)!.data;
    store.update(workspace.id, (current) =>
      saveCounterparty(
        current,
        { id: partyId, name: 'Friend A' },
        {
          kind: 'wallet-transaction',
          walletId,
          transactionId: txid,
          direction: 'received',
          walletOutputIds: [outpointReference(txid, 0)],
        },
      ),
    );
    store.update(
      workspace.id,
      (current) => ({
        ...current,
        chainData: {
          ...current.chainData,
          transactions: {
            ...current.chainData.transactions,
            [txid]: {
              ...current.chainData.transactions[txid],
              status: { kind: 'confirmed', confirmations: 5 },
            },
          },
        },
      }),
      false,
    );
    store.undo(workspace.id);
    expect(data().counterparties).toBeUndefined();
    expect(data().annotations.entities[counterpartyReference(partyId)]).toBeUndefined();
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(5);
    store.redo(workspace.id);
    expect(data().counterparties?.links).toHaveLength(1);
    expect(data().annotations.entities[counterpartyReference(partyId)].label).toBe('Friend A');
    expect(data().chainData.transactions[txid].status?.confirmations).toBe(5);
  });
});
