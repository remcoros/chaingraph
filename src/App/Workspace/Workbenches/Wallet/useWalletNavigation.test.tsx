// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import {
  WalletNavigation,
  useWalletNavigation,
  useWalletNavigationSessions,
  walletNavigationFor,
} from './useWalletNavigation';
import { TransactionFetchScope } from '../../../../Core/ChainData/transactionScheduler';
import { viewSchema } from '../../../../Core/Workspace/view';

afterEach(cleanup);
it('opens an external counterparty in the navigation reused by mounted Wallet panels', () => {
  const session = new Map<string, WalletNavigation>();
  const navigation = walletNavigationFor(session, 'one', {
    activeTab: 'review',
    tabs: { counterparties: { query: 'hides the clicked identity', selectedKey: 'party:other' } },
  });
  navigation.openCounterparty('contact');
  const panel = renderHook(() => useWalletNavigation('one', undefined, session));
  expect(panel.result.current.navigation).toBe(navigation);
  expect(panel.result.current.visit.position).toMatchObject({
    tab: 'counterparties',
    selectedKey: 'party:contact',
    query: '',
    selection: { ids: [] },
  });
  act(() => navigation.openCounterparty('second'));
  expect(panel.result.current.visit.position.selectedKey).toBe('party:second');
  expect(navigation.presentation()).toMatchObject({
    activeTab: 'counterparties',
    tabs: { counterparties: { selectedKey: 'party:second' } },
  });
});
const a = `tx:${'a'.repeat(64)}`;
const b = `tx:${'b'.repeat(64)}`;
const c = `tx:${'c'.repeat(64)}`;
const current = (navigation: WalletNavigation) => {
  const state = navigation.getSnapshot();
  return state.visits[state.section].position;
};

it('resumes each tab with its focused record, filters, scroll, revealed rows and range anchor', () => {
  const navigation = new WalletNavigation();
  navigation.inspect(b);
  navigation.choose(a, [a, b, c], {}, true);
  navigation.filter({ query: 'income' });
  navigation.update({ scrollTop: 450, limit: 80 });
  navigation.switchTab('addresses');
  navigation.addressScope('change');
  navigation.filter({ query: 'reserve' });
  navigation.inspect('addr:reserve');
  navigation.switchTab('transactions');
  expect(current(navigation)).toMatchObject({
    selectedKey: b,
    query: 'income',
    scrollTop: 450,
    limit: 80,
    selection: { ids: [a], anchor: a },
  });
  navigation.choose(c, [a, b, c], { shiftKey: true });
  expect(current(navigation).selection.ids).toEqual([a, b, c]);
  navigation.switchTab('addresses');
  expect(current(navigation)).toMatchObject({
    addressBranch: 'change',
    query: 'reserve',
    selectedKey: 'addr:reserve',
  });
  expect(navigation.backLabel()).toBeUndefined();
});

it('preserves both ends of nested related-activity jumps without saving temporary scopes', () => {
  const navigation = new WalletNavigation();
  navigation.inspect(b);
  navigation.choose(a, [a, b], {}, true);
  navigation.filter({ query: 'earlier search' });
  navigation.update({ scrollTop: 360 });
  navigation.switchTab('counterparties');
  navigation.inspect('party:one');
  navigation.filter({ query: 'contact' });
  navigation.update({ scrollTop: 70 });
  navigation.showTransactions([a.slice(3)]);
  navigation.inspect(a);
  navigation.openReview({
    nodeId: a,
    reference: a.slice(3),
    key: 'goal:one',
    selectedKey: 'review:one',
  });
  const saved = navigation.presentation();
  expect(saved.tabs?.transactions).toMatchObject({
    query: 'earlier search',
    selectedKey: b,
    scrollTop: 360,
  });
  expect(saved.tabs?.transactions?.transactionIds).toBeUndefined();
  expect(saved.tabs?.review?.selectedKey).toBeUndefined();
  navigation.back();
  expect(current(navigation)).toMatchObject({ selectedKey: a, transactionScope: [a.slice(3)] });
  navigation.back();
  expect(current(navigation)).toMatchObject({
    tab: 'counterparties',
    selectedKey: 'party:one',
    query: 'contact',
    scrollTop: 70,
  });
  navigation.switchTab('transactions');
  expect(current(navigation)).toMatchObject({
    selectedKey: b,
    query: 'earlier search',
    scrollTop: 360,
    selection: { ids: [a], anchor: a },
  });
  expect(current(navigation).transactionScope).toBeUndefined();
});

it('resumes inspector links across tabs and unwinds a same-tab activity jump', () => {
  const navigation = new WalletNavigation();
  navigation.inspect(a);
  navigation.openRecord(a, 'scope', 'party:one');
  navigation.switchTab('utxos');
  navigation.switchTab('transactions');
  expect(current(navigation).detailTrail?.references).toEqual(['party:one']);
  navigation.showTransactions([a.slice(3)]);
  navigation.back();
  expect(current(navigation).detailTrail?.references).toEqual(['party:one']);
  navigation.back();
  expect(current(navigation).detailTrail?.references).toEqual([]);
  expect(current(navigation).selectedKey).toBe(a);
  expect(navigation.getSnapshot().focus?.reference).toBe('party:one');
});

