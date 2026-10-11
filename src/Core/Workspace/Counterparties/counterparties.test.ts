import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { describe, expect, it } from 'vitest';
import { createWorkspace } from '../createWorkspace';
import {
  canonicalEntityReference,
  outpointReference,
  transactionReference,
} from '../entityReferences';
import { canonicalAnnotationReference, counterpartyReference } from '../annotationReferences';
import { validateWorkspace } from '../workspace';
import {
  applyBatchLabel,
  applyBatchTag,
  applyEntityNote,
  createBatchTag,
} from '../Annotations/batchMetadata';
import { exportLabels } from '../Annotations/labels';
import { planEntityRemoval, removeWorkspaceEntity } from '../entityRemoval';
import {
  assertCounterpartyBudget,
  assignCounterparty,
  createCounterpartyLookup,
  listCounterpartiesForEntity,
  listCounterpartiesForRelationship,
  removeCounterparty,
  removeCounterpartyLink,
  saveCounterparty,
  counterpartySelectionLinks,
  setCounterpartySelection,
  validateCounterparties,
  type WalletTransactionSubject,
} from './counterparties';

const partyId = '10000000-0000-4000-8000-000000000001';
const anotherId = '10000000-0000-4000-8000-000000000002';
const walletId = '20000000-0000-4000-8000-000000000001';
const receiptId = 'a'.repeat(64);
const paymentId = 'b'.repeat(64);
const receipt0 = outpointReference(receiptId, 0);
const receipt1 = outpointReference(receiptId, 1);
const payment0 = outpointReference(paymentId, 0);
const payment1 = outpointReference(paymentId, 1);
const address = bitcoinAddress.toBech32(new Uint8Array(20).fill(2), 0, 'bc');
const receipt: WalletTransactionSubject = {
  kind: 'wallet-transaction',
  walletId,
  transactionId: receiptId,
  direction: 'received',
  walletOutputIds: [receipt0, receipt1],
};
const payment: WalletTransactionSubject = {
  kind: 'wallet-transaction',
  walletId,
  transactionId: paymentId,
  direction: 'sent',
  walletOutputIds: [receipt0],
};

function fixture() {
  const workspace = createWorkspace('Counterparty fixture', 'mainnet');
  workspace.chainData.transactions = {
    [receiptId]: {
      txid: receiptId,
      vin: [{ coinbase: '00' }],
      vout: [0, 1].map((n) => ({ n, value: 1, scriptPubKey: { hex: '51' } })),
    },
    [paymentId]: {
      txid: paymentId,
      vin: [{ txid: receiptId, vout: 0 }],
      vout: [0, 1].map((n) => ({ n, value: 0.4, scriptPubKey: { hex: '51' } })),
    },
  };
  return workspace;
}

