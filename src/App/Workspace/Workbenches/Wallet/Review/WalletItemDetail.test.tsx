// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import type { Wallet } from '../../../../../Core/Workspace/Wallets/wallets';
import type { WalletReviewItem } from '../../../../../Core/Workspace/Wallets/walletReview';
import { buildWalletSelectionIndex } from '../../../../../Core/Workspace/Wallets/walletSelectionIndex';
import type { WalletRow } from '../walletRows';
import { WalletRecordDetail, WalletReviewItemDetail } from './WalletItemDetail';
import { PUBLIC_ZPUB } from '../../../../../../tests/fixtures/bitcoin';

afterEach(cleanup);

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

it('keeps review guidance and decision actions in the review variant', () => {
  const props = fixture();
  const onDecide = vi.fn();
  render(<WalletReviewItemDetail {...props} onDecide={onDecide} />);
  expect(screen.getByRole('note', { name: 'Review guidance' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Review items' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
  expect(onDecide).toHaveBeenCalledWith(props.row.reviews, 'reviewed');
  fireEvent.click(screen.getByRole('button', { name: 'Review later' }));
  expect(onDecide).toHaveBeenCalledWith(props.row.reviews, 'later');
  fireEvent.click(screen.getByRole('button', { name: 'Show on graph' }));
  expect(props.onShowInGraph).toHaveBeenCalledWith(props.row.nodeId, undefined);
});

it('keeps factual records free of decisions and navigates to one deduplicated review item', () => {
  const props = fixture();
  props.row.reviews.push({ ...props.row.reviews[0] });
  const onOpenReviewItem = vi.fn();
  render(<WalletRecordDetail {...props} onOpenReviewItem={onOpenReviewItem} />);
  expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
  expect(screen.queryByRole('note', { name: 'Review guidance' })).toBeNull();
  const links = screen.getAllByRole('button', { name: /Review this transaction/ });
  expect(links).toHaveLength(1);
  fireEvent.click(links[0]);
  expect(onOpenReviewItem).toHaveBeenCalledWith(props.row, props.row.reviews[0]);
  expect(screen.getByRole('group', { name: 'Edit entity metadata' })).toBeTruthy();
});

it('reopens a completed review but keeps changed evidence actionable', () => {
  const props = fixture();
  props.row.status = 'reviewed';
  props.row.reviews[0].status = 'reviewed';
  const onDecide = vi.fn();
  const view = render(<WalletReviewItemDetail {...props} onDecide={onDecide} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(onDecide).toHaveBeenCalledWith(props.row.reviews, 'reopen');
  const row = { ...props.row, reviews: [{ ...props.row.reviews[0], changed: true }] };
  view.rerender(<WalletReviewItemDetail {...props} row={row} onDecide={onDecide} />);
  expect(screen.getByText('Evidence changed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeTruthy();
});