it('finishes a repeated related-activity jump without reviving the earlier temporary view', () => {
  const navigation = new WalletNavigation();
  navigation.inspect(b);
  navigation.choose(b, [a, b], {}, true);
  navigation.filter({ query: 'normal search' });
  navigation.switchTab('counterparties');
  navigation.inspect('party:one');
  navigation.showTransactions([a.slice(3)]);
  navigation.switchTab('counterparties');
  navigation.showTransactions([a.slice(3)]);
  navigation.back();
  expect(current(navigation).selectedKey).toBe('party:one');
  navigation.switchTab('transactions');
  expect(current(navigation)).toMatchObject({
    selectedKey: b,
    query: 'normal search',
    selection: { ids: [b], anchor: b },
  });
  expect(current(navigation).transactionScope).toBeUndefined();
  expect(navigation.backLabel()).toBeUndefined();
});

it('returns directly to the originating context from a nested inspector after clearing its scope', () => {
  const navigation = new WalletNavigation();
  navigation.inspect(b);
  navigation.switchTab('counterparties');
  navigation.inspect('party:one');
  navigation.showTransactions([a.slice(3)]);
  navigation.inspect(a);
  navigation.openRecord(a, 'related', `out:${a.slice(3)}:0`);
  expect(navigation.backLabel()).toBe('Back');
  expect(navigation.contextBackLabel()).toBe('Back to Counterparties');
  navigation.filter({ transactionScope: undefined });
  navigation.openRecord(a, 'all', c);
  navigation.returnToOrigin();
  expect(current(navigation).selectedKey).toBe('party:one');
  navigation.switchTab('transactions');
  expect(current(navigation).selectedKey).toBe(b);
  expect(current(navigation).detailTrail).toBeUndefined();
  expect(current(navigation).transactionScope).toBeUndefined();
  expect(navigation.contextBackLabel()).toBeUndefined();
});

it('retains filtered selections and bounds Shift-click to visible records after the anchor is hidden', () => {
  const navigation = new WalletNavigation();
  navigation.choose(a, [a, b, c], {}, true);
  navigation.filter({ query: 'only b and c' });
  expect(current(navigation).selection.ids).toEqual([a]);
  navigation.choose(c, [b, c], { shiftKey: true, ctrlKey: true });
  expect(current(navigation).selection.ids).toEqual([a, c]);
  navigation.switchTab('addresses');
  navigation.choose('address', ['address'], {}, true);
  navigation.addressScope('sources');
  expect(current(navigation).selection.ids).toEqual(['address']);
  navigation.switchTab('transactions');
  navigation.switchTab('addresses');
  expect(current(navigation).tab).toBe('sources');
});

it('loads older browsing/Review positions and reopens saved tab positions with no checked rows or Back trail', () => {
  const navigation = new WalletNavigation({
    activeTab: 'review',
    browsing: { tab: 'sources', query: 'source', selectedKey: 'source:one', scrollTop: 90 },
    review: { status: 'later', selectedKey: 'review:one', typeIds: ['address-description'] },
  });
  expect(current(navigation)).toMatchObject({ status: 'later', selectedKey: 'review:one' });
  navigation.switchTab('addresses');
  expect(current(navigation)).toMatchObject({
    tab: 'sources',
    query: 'source',
    selectedKey: 'source:one',
  });
  navigation.choose('source:one', ['source:one'], {}, true);
  navigation.openRecord('source:one', 'scope', a);
  const saved = navigation.presentation();
  const parsed = viewSchema.parse({
    dimensions: 3,
    sizeBy: 'uniform',
    glow: false,
    showAddresses: false,
    wallet: { one: saved },
  });
  const reopened = new WalletNavigation(parsed.wallet!.one);
  expect(current(reopened)).toMatchObject({
    tab: 'sources',
    query: 'source',
    selectedKey: 'source:one',
    scrollTop: 90,
    selection: { ids: [] },
  });
  expect(current(reopened).detailTrail).toBeUndefined();
  expect(reopened.backLabel()).toBeUndefined();
});

it('retains independent wallet state while unlocked and releases removed wallets and locked sessions', () => {
  const scope = new TransactionFetchScope('mainnet');
  const data = { wallets: { definitions: [{ id: 'one' }, { id: 'two' }] } };
  const { result, rerender } = renderHook(({ open }) => useWalletNavigationSessions(open), {
    initialProps: { open: [{ fetchScope: scope, data }] },
  });
  const session = result.current(scope)!;
  const first = renderHook(() => useWalletNavigation('one', undefined, session));
  act(() => first.result.current.navigation.choose(a, [a], {}, true));
  first.unmount();
  const other = renderHook(() => useWalletNavigation('two', undefined, session));
  expect(other.result.current.visit.position.selection.ids).toEqual([]);
  other.unmount();
  const returned = renderHook(() => useWalletNavigation('one', undefined, session));
  expect(returned.result.current.visit.position.selection.ids).toEqual([a]);
  returned.unmount();
  rerender({ open: [{ fetchScope: scope, data: { wallets: { definitions: [{ id: 'two' }] } } }] });
  expect(session.has('one')).toBe(false);
  scope.close();
  rerender({ open: [] });
  expect(result.current(scope)).toBeUndefined();
  const reopened = new TransactionFetchScope('mainnet');
  expect(result.current(reopened)!.size).toBe(0);
  reopened.close();
});