describe('human counterparties and scoped relationships', () => {
  it('saves identity and relationship in one immutable edit with metadata owned once', () => {
    const workspace = fixture();
    const before = structuredClone(workspace);
    const named = saveCounterparty(
      workspace,
      { id: partyId, name: 'Exchange A', category: 'Exchange', note: 'User-maintained context' },
      receipt,
    );
    expect(workspace).toEqual(before);
    expect(named.counterparties?.definitions).toEqual([{ id: partyId, category: 'Exchange' }]);
    expect(named.counterparties?.links).toEqual([{ ...receipt, counterpartyId: partyId }]);
    expect(named.annotations.entities[counterpartyReference(partyId)]).toEqual({
      label: 'Exchange A',
      note: 'User-maintained context',
      icon: '',
      bookmarked: false,
    });
    expect(named.annotations.entities[transactionReference(receiptId)]).toBeUndefined();
    expect(named.annotations.entities[receipt0]).toBeUndefined();
    expect(validateWorkspace(named)).toEqual(named);
    expect(
      saveCounterparty(named, { id: partyId, name: 'Exchange A', category: 'Exchange' }, receipt),
    ).toBe(named);
    expect(exportLabels(named)).toBe('');
  });

  it('uses shared metadata editors without letting a party name become blank', () => {
    let workspace = saveCounterparty(fixture(), { id: partyId, name: 'Shop A' });
    const reference = counterpartyReference(partyId);
    workspace = applyBatchLabel(workspace, [reference], 'Shop B', true);
    workspace = applyEntityNote(workspace, reference, 'Useful context');
    workspace = createBatchTag(workspace, { name: 'Shopping', color: '#123456' }, [reference]);
    expect(workspace.annotations.entities[reference]).toMatchObject({
      label: 'Shop B',
      note: 'Useful context',
    });
    expect(validateWorkspace(workspace).annotations.tags?.[0].nodeIds).toEqual([reference]);
    expect(() => applyBatchLabel(workspace, [reference, receipt0], '  ', true)).toThrow(
      'Give the counterparty a name',
    );
    expect(workspace.annotations.entities[receipt0]).toBeUndefined();
    expect(() => canonicalEntityReference(reference, 'mainnet')).toThrow();
    expect(canonicalAnnotationReference(reference, 'mainnet')).toBe(reference);
    expect(
      applyBatchLabel(workspace, [counterpartyReference(anotherId)], 'Unavailable', true),
    ).toBe(workspace);
  });

  it('preserves concrete receipt links across wallet removal/reimport and honors narrower coin scope', () => {
    const linked = saveCounterparty(
      fixture(),
      { id: partyId, name: 'Exchange A' },
      { ...receipt, outputIds: [receipt0] },
    );
    expect(linked.wallets.definitions).toEqual([]);
    const lookup = createCounterpartyLookup(linked);
    expect(
      listCounterpartiesForRelationship(
        linked,
        { transactionId: receiptId, direction: 'received', walletOutputIds: [receipt0] },
        lookup,
      ).map((party) => party.id),
    ).toEqual([partyId]);
    expect(
      listCounterpartiesForRelationship(
        linked,
        { transactionId: receiptId, direction: 'received', walletOutputIds: [receipt1] },
        lookup,
      ),
    ).toEqual([]);
    expect(
      assignCounterparty(linked, partyId, {
        ...receipt,
        walletId: anotherId,
        outputIds: [receipt0],
      }),
    ).toBe(linked);
    expect(
      listCounterpartiesForRelationship(
        linked,
        { transactionId: receiptId, direction: 'sent', walletOutputIds: [receipt0] },
        lookup,
      ),
    ).toEqual([]);
  });

  it('keeps a payment purpose separate from change origin and explicitly named addresses/outputs', () => {
    let workspace = saveCounterparty(
      fixture(),
      { id: partyId, name: 'Friend A' },
      { ...payment, outputIds: [payment0] },
    );
    workspace = assignCounterparty(workspace, partyId, {
      kind: 'entity',
      subjectId: `addr:${address}`,
    });
    const lookup = createCounterpartyLookup(workspace);
    expect(
      lookup.forRelationship({
        transactionId: paymentId,
        direction: 'sent',
        walletOutputIds: [receipt0],
        outputIds: [payment0],
      }),
    ).toHaveLength(1);
    expect(
      lookup.forRelationship({
        transactionId: paymentId,
        direction: 'sent',
        walletOutputIds: [receipt0],
        outputIds: [payment1],
      }),
    ).toEqual([]);
    expect(
      lookup.forRelationship({
        transactionId: paymentId,
        direction: 'received',
        walletOutputIds: [payment1],
      }),
    ).toEqual([]);
    expect(listCounterpartiesForEntity(workspace, `addr:${address}`, lookup)).toHaveLength(1);
    expect(listCounterpartiesForEntity(workspace, payment0, lookup)).toEqual([]);
    const broad = saveCounterparty(fixture(), { id: partyId, name: 'Friend A' }, payment);
    expect(
      listCounterpartiesForRelationship(broad, {
        transactionId: paymentId,
        direction: 'sent',
        walletOutputIds: [receipt0],
        outputIds: [payment0],
      }),
    ).toEqual([]);
  });

  it('canonicalizes new links without mutating existing links or the input during validation', () => {
    let workspace = saveCounterparty(fixture(), { id: partyId, name: 'Exchange A' }, receipt);
    const before = structuredClone(workspace);
    workspace = assignCounterparty(workspace, partyId, payment);
    expect(before.counterparties?.links[0]).toEqual(workspace.counterparties?.links[0]);
    const raw = structuredClone(workspace);
    const original = structuredClone(raw);
    if (raw.counterparties?.links[0].kind === 'wallet-transaction')
      raw.counterparties.links[0].walletOutputIds.reverse();
    const reversed = structuredClone(raw);
    validateCounterparties(raw);
    expect(raw).toEqual(reversed);
    expect(original.counterparties?.links[0]).toEqual(workspace.counterparties?.links[0]);
    expect(removeCounterpartyLink(workspace, partyId, payment).counterparties?.links).toEqual([
      workspace.counterparties?.links[0],
    ]);
  });

  it('rejects malformed, cross-network, dangling, duplicate and incorrectly scoped associations', () => {
    const named = saveCounterparty(fixture(), { id: partyId, name: 'Shop' });
    const wrongNetwork = bitcoinAddress.toBech32(new Uint8Array(20).fill(3), 0, 'tb');
    expect(() =>
      assignCounterparty(named, partyId, { kind: 'entity', subjectId: `addr:${wrongNetwork}` }),
    ).toThrow();
    expect(() =>
      assignCounterparty(named, partyId, {
        kind: 'entity',
        subjectId: transactionReference(receiptId),
      }),
    ).toThrow('address or output');
    expect(() => assignCounterparty(named, anotherId, receipt)).toThrow('no longer part');
    expect(() =>
      assignCounterparty(named, partyId, { ...receipt, walletOutputIds: [payment0] }),
    ).toThrow('Receipt anchors');
    expect(() => assignCounterparty(named, partyId, { ...receipt, outputIds: [payment0] })).toThrow(
      'belong to',
    );
    expect(() =>
      assignCounterparty(named, partyId, { ...payment, walletOutputIds: [receipt1] }),
    ).toThrow('Payment anchors');
    expect(() =>
      assignCounterparty(named, partyId, {
        ...receipt,
        walletOutputIds: [outpointReference(receiptId, 4)],
      }),
    ).toThrow('outside its transaction');
    const linked = assignCounterparty(named, partyId, receipt);
    expect(() =>
      validateWorkspace({
        ...linked,
        counterparties: {
          ...linked.counterparties!,
          links: [...linked.counterparties!.links, ...linked.counterparties!.links],
        },
      }),
    ).toThrow('duplicate counterparty links');
    expect(() =>
      validateWorkspace({
        ...named,
        annotations: {
          entities: {
            [counterpartyReference(partyId)]: { label: '', note: '', icon: '', bookmarked: false },
          },
        },
      }),
    ).toThrow('needs a name');
    expect(() => validateWorkspace({ ...named, counterparties: undefined })).toThrow(
      'existing identity',
    );
    expect(() => assertCounterpartyBudget({ definitions: Array(1_001).fill(null) })).toThrow(
      '1,000 counterparties',
    );
    expect(() =>
      assertCounterpartyBudget({ links: [{ walletOutputIds: Array(50_000).fill(null) }] }),
    ).toThrow('reference limit');
  });

  it('deletes a party only with its own metadata/membership and links while retaining chain observations', () => {
    let workspace = saveCounterparty(fixture(), { id: partyId, name: 'Shop' }, receipt);
    workspace = createBatchTag(workspace, { name: 'Shopping', color: '#123456' }, [
      counterpartyReference(partyId),
      receipt0,
    ]);
    const tagId = workspace.annotations.tags![0].id;
    workspace = applyBatchTag(workspace, [receipt1], tagId, true);
    const before = structuredClone(workspace);
    const removed = removeCounterparty(workspace, partyId);
    expect(removed.counterparties).toEqual({ definitions: [], links: [] });
    expect(removed.annotations.entities[counterpartyReference(partyId)]).toBeUndefined();
    expect(removed.annotations.tags![0].nodeIds).toEqual([receipt0, receipt1]);
    expect(removed.chainData).toBe(workspace.chainData);
    expect(workspace).toEqual(before);
  });

  it('counts affected relationships before chain removal and keeps reusable party identities', () => {
    let workspace = saveCounterparty(fixture(), { id: partyId, name: 'Friend A' }, receipt);
    workspace = assignCounterparty(workspace, partyId, payment);
    workspace = assignCounterparty(workspace, partyId, {
      kind: 'entity',
      subjectId: `addr:${address}`,
    });
    const plan = planEntityRemoval(workspace, transactionReference(receiptId));
    expect(plan).toMatchObject({ counterpartyLinkCount: 2, requiresConfirmation: true });
    const removed = removeWorkspaceEntity(workspace, transactionReference(receiptId));
    expect(removed.counterparties?.definitions).toEqual(workspace.counterparties?.definitions);
    expect(removed.counterparties?.links).toEqual([
      { kind: 'entity', subjectId: `addr:${address}`, counterpartyId: partyId },
    ]);
    expect(removed.annotations.entities[counterpartyReference(partyId)].label).toBe('Friend A');
  });

  it('retains automatic ancestors independently referenced by human counterparty links', () => {
    let workspace = fixture();
    workspace.chainData.contextTransactionIds = [receiptId];
    workspace = saveCounterparty(
      workspace,
      { id: partyId, name: 'Shop' },
      { kind: 'entity', subjectId: receipt1 },
    );
    expect(
      planEntityRemoval(workspace, transactionReference(paymentId))?.removedTransactionIds,
    ).toEqual([paymentId]);
    expect(
      removeWorkspaceEntity(workspace, transactionReference(paymentId)).chainData.transactions[
        receiptId
      ],
    ).toBeDefined();
  });
});

