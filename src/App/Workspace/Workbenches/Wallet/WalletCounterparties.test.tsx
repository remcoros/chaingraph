// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CounterpartyPicker,
  WalletCounterpartyDetail,
  WalletCounterpartyList,
  WalletCounterpartyContext,
  walletRowCounterparties,
} from './WalletCounterparties';
import { createWorkspace } from '../../../../Core/Workspace/createWorkspace';
import {
  assignCounterparty,
  removeCounterpartyLink,
  saveCounterparty,
  setCounterpartySelection,
} from '../../../../Core/Workspace/Counterparties/counterparties';
import { counterpartyReference } from '../../../../Core/Workspace/annotationReferences';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type { WalletRow } from './walletRows';
import { deriveAddresses } from '../../../../Core/Workspace/Wallets/walletDerivation';
import { indexPreviousOutputs } from '../../../../Core/ChainData';
import {
  CHANGE_ADDRESS,
  PUBLIC_ZPUB,
  RECEIVE_ADDRESS,
  SECOND_ADDRESS,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
} from '../../../../../tests/fixtures/bitcoin';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const partyId = '22222222-2222-4222-8222-222222222222';
const walletId = '11111111-1111-4111-8111-111111111111';
const oldWalletId = '33333333-3333-4333-8333-333333333333';
const reference = counterpartyReference(partyId);
function fixture() {
  let workspace = createWorkspace('Public counterparty fixture', 'mainnet');
  const wallet = {
    id: walletId,
    name: 'Public wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh' as const,
    color: '#27c4a7',
    addresses: [],
  };
  workspace.wallets.definitions = [wallet];
  workspace.chainData.transactions = structuredClone(transactions);
  workspace = saveCounterparty(
    workspace,
    { id: partyId, name: 'Public shop', category: 'Shop', note: 'Public receipt note' },
    {
      kind: 'wallet-transaction',
      walletId: oldWalletId,
      transactionId: TX_FUNDING,
      direction: 'received',
      walletOutputIds: [`out:${TX_FUNDING}:0`],
    },
  );
  workspace.annotations.entities[reference] = {
    ...workspace.annotations.entities[reference],
    icon: '🛍️',
    bookmarked: true,
  };
  workspace.annotations.tags = [
    {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Public tag',
      color: '#27c4a7',
      nodeIds: [reference],
    },
  ];
  workspace = assignCounterparty(workspace, partyId, {
    kind: 'wallet-transaction',
    walletId: oldWalletId,
    transactionId: TX_SPENDING,
    direction: 'sent',
    walletOutputIds: [`out:${TX_FUNDING}:0`],
  });
  const activityRows: WalletRow[] = [
    {
      key: `tx:${TX_FUNDING}`,
      nodeId: `tx:${TX_FUNDING}`,
      txid: TX_FUNDING,
      identifier: TX_FUNDING,
      title: 'Transaction',
      description: '',
      kind: 'transaction',
      meta: '',
      contextTransactionIds: [TX_FUNDING],
      status: 'open',
      changed: false,
      reviews: [
        {
          kind: 'annotation-goal',
          goal: 'counterparty-context',
          key: 'fixture',
          nodeId: `tx:${TX_FUNDING}`,
          scope: 'transactions',
          reason: 'counterparty',
          title: 'Receipt context',
          detail: 'Public receipt context',
          subjectIds: [`out:${TX_FUNDING}:0`],
          nodeIds: [`tx:${TX_FUNDING}`],
          label: '',
          tags: [],
          status: 'resolved',
          satisfied: true,
          changed: false,
          evidence: 'fixture',
          contextSubjects: [reference],
        },
      ],
    },
  ];
  const props: ComponentProps<typeof WalletCounterpartyDetail> = {
    workspace,
    partyId,
    active: true,
    busy: false,
    activityRows,
    onChange: vi.fn(),
    onOpenRecord: vi.fn(),
    onShowInGraph: vi.fn(),
    onShowRelatedTransactions: vi.fn(),
    onRemoved: vi.fn(),
  };
  return { workspace, wallet, props };
}

