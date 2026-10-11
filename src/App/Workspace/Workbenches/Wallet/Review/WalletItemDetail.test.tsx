// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { WalletReviewItem } from '../../../../../Core/Workspace/Wallets/walletReview';
import { buildWalletSelectionIndex } from '../../../../../Core/Workspace/Wallets/walletSelectionIndex';
import type { WalletRow } from '../walletRows';
import { WalletItemDetail } from './WalletItemDetail';
import { PUBLIC_ZPUB, transactions, TX_SPENDING } from '../../../../../../tests/fixtures/bitcoin';

afterEach(cleanup);

it('groups transaction inputs and outputs in one disclosure and preserves per-outpoint graph actions', () => {
  const props = fixture();
  props.workspace.chainData.transactions = structuredClone(transactions);
  props.row = {
    ...props.row,
    nodeId: `tx:${TX_SPENDING}`,
    txid: TX_SPENDING,
    identifier: TX_SPENDING,
    contextTransactionIds: [TX_SPENDING],
    outpointIds: [`out:${'c'.repeat(64)}:0`],
  };
  props.selectionIndex = buildWalletSelectionIndex(props.workspace);
  render(<WalletItemDetail {...props} onDecide={vi.fn()} />);
  const flow = screen.getByRole('group', { name: 'Transaction flow' });
  expect(within(flow).getByRole('figure', { name: 'Wallet transaction flow' })).toBeTruthy();
  fireEvent.click(within(flow).getByRole('button', { name: 'Show on graph' }));
  expect(props.onShowInGraph).toHaveBeenCalledWith(props.row.nodeId, props.row.utxo);
  fireEvent.click(within(flow).getByRole('button', { name: 'Isolate on graph' }));
  expect(props.onIsolateInGraph).toHaveBeenCalledWith(props.row.nodeId, props.row.utxo);
  expect(within(flow).getByRole('figure', { name: 'Wallet transaction flow' })).toBeTruthy();
  fireEvent.click(flow.querySelector('summary')!);
  expect(within(flow).queryByRole('figure')).toBeNull();
  fireEvent.click(flow.querySelector('summary')!);
  expect(within(flow).getByRole('figure', { name: 'Wallet transaction flow' })).toBeTruthy();
  const group = screen.getByRole('group', { name: 'Inputs and outputs' });
  const transaction = transactions[TX_SPENDING];
  fireEvent.click(
    within(group).getByText(
      `Inputs (${transaction.vin.length}) / Outputs (${transaction.vout.length})`,
    ),
  );
  const inputs = within(group).getByRole('region', { name: 'Inputs' });
  const outputs = within(group).getByRole('region', { name: 'Outputs' });
  expect(inputs.parentElement).toBe(outputs.parentElement);
  expect(screen.queryByRole('group', { name: 'Input outpoints' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Output outpoints' })).toBeNull();
  const other = screen.getByRole('group', { name: 'Related outpoints' });
  expect(within(other).getByText('Related outpoints (1)')).toBeDefined();
  expect(within(outputs).queryByTitle(`${'c'.repeat(64)}:0`)).toBeNull();
  const id = `out:${TX_SPENDING}:${transaction.vout[0].n}`;
  fireEvent.click(
    within(outputs).getByRole('button', { name: `Show outpoint ${id.slice(4)} on graph` }),
  );
  expect(props.onShowInGraph).toHaveBeenCalledWith(id);
  expect(within(outputs).getAllByRole('button', { name: 'Copy outpoint' })).toHaveLength(
    transaction.vout.length,
  );
});

function fixture() {
  const workspace = createWorkspace('Detail fixture', 'mainnet');
  const txid = 'a'.repeat(64);
  const wallet: Wallet = {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Test wallet',
    key: PUBLIC_ZPUB,
    scriptType: 'p2wpkh',
    color: '#27c4a7',
    addresses: [],
  };
  const review: WalletReviewItem = {
    key: `${wallet.id}|wallet-transaction|${txid}`,
    kind: 'finding',
    satisfied: false,
    contextSubjects: [],
    reason: 'wallet-transaction',
    scope: 'transactions',
    title: 'Review this transaction',
    detail: '',
    nodeId: `tx:${txid}`,
    subjectIds: [`tx:${txid}`],
    nodeIds: [`tx:${txid}`],
    label: '',
    tags: [],
    evidence: 'fixture',
    status: 'open',
    changed: false,
  };
  const row: WalletRow = {
    key: `tx:${txid}`,
    nodeId: `tx:${txid}`,
    identifier: txid,
    title: 'Transaction',
    description: '',
    kind: 'transaction',
    meta: '',
    txid,
    contextTransactionIds: [],
    reviews: [review],
    status: 'open',
    changed: false,
  };
  return {
    workspace,
    wallet,
    row,
    selectionIndex: buildWalletSelectionIndex(workspace),
    walletAddresses: { addresses: new Set<string>(), scripthashes: new Set<string>() },
    active: true,
    busy: false,
    canLoadChainData: false,
    updateEvidence: vi.fn(),
    onChange: vi.fn(),
    onNotice: vi.fn(),
    onShowInGraph: vi.fn(),
    onIsolateInGraph: vi.fn(),
  };
}

function findingRegion(title: string) {
  return screen.getByRole('region', { name: title });
}

it('shows recorded confirmations without inferring missing counts or retaining inactive placement', () => {
  const props = fixture();
  const transaction = {
    ...structuredClone(transactions[TX_SPENDING]),
    txid: props.row.txid!,
    status: { kind: 'confirmed' as const, blockHeight: 800000, blocktime: 1690168629 },
  };
  props.workspace.chainData.transactions = { [transaction.txid]: transaction };
  const onDecide = vi.fn();
  const view = render(<WalletItemDetail {...props} onDecide={onDecide} />);
  const facts = screen.getByLabelText('Transaction facts');
  expect(within(facts).queryByText(/confirmations?$/)).toBeNull();
  expect(facts.querySelector('time')).toBeTruthy();
  const workspace = {
    ...props.workspace,
    chainData: {
      ...props.workspace.chainData,
      transactions: {
        [transaction.txid]: {
          ...transaction,
          status: { ...transaction.status, confirmations: 7 },
        },
      },
    },
  };
  view.rerender(<WalletItemDetail {...props} workspace={workspace} onDecide={onDecide} />);
  expect(within(facts).getByText('7 confirmations')).toBeTruthy();
  view.rerender(
    <WalletItemDetail
      {...props}
      workspace={{
        ...workspace,
        chainData: {
          ...workspace.chainData,
          transactions: {
            [transaction.txid]: {
              ...transaction,
              status: { kind: 'inactive', blocktime: 1690168629, confirmations: -1 },
            },
          },
        },
      }}
      onDecide={onDecide}
    />,
  );
  expect(within(facts).queryByText(/confirmations?$/)).toBeNull();
  expect(facts.querySelector('time')).toBeNull();
});

it('assesses exact review items in the shared inspector', () => {
  const props = fixture();
  const onDecide = vi.fn();
  render(<WalletItemDetail {...props} onDecide={onDecide} />);
  expect(screen.getByRole('region', { name: 'Review goals' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Review items' })).toBeNull();
  fireEvent.click(
    within(findingRegion(props.row.reviews[0].title)).getByRole('button', {
      name: 'Mark reviewed',
    }),
  );
  expect(onDecide).toHaveBeenCalledWith(props.row.reviews, 'reviewed');
  fireEvent.click(
    within(findingRegion(props.row.reviews[0].title)).getByRole('button', { name: 'Later' }),
  );
  expect(onDecide).toHaveBeenCalledWith(props.row.reviews, 'later');
  fireEvent.click(screen.getByRole('button', { name: 'Show on graph' }));
  expect(props.onShowInGraph).toHaveBeenCalledWith(props.row.nodeId, undefined);
});

it('deduplicates review keys and keeps annotation editing outside review', () => {
  const props = fixture();
  props.row.reviews.push({ ...props.row.reviews[0] });
  render(<WalletItemDetail {...props} onDecide={vi.fn()} />);
  const goals = screen.getByRole('region', { name: 'Review goals' });
  expect(within(goals).getAllByText('Review this transaction')).toHaveLength(1);
  expect(within(goals).queryByRole('button', { name: / label$/i })).toBeNull();
  expect(screen.queryByLabelText('Selected item actions')).toBeNull();
});

it('hides automatically answered goals and keeps explicit decisions reversible', () => {
  const props = fixture();
  const description: WalletReviewItem = {
    ...props.row.reviews[0],
    kind: 'annotation-goal',
    goal: 'activity-context',
    satisfied: true,
  };
  const view = render(
    <WalletItemDetail
      {...props}
      row={{ ...props.row, reviews: [description] }}
      onDecide={vi.fn()}
    />,
  );
  expect(screen.queryByRole('region', { name: 'Review goals' })).toBeNull();
  const onDecide = vi.fn();
  const item = { ...description, satisfied: false, status: 'not-needed' as const };
  view.rerender(
    <WalletItemDetail {...props} row={{ ...props.row, reviews: [item] }} onDecide={onDecide} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Label review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(onDecide).toHaveBeenCalledWith([item], 'reopen');
  const later = { ...item, status: 'later' as const };
  view.rerender(
    <WalletItemDetail {...props} row={{ ...props.row, reviews: [later] }} onDecide={onDecide} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Label review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(onDecide).toHaveBeenLastCalledWith([later], 'reopen');
});

it('reopens a completed review but keeps changed evidence actionable', () => {
  const props = fixture();
  props.row.status = 'reviewed';
  props.row.reviews[0].status = 'reviewed';
  const onDecide = vi.fn();
  const view = render(<WalletItemDetail {...props} onDecide={onDecide} />);
  fireEvent.click(
    within(findingRegion(props.row.reviews[0].title)).getByRole('button', { name: 'Reopen' }),
  );
  expect(onDecide).toHaveBeenCalledWith(props.row.reviews, 'reopen');
  const row = { ...props.row, reviews: [{ ...props.row.reviews[0], changed: true }] };
  view.rerender(<WalletItemDetail {...props} row={row} onDecide={onDecide} />);
  expect(screen.getByText('Evidence changed')).toBeTruthy();
  fireEvent.click(
    within(findingRegion(props.row.reviews[0].title)).getByRole('button', {
      name: 'Mark reviewed',
    }),
  );
  expect(onDecide).toHaveBeenLastCalledWith(row.reviews, 'reviewed');
});

it('opens a targeted review after the section was closed and assesses exact keys', () => {
  const props = fixture();
  const second = {
    ...props.row.reviews[0],
    key: 'second-finding',
    title: 'Second finding',
    detail: 'Second evidence',
  };
  props.row.reviews.push(second);
  const onDecide = vi.fn();
  const view = render(<WalletItemDetail {...props} onDecide={onDecide} />);
  fireEvent.click(screen.getByRole('region', { name: 'Review goals' }).querySelector('summary')!);
  view.rerender(<WalletItemDetail {...props} focusedReviewKey={second.key} onDecide={onDecide} />);
  fireEvent.click(
    within(findingRegion(second.title)).getByRole('button', { name: 'Mark reviewed' }),
  );
  expect(onDecide).toHaveBeenCalledWith([second], 'reviewed');
  fireEvent.click(
    within(findingRegion(props.row.reviews[0].title)).getByRole('button', {
      name: 'Mark reviewed',
    }),
  );
  expect(onDecide).toHaveBeenLastCalledWith([props.row.reviews[0]], 'reviewed');
});

it.each([
  ['cannot-identify', 'Unknown'],
  ['not-needed', 'Not needed'],
  ['later', 'Later'],
] as const)(
  'records %s for the exact sender question when relationship evidence is unavailable',
  (action, label) => {
    const props = fixture();
    props.row.reviews[0] = {
      ...props.row.reviews[0],
      kind: 'annotation-goal',
      goal: 'counterparty-context',
      title: 'Who sent this?',
      relationshipKinds: ['source'],
    };
    const onDecide = vi.fn();
    render(<WalletItemDetail {...props} onDecide={onDecide} />);
    expect(screen.queryByRole('button', { name: / senders$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sender review' }));
    expect(screen.queryByRole('button', { name: /^Add sender$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(onDecide).toHaveBeenCalledWith(props.row.reviews, action);
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

it('hands the selected record directly to show and isolate graph actions', () => {
  const props = fixture();
  render(<WalletItemDetail {...props} onDecide={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show on graph' }));
  expect(props.onShowInGraph).toHaveBeenCalledWith(props.row.nodeId, props.row.utxo);
  fireEvent.click(screen.getByRole('button', { name: 'Isolate on graph' }));
  expect(props.onIsolateInGraph).toHaveBeenCalledWith(props.row.nodeId, props.row.utxo);
  expect(screen.queryByRole('menu')).toBeNull();
});

it.each(['address', 'output'] as const)(
  'keeps exact linked review navigation from a %s without attaching transaction purpose to its own label',
  (kind) => {
    const props = fixture();
    const item = {
      ...props.row.reviews[0],
      kind: 'annotation-goal' as const,
      goal: 'activity-context' as const,
    };
    const nodeId =
      kind === 'address'
        ? `addr:${transactions[TX_SPENDING].vout[0].scriptPubKey.address}`
        : `out:${TX_SPENDING}:0`;
    const row = {
      ...props.row,
      kind,
      nodeId,
      key: nodeId,
      reviews: [{ ...item, subjectIds: [nodeId] }],
    };
    const onOpenReviewItem = vi.fn();
    render(
      <WalletItemDetail
        {...props}
        row={row}
        onOpenReviewItem={onOpenReviewItem}
        onDecide={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Label review' })).toBeNull();
    const checklist = screen.getByRole('region', { name: 'Review goals' });
    fireEvent.click(within(checklist).getByRole('button', { name: item.title }));
    expect(onOpenReviewItem).toHaveBeenCalledWith(row, row.reviews[0]);
  },
);