it('edits a checklist choice atomically without changing overlapping anchors or another identity', () => {
  let workspace = saveCounterparty(
    fixture(),
    { id: partyId, name: 'Public sender' },
    { ...receipt, outputIds: [receipt0] },
  );
  workspace = assignCounterparty(workspace, partyId, { ...receipt, outputIds: [receipt1] });
  workspace = assignCounterparty(workspace, partyId, { ...receipt, walletOutputIds: [receipt0] });
  workspace = assignCounterparty(workspace, partyId, {
    kind: 'entity',
    subjectId: `addr:${address}`,
  });
  workspace = saveCounterparty(workspace, { id: anotherId, name: 'Another sender' }, receipt);
  const original = workspace;
  const direct = counterpartySelectionLinks(workspace, receipt).filter(
    (link) => link.counterpartyId === partyId,
  );
  expect(direct).toHaveLength(2);
  const changed = setCounterpartySelection(
    workspace,
    partyId,
    { ...receipt, walletId: '20000000-0000-4000-8000-000000000002' },
    [receipt0],
  );
  expect(changed.counterparties?.links).toEqual([
    ...original.counterparties!.links.filter((link) => !direct.includes(link)),
    {
      ...receipt,
      walletId: '20000000-0000-4000-8000-000000000002',
      outputIds: [receipt0],
      counterpartyId: partyId,
    },
  ]);
  expect(changed.annotations).toBe(original.annotations);
  expect(changed.chainData).toBe(original.chainData);
  const removed = setCounterpartySelection(changed, partyId, receipt, 'none');
  expect(removed.counterparties?.links).toEqual(
    original.counterparties!.links.filter((link) => !direct.includes(link)),
  );
  expect(original.counterparties?.links).toHaveLength(5);
  expect(() => setCounterpartySelection(original, partyId, receipt, [payment0])).toThrow();
  expect(() => setCounterpartySelection(original, partyId, receipt, [])).toThrow();
});