function contextFixture(direction: 'received' | 'sent' = 'received') {
  const { workspace, wallet, props } = fixture();
  const derivedWallet = {
    ...wallet,
    addresses: deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1),
  };
  workspace.wallets.definitions = [derivedWallet];
  const txid = direction === 'received' ? TX_FUNDING : TX_SPENDING;
  const row: WalletRow = {
    ...props.activityRows[0],
    key: `tx:${txid}`,
    nodeId: `tx:${txid}`,
    txid,
    contextTransactionIds: [txid],
    walletTransaction: { txid, direction, mempool: false, missingInputCount: 0 },
    reviews: props.activityRows[0].reviews.map((item) => ({
      ...item,
      nodeId: `tx:${txid}`,
      nodeIds: [`tx:${txid}`],
      txid,
      relationshipKinds: [direction === 'received' ? 'source' : 'destination'],
    })),
  };
  const contextProps: ComponentProps<typeof WalletCounterpartyContext> = {
    workspace,
    wallet: derivedWallet,
    row,
    active: true,
    busy: false,
    onChange: vi.fn(),
    onNotice: vi.fn(),
    onOpenRecord: vi.fn(),
    prepared: {
      prevouts: indexPreviousOutputs({
        network: workspace.network,
        transactions: workspace.chainData.transactions,
      }),
      scripthashes: new Set(derivedWallet.addresses.map((address) => address.scripthash)),
    },
  };
  return contextProps;
}

function contextElements(props: ComponentProps<typeof WalletCounterpartyContext>) {
  return createElement('dl', null, createElement(WalletCounterpartyContext, props));
}

it('shows a saved recipient and its output scope beside the matching editor', () => {
  const props = contextFixture('sent');
  props.workspace = setCounterpartySelection(
    props.workspace,
    partyId,
    {
      kind: 'wallet-transaction',
      walletId,
      transactionId: TX_SPENDING,
      direction: 'sent',
      walletOutputIds: [`out:${TX_FUNDING}:0`],
    },
    [`out:${TX_SPENDING}:0`],
  );
  render(createElement(WalletCounterpartyContext, props));
  expect(screen.getByText('Public shop')).toBeDefined();
  expect(screen.getByText('Output 0')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: / recipients$/i }));
  const dialog = screen.getByRole('dialog', { name: 'Recipients' });
  expect(
    within(dialog).getByRole('checkbox', { name: 'Public shop' }).getAttribute('aria-checked'),
  ).toBe('true');
  expect(
    within(dialog).getByRole('button', { name: 'Edit outputs for Public shop' }).textContent,
  ).toContain('1 output');
});

it('shows an inherited output association and edits that source without changing other links', () => {
  const props = contextFixture();
  const sourceId = `out:${TX_FUNDING}:0`;
  props.workspace = {
    ...props.workspace,
    counterparties: {
      ...props.workspace.counterparties!,
      links: props.workspace.counterparties!.links.filter(
        (link) => link.kind === 'wallet-transaction' && link.direction === 'sent',
      ),
    },
  };
  props.workspace = assignCounterparty(props.workspace, partyId, {
    kind: 'entity',
    subjectId: sourceId,
  });
  props.row = {
    ...props.row,
    reviews: props.row.reviews.map((item) => ({ ...item, contextSubjects: [sourceId, reference] })),
  };
  const before = props.workspace;
  let current = before;
  props.onChange = (update) => {
    current = update(current);
  };
  render(createElement(WalletCounterpartyContext, props));
  expect(screen.getByText('Public shop')).toBeDefined();
  expect(screen.getByText('Output')).toBeDefined();
  expect(screen.queryByRole('button', { name: / senders$/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: / association$/i }));
  const dialog = screen.getByRole('dialog', { name: 'Counterparties' });
  const choice = within(dialog).getByRole('checkbox', { name: 'Public shop' });
  expect(choice.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(choice);
  expect(current.counterparties?.links).toEqual(
    before.counterparties?.links.filter((link) => link.kind !== 'entity'),
  );
  expect(current.annotations).toBe(before.annotations);
  expect(current.chainData).toBe(before.chainData);
});

it('keeps the counterparty list visible and selection independent of detail navigation', () => {
  const { workspace } = fixture();
  const onSelect = vi.fn();
  render(
    createElement(WalletCounterpartyList, {
      workspace,
      active: true,
      busy: false,
      onChange: vi.fn(),
      query: '',
      onQueryChange: vi.fn(),
      onSelect,
      selectedId: partyId,
    }),
  );
  const party = screen.getByRole('link', { name: 'Public shop · Shop' });
  expect(party.getAttribute('aria-current')).toBe('true');
  fireEvent.click(party);
  expect(onSelect).toHaveBeenCalledWith(partyId);
  expect(screen.getByRole('searchbox', { name: 'Find counterparties' })).toBeDefined();
  expect(
    screen.queryByRole('button', { name: /Funding addresses|Destination addresses/ }),
  ).toBeNull();
});

it('opens transaction context in the panel and changes the main list only by explicit action', () => {
  const { props } = fixture();
  render(createElement(WalletCounterpartyDetail, props));
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Related wallet activity' })).getByRole('link', {
      name: TX_FUNDING,
    }),
  );
  expect(props.onOpenRecord).toHaveBeenCalledWith(`tx:${TX_FUNDING}`);
  expect(props.onShowRelatedTransactions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Show related transactions' }));
  expect(props.onShowRelatedTransactions).toHaveBeenCalledWith([TX_FUNDING]);
  expect(screen.queryByRole('button', { name: /Back to counterparties/ })).toBeNull();
});

it('uses only explicit and scoped output addresses, with no allocation from a broad payment', () => {
  const { props } = fixture();
  const { rerender } = render(createElement(WalletCounterpartyDetail, props));
  const disclosure = screen.getByText('Addresses (1)').closest('details')!;
  expect(disclosure.open).toBe(false);
  fireEvent.click(screen.getByText('Addresses (1)'));
  const context = screen.getByRole('region', { name: 'Contextual address evidence' });
  expect(within(context).getByRole('link', { name: RECEIVE_ADDRESS })).toBeDefined();
  expect(within(context).queryByRole('link', { name: CHANGE_ADDRESS })).toBeNull();
  expect(within(context).queryByRole('link', { name: SECOND_ADDRESS })).toBeNull();
  expect(within(context).getByText('Received output')).toBeDefined();
  let workspace = assignCounterparty(props.workspace, partyId, {
    kind: 'entity',
    subjectId: `addr:${SECOND_ADDRESS}`,
  });
  workspace = assignCounterparty(workspace, partyId, {
    kind: 'wallet-transaction',
    walletId,
    transactionId: TX_SPENDING,
    direction: 'sent',
    walletOutputIds: [`out:${TX_FUNDING}:0`],
    outputIds: [`out:${TX_SPENDING}:1`],
  });
  rerender(createElement(WalletCounterpartyDetail, { ...props, workspace }));
  fireEvent.click(within(context).getByRole('link', { name: CHANGE_ADDRESS }));
  expect(props.onOpenRecord).toHaveBeenCalledWith(`addr:${CHANGE_ADDRESS}`);
  expect(within(context).getByText('Sent output')).toBeDefined();
  expect(within(context).getByText('Explicit address association')).toBeDefined();
});

it('removes exactly the selected saved relationship and retains cross-wallet identity metadata', () => {
  const { props } = fixture();
  let current = props.workspace;
  props.onChange = (update: (workspace: Workspace) => Workspace) => {
    current = update(current);
  };
  render(createElement(WalletCounterpartyDetail, props));
  fireEvent.click(screen.getByText('Linked records (2)'));
  const receiptLink = screen.getByText('Received').closest('.wallet-party-link') as HTMLElement;
  fireEvent.click(within(receiptLink).getByRole('button', { name: 'Remove association' }));
  expect(current.counterparties?.links).toHaveLength(1);
  expect(current.counterparties?.links[0]).toMatchObject({
    kind: 'wallet-transaction',
    direction: 'sent',
    walletId: oldWalletId,
  });
  expect(current.annotations.entities[reference]).toEqual(
    props.workspace.annotations.entities[reference],
  );
  expect(current.annotations.tags).toEqual(props.workspace.annotations.tags);
  expect(screen.getByText('Public receipt note')).toBeDefined();
  expect(screen.getByText('Public tag')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Counterparty actions' }));
  expect(
    screen.getByRole('menuitemcheckbox', { name: 'Bookmark' }).getAttribute('aria-checked'),
  ).toBe('true');
});

it('requires the existing confirmation before deleting a counterparty and its associations', () => {
  const { props } = fixture();
  render(createElement(WalletCounterpartyDetail, props));
  fireEvent.click(screen.getByRole('button', { name: 'Counterparty actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove counterparty' }));
  expect(props.onChange).not.toHaveBeenCalled();
  expect(screen.getByText('Remove Public shop and its associations?')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Remove counterparty' }));
  expect(props.onChange).toHaveBeenCalledOnce();
  expect(props.onRemoved).toHaveBeenCalledOnce();
});

it('notifies row edit lifecycle when the shared picker opens and closes', () => {
  const { workspace } = fixture();
  const onOpenChange = vi.fn();
  render(
    createElement(CounterpartyPicker, {
      workspace,
      onChange: vi.fn(),
      onNotice: vi.fn(),
      onOpenChange,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
});

it('keeps the checklist open after creating and assigning a named party in one edit', () => {
  const { workspace } = fixture();
  const onOpenChange = vi.fn(),
    onChange = vi.fn();
  render(
    createElement(CounterpartyPicker, {
      workspace,
      subject: { kind: 'entity', subjectId: `out:${TX_FUNDING}:1` },
      onChange,
      onNotice: vi.fn(),
      onOpenChange,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search counterparties' }), {
    target: { value: 'Public friend' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create “Public friend”' }));
  expect(onChange).toHaveBeenCalledOnce();
  const next = onChange.mock.calls[0][0](workspace) as Workspace;
  const added = next.counterparties?.definitions.find(
    (party) => next.annotations.entities[counterpartyReference(party.id)].label === 'Public friend',
  );
  expect(added).toBeDefined();
  expect(next.counterparties?.links).toContainEqual({
    counterpartyId: added?.id,
    kind: 'entity',
    subjectId: `out:${TX_FUNDING}:1`,
  });
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('dialog', { name: 'Counterparties' })).toBeDefined();
});

it('keeps name, notes, tags, icon and exact association scopes when editing category or bookmark', () => {
  const { props } = fixture();
  let current = props.workspace;
  props.onChange = (update: (workspace: Workspace) => Workspace) => {
    current = update(current);
  };
  render(createElement(WalletCounterpartyDetail, props));
  fireEvent.click(screen.getByRole('button', { name: / category$/i }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Category' }), {
    target: { value: 'Friend' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
  expect(current.counterparties?.definitions[0].category).toBe('Friend');
  expect(current.counterparties?.links).toEqual(props.workspace.counterparties?.links);
  expect(current.annotations.entities[reference]).toEqual(
    props.workspace.annotations.entities[reference],
  );
  fireEvent.click(screen.getByRole('button', { name: 'Counterparty actions' }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bookmark' }));
  expect(current.annotations.entities[reference]).toEqual({
    ...props.workspace.annotations.entities[reference],
    bookmarked: false,
  });
  expect(current.annotations.tags).toEqual(props.workspace.annotations.tags);
});

it('resets pending category and removal confirmation when opening a different identity', () => {
  const { props } = fixture();
  const secondPartyId = '55555555-5555-4555-8555-555555555555';
  const workspace = saveCounterparty(props.workspace, {
    id: secondPartyId,
    name: 'Another public shop',
    category: 'Exchange',
  });
  const { rerender } = render(createElement(WalletCounterpartyDetail, { ...props, workspace }));
  fireEvent.click(screen.getByRole('button', { name: / category$/i }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Category' }), {
    target: { value: 'Draft' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Counterparty actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove counterparty' }));
  rerender(
    createElement(WalletCounterpartyDetail, { ...props, workspace, partyId: secondPartyId }),
  );
  expect(screen.queryByRole('textbox', { name: 'Category' })).toBeNull();
  expect(
    within(screen.getByRole('region', { name: 'Category field' })).getByText('Exchange'),
  ).toBeDefined();
  expect(screen.queryByText('Remove Public shop and its associations?')).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
});

it.each(['received', 'sent'] as const)(
  'keeps %s identity navigation and exact editing together in the field',
  (direction) => {
    const props = contextFixture(direction);
    render(contextElements(props));
    const values = screen.getByRole('region', { name: 'Counterparties' });
    const party = within(values).getByRole('link', { name: 'Public shop' });
    expect(party.getAttribute('href')).toBe('#wallet-record-detail');
    fireEvent.click(party);
    expect(props.onOpenRecord).toHaveBeenCalledWith(reference);
    fireEvent.click(
      within(values).getByRole('button', {
        name: direction === 'received' ? / senders$/i : / recipients$/i,
      }),
    );
    expect(
      screen.getByRole('dialog', { name: direction === 'received' ? 'Senders' : 'Recipients' }),
    ).toBeDefined();
  },
);

it('opens a sender checklist from an empty field', () => {
  const props = contextFixture();
  props.workspace.counterparties = { ...props.workspace.counterparties!, links: [] };
  render(contextElements(props));
  fireEvent.click(screen.getByRole('button', { name: / senders$/i }));
  expect(screen.getByRole('dialog', { name: 'Senders' })).toBeDefined();
  expect(screen.getByRole('checkbox', { name: 'Public shop' }).getAttribute('aria-checked')).toBe(
    'false',
  );
});

it('changes output scope inline while preserving other identities and records', () => {
  const props = contextFixture();
  const donorId = '55555555-5555-4555-8555-555555555555';
  props.workspace = saveCounterparty(
    props.workspace,
    { id: donorId, name: 'Public donor' },
    {
      kind: 'wallet-transaction',
      walletId,
      transactionId: TX_FUNDING,
      direction: 'received',
      walletOutputIds: [`out:${TX_FUNDING}:0`],
    },
  );
  const before = props.workspace;
  let current = before;
  props.onChange = (update) => {
    current = update(current);
  };
  render(contextElements(props));
  fireEvent.click(screen.getAllByRole('button', { name: / senders$/i })[0]);
  const shop = screen
    .getByRole('checkbox', { name: 'Public shop' })
    .closest('.wallet-party-choice') as HTMLElement;
  fireEvent.click(within(shop).getByRole('button', { name: 'Edit outputs for Public shop' }));
  expect(
    (within(shop).getByRole('radio', { name: 'Incoming transaction' }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(within(shop).getByRole('checkbox', { name: /^Output 0$/ })).toBeDefined();
  expect(
    within(shop).getByTitle(
      props.workspace.chainData.transactions[TX_FUNDING].vout[0].scriptPubKey.address!,
    ),
  ).toBeDefined();
  fireEvent.click(within(shop).getByRole('radio', { name: 'Selected outputs' }));
  expect((within(shop).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(within(shop).getByRole('checkbox', { name: /Output 0/ }));
  fireEvent.click(within(shop).getByRole('button', { name: 'Apply' }));
  expect(
    current.counterparties?.links.filter(
      (link) =>
        link.counterpartyId === partyId &&
        link.kind === 'wallet-transaction' &&
        link.direction === 'received',
    ),
  ).toEqual([
    {
      kind: 'wallet-transaction',
      counterpartyId: partyId,
      walletId,
      transactionId: TX_FUNDING,
      direction: 'received',
      walletOutputIds: [`out:${TX_FUNDING}:0`],
      outputIds: [`out:${TX_FUNDING}:0`],
    },
  ]);
  expect(current.counterparties?.links.filter((link) => link.counterpartyId === donorId)).toEqual(
    before.counterparties?.links.filter((link) => link.counterpartyId === donorId),
  );
  expect(current.annotations).toBe(before.annotations);
  expect(screen.getByRole('dialog', { name: 'Senders' })).toBeDefined();
});

it('toggles multiple senders without closing and preserves existing narrow scopes when adding another sender', () => {
  const props = contextFixture();
  const friendId = '55555555-5555-4555-8555-555555555555';
  props.workspace = saveCounterparty(props.workspace, { id: friendId, name: 'Public friend' });
  const before = props.workspace;
  let current = before;
  props.onChange = (update) => {
    current = update(current);
  };
  const view = render(contextElements(props));
  fireEvent.click(screen.getByRole('button', { name: / senders$/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Public friend' }));
  expect(current.counterparties?.links).toHaveLength(before.counterparties!.links.length + 1);
  expect(current.counterparties?.links).toEqual(
    expect.arrayContaining(before.counterparties!.links),
  );
  view.rerender(contextElements({ ...props, workspace: current }));
  expect(screen.getByRole('checkbox', { name: 'Public friend' }).getAttribute('aria-checked')).toBe(
    'true',
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Public friend' }));
  expect(current.counterparties?.links).toEqual(before.counterparties!.links);
  expect(current.annotations).toBe(before.annotations);
  expect(current.chainData).toBe(before.chainData);
  expect(screen.getByRole('dialog', { name: 'Senders' })).toBeDefined();
});

it('does not fabricate editable relationships when the required transaction evidence is unavailable', () => {
  const props = contextFixture();
  props.workspace.chainData.transactions = {};
  props.prepared = { prevouts: new Map(), scripthashes: new Set() };
  render(contextElements(props));
  expect(screen.queryByRole('button', { name: / senders$/i })).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
});

it('keeps party data readable and category draft cancellation keyboard accessible', async () => {
  const { props } = fixture();
  render(createElement(WalletCounterpartyDetail, props));
  expect(screen.getByRole('heading', { name: 'Public shop' })).toBeDefined();
  expect(
    within(screen.getByRole('region', { name: 'Identity details' })).getByText(
      'Public receipt note',
    ),
  ).toBeDefined();
  expect(screen.queryByRole('textbox', { name: 'Category' })).toBeNull();
  expect(screen.queryByText('Edit counterparty')).toBeNull();
  expect(screen.queryByLabelText('Selected item actions')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: / category$/i }));
  const input = screen.getByRole('textbox', { name: 'Category' });
  fireEvent.change(input, { target: { value: 'Draft category' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: 'Category' })).toBeNull();
  expect(props.onChange).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: / category$/i })),
  );
});

it('shows saved receipt context on a historical output without a coin review goal', () => {
  const props = contextFixture();
  props.row = {
    ...props.row,
    kind: 'output',
    key: `out:${TX_FUNDING}:0`,
    nodeId: `out:${TX_FUNDING}:0`,
    reviews: [],
    contextTransactionIds: [TX_FUNDING, TX_SPENDING],
  };
  render(createElement(WalletCounterpartyContext, props));
  const receipt = screen.getByRole('region', { name: 'Counterparties' });
  fireEvent.click(within(receipt).getByRole('link', { name: 'Public shop' }));
  expect(props.onOpenRecord).toHaveBeenCalledWith(reference);
  expect(props.onChange).not.toHaveBeenCalled();
});

it('keeps historical receipt inheritance exact to the output and excludes sent-only context', () => {
  const { workspace, props } = fixture();
  const siblingId = '55555555-5555-4555-8555-555555555555';
  const narrowedId = '66666666-6666-4666-8666-666666666666';
  const sentId = '77777777-7777-4777-8777-777777777777';
  let current = saveCounterparty(
    workspace,
    { id: siblingId, name: 'Sibling sender' },
    {
      kind: 'wallet-transaction',
      walletId,
      transactionId: TX_FUNDING,
      direction: 'received',
      walletOutputIds: [`out:${TX_FUNDING}:1`],
    },
  );
  current = saveCounterparty(
    current,
    { id: narrowedId, name: 'Narrow sender' },
    {
      kind: 'wallet-transaction',
      walletId,
      transactionId: TX_FUNDING,
      direction: 'received',
      walletOutputIds: [`out:${TX_FUNDING}:0`, `out:${TX_FUNDING}:1`],
      outputIds: [`out:${TX_FUNDING}:1`],
    },
  );
  current = saveCounterparty(
    current,
    { id: sentId, name: 'Payment recipient' },
    {
      kind: 'wallet-transaction',
      walletId,
      transactionId: TX_SPENDING,
      direction: 'sent',
      walletOutputIds: [`out:${TX_FUNDING}:0`],
    },
  );
  const output: WalletRow = {
    ...props.activityRows[0],
    kind: 'output',
    key: `out:${TX_FUNDING}:0`,
    nodeId: `out:${TX_FUNDING}:0`,
    reviews: [],
    contextTransactionIds: [TX_FUNDING, TX_SPENDING],
  };
  expect(walletRowCounterparties(current, output).map((party) => party.id)).toEqual([partyId]);
  expect(
    walletRowCounterparties(current, {
      ...output,
      key: `out:${TX_FUNDING}:1`,
      nodeId: `out:${TX_FUNDING}:1`,
    }).map((party) => party.id),
  ).toEqual([siblingId, narrowedId]);
  expect(
    walletRowCounterparties(current, {
      ...output,
      txid: TX_SPENDING,
      key: `out:${TX_SPENDING}:1`,
      nodeId: `out:${TX_SPENDING}:1`,
    }),
  ).toEqual([]);
});

it('drops inherited receipt context after exact unlink without copying or deleting party metadata', () => {
  const props = contextFixture();
  props.row = {
    ...props.row,
    kind: 'output',
    key: `out:${TX_FUNDING}:0`,
    nodeId: `out:${TX_FUNDING}:0`,
    reviews: [],
    contextTransactionIds: [TX_FUNDING, TX_SPENDING],
  };
  const { rerender } = render(createElement(WalletCounterpartyContext, props));
  expect(screen.getByRole('region', { name: 'Counterparties' })).toBeDefined();
  const link = props.workspace.counterparties!.links.find(
    (saved) => saved.kind === 'wallet-transaction' && saved.direction === 'received',
  )!;
  const next = removeCounterpartyLink(props.workspace, partyId, link);
  rerender(createElement(WalletCounterpartyContext, { ...props, workspace: next }));
  expect(screen.queryByRole('region', { name: 'Receipt context' })).toBeNull();
  expect(walletRowCounterparties(next, props.row)).toEqual([]);
  expect(next.counterparties?.links).toHaveLength(1);
  expect(next.annotations).toEqual(props.workspace.annotations);
  expect(next.annotations.entities[props.row.nodeId]).toBeUndefined();
});

it('shows inherited receipt context without making it removable from the coin checklist', () => {
  const { workspace } = fixture();
  let current = workspace;
  render(
    createElement(CounterpartyPicker, {
      workspace,
      subject: { kind: 'entity', subjectId: `out:${TX_FUNDING}:0` },
      onChange: (update) => {
        current = update(current);
      },
      onNotice: vi.fn(),
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add counterparty' }));
  const choice = screen.getByRole('checkbox', { name: 'Public shop' });
  expect(choice.getAttribute('aria-checked')).toBe('true');
  expect((choice as HTMLButtonElement).disabled).toBe(true);
  expect(current).toBe(workspace);
  fireEvent.click(screen.getByRole('button', { name: / senders$/i }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Public shop' }));
  expect(current.counterparties?.links).toEqual(
    workspace.counterparties?.links.filter(
      (link) => link.kind !== 'wallet-transaction' || link.direction !== 'received',
    ),
  );
  expect(current.annotations).toBe(workspace.annotations);
});

it('uses the shared metadata editors without changing association scopes', () => {
  const { props } = fixture();
  let current = props.workspace;
  const onChange = vi.fn((update: (workspace: Workspace) => Workspace) => {
    current = update(current);
  });
  render(createElement(WalletCounterpartyDetail, { ...props, onChange }));
  fireEvent.click(screen.getByRole('button', { name: / name$/i }));
  const dialog = screen.getByRole('dialog', { name: 'Label selected records' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Batch label' }), {
    target: { value: 'Renamed public shop' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply label' }));
  expect(onChange).toHaveBeenCalledOnce();
  expect(current.annotations.entities[reference]).toEqual({
    ...props.workspace.annotations.entities[reference],
    label: 'Renamed public shop',
  });
  expect(current.counterparties).toBe(props.workspace.counterparties);
  expect(current.annotations.tags).toBe(props.workspace.annotations.tags);
  expect(current.chainData).toBe(props.workspace.chainData);
});

it('keeps labeled transactions and addresses identified by their stable reference', () => {
  const { props } = fixture();
  props.workspace.annotations.entities[`tx:${TX_FUNDING}`] = {
    label: 'Public receipt',
    icon: '',
    note: '',
    bookmarked: false,
  };
  props.workspace.annotations.entities[`addr:${RECEIVE_ADDRESS}`] = {
    label: 'Public address',
    icon: '',
    note: '',
    bookmarked: false,
  };
  render(createElement(WalletCounterpartyDetail, props));
  const activity = screen.getByRole('region', { name: 'Related wallet activity' });
  const transaction = within(activity).getByRole('link', { name: TX_FUNDING });
  expect(transaction.querySelector('code')?.getAttribute('title')).toBe(TX_FUNDING);
  expect(within(transaction).getByText('Public receipt')).toBeDefined();
  fireEvent.click(screen.getByText('Addresses (1)'));
  const address = within(
    screen.getByRole('region', { name: 'Contextual address evidence' }),
  ).getByRole('link', { name: RECEIVE_ADDRESS });
  expect(address.querySelector('code')?.getAttribute('title')).toBe(RECEIVE_ADDRESS);
  expect(within(address).getByText('Public address')).toBeDefined();
});

it('returns keyboard focus from the actions menu and cancelled removal', async () => {
  const { props } = fixture();
  render(createElement(WalletCounterpartyDetail, props));
  const trigger = screen.getByRole('button', { name: 'Counterparty actions' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox', { name: 'Bookmark' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove counterparty' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Remove counterparty' })).getByRole('button', {
      name: 'Cancel',
    }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(props.onChange).not.toHaveBeenCalled();
});

it('offers explicit graph navigation for an address outside the available wallet records', () => {
  const { props } = fixture();
  render(
    createElement(WalletCounterpartyDetail, {
      ...props,
      canOpenRecord: (id) => id.startsWith('tx:'),
    }),
  );
  fireEvent.click(screen.getByText('Addresses (1)'));
  const evidence = screen.getByRole('region', { name: 'Contextual address evidence' });
  expect(within(evidence).queryByRole('link', { name: RECEIVE_ADDRESS })).toBeNull();
  fireEvent.click(
    within(evidence).getByRole('button', { name: `Show ${RECEIVE_ADDRESS} on graph` }),
  );
  expect(props.onShowInGraph).toHaveBeenCalledWith(`addr:${RECEIVE_ADDRESS}`);
  expect(props.onOpenRecord).not.toHaveBeenCalled();
});
