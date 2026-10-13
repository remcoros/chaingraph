// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { deriveAddresses } from '../../../../../Core/Workspace/Wallets/walletDerivation';
import {
  assignCounterparty,
  saveCounterparty,
} from '../../../../../Core/Workspace/Counterparties/counterparties';
import { WalletReviewPanel, type WalletWorkbenchViewProps } from './WalletReviewPanel';
import {
  PUBLIC_ZPUB,
  transactions,
  TX_FUNDING,
  TX_SPENDING,
} from '../../../../../../tests/fixtures/bitcoin';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
function Fixture({
  saved = false,
  findings = false,
  receipt = false,
  addressActivity = false,
  addressReview = false,
  counterparties = false,
  unspentReceipt = false,
  sessionAnalysis,
  coinError = '',
}: {
  saved?: boolean;
  findings?: boolean;
  receipt?: boolean;
  addressActivity?: boolean;
  addressReview?: boolean;
  counterparties?: boolean;
  unspentReceipt?: boolean;
  sessionAnalysis?: WalletWorkbenchViewProps['sessionAnalysis'];
  coinError?: string;
}) {
  const [workspace, setWorkspace] = useState(() => {
    const value = createWorkspace('Public wallet fixture', 'mainnet');
    const wallet = {
      id: '30000000-0000-4000-8000-000000000001',
      name: 'Public wallet',
      key: PUBLIC_ZPUB,
      scriptType: 'p2wpkh' as const,
      color: '#27c4a7',
      addresses: [
        ...deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 2),
        ...(addressActivity ? deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 1, 7, 1) : []),
      ],
      scannedAt: '2026-10-01T10:00:00.000Z',
      scanComplete: true,
    };
    value.wallets.definitions = [wallet];
    value.chainData.transactions = structuredClone(transactions);
    if (unspentReceipt) delete value.chainData.transactions[TX_SPENDING];
    if (addressActivity)
      value.chainData.transactions['e'.repeat(64)] = {
        txid: 'e'.repeat(64),
        vin: [{ coinbase: '00' }],
        vout: [{ n: 0, value: 0.1, scriptPubKey: { address: wallet.addresses[2].address } }],
      };
    // Coinbase funding has no sender question; use an ordinary receipt for this interaction.
    if (receipt) value.chainData.transactions[TX_FUNDING].vin = [{ txid: 'd'.repeat(64), vout: 0 }];
    if (findings)
      value.analysis.findings = [
        {
          id: 'receipt-finding',
          algorithm: 'value-flow-v1',
          title: 'Receipt finding',
          description: 'Receipt evidence',
          nodeIds: [`tx:${TX_FUNDING}`, `tx:${TX_SPENDING}`],
          txids: [TX_FUNDING, TX_SPENDING],
          subjects: [`tx:${TX_FUNDING}`],
          kind: 'observation',
          reviewRule: 'fee-threshold',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
        {
          id: 'spend-finding',
          algorithm: 'value-flow-v1',
          title: 'Spending finding',
          description: 'Spending evidence',
          nodeIds: [`tx:${TX_FUNDING}`, `tx:${TX_SPENDING}`],
          txids: [TX_FUNDING, TX_SPENDING],
          subjects: [`tx:${TX_SPENDING}`],
          kind: 'observation',
          reviewRule: 'fee-threshold',
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ];
    if (saved)
      value.view.wallet = {
        [wallet.id]: {
          activeTab: 'review',
          browsing: { tab: 'transactions', query: TX_FUNDING, selectedKey: `tx:${TX_FUNDING}` },
          review: { status: 'all' },
        },
      };
    if (addressReview)
      value.view.wallet = {
        [wallet.id]: {
          activeTab: 'review',
          browsing: { tab: 'addresses', addressBranch: 'receive' },
          review: { status: 'open', typeIds: ['address-description'], addressBranch: 'all' },
        },
      };
    const result = counterparties
      ? saveCounterparty(
          value,
          {
            id: '40000000-0000-4000-8000-000000000001',
            name: 'Public contact',
          },
          {
            kind: 'wallet-transaction',
            walletId: wallet.id,
            transactionId: TX_FUNDING,
            direction: 'received',
            walletOutputIds: [`out:${TX_FUNDING}:0`],
          },
        )
      : value;
    return unspentReceipt && counterparties
      ? assignCounterparty(result, '40000000-0000-4000-8000-000000000001', {
          kind: 'entity',
          subjectId: `addr:${wallet.addresses[0].address}`,
        })
      : result;
  });
  const props: WalletWorkbenchViewProps = {
    sessionAnalysis,
    workspace,
    wallet: workspace.wallets.definitions[0],
    active: true,
    busy: false,
    canLoadChainData: false,
    onChange: setWorkspace,
    updateEvidence: (_id, update) => setWorkspace(update),
    onSelectWallet: vi.fn(),
    onAddWallet: vi.fn(),
    onRefresh: vi.fn(),
    onShowInGraph: vi.fn(),
    onIsolateInGraph: vi.fn(),
    onShowSelection: vi.fn(),
    onInspect: vi.fn(),
    walletUtxos: {
      loading: false,
      error: coinError,
      check: vi.fn(),
      utxos: unspentReceipt
        ? {
            checkedAt: '2026-10-01T10:00:00.000Z',
            records: [
              {
                txid: TX_FUNDING,
                vout: 0,
                address: workspace.wallets.definitions[0].addresses[0].address,
                scripthash: workspace.wallets.definitions[0].addresses[0].scripthash,
                valueSats: 100_000_000,
                height: 100,
              },
            ],
            checkedAddresses: 1,
            totalAddresses: 2,
            failed: 0,
          }
        : undefined,
    },
    onPresentationChange: (id, update) =>
      setWorkspace((current) => {
        const before = current.view.wallet?.[id] ?? {};
        const after = update(before);
        return before === after
          ? current
          : {
              ...current,
              view: { ...current.view, wallet: { ...current.view.wallet, [id]: after } },
            };
      }),
  };
  return <WalletReviewPanel {...props} wallet={props.wallet!} />;
}
it('keeps retained manual analysis failures out of the wallet refresh notice even when names match', () => {
  const error = 'Synthetic wallet analysis failure';
  const scan: NonNullable<WalletWorkbenchViewProps['sessionAnalysis']> = {
    scope: {
      kind: 'wallet',
      label: 'Wallet Other public wallet',
      explanation: 'Public fixture',
      txids: [],
    },
    options: {},
    reports: [{ toolId: 'fee-rate', status: 'error', message: error }],
    findings: [],
    runAt: '2026-10-01T10:00:00.000Z',
  };
  const view = render(<Fixture sessionAnalysis={scan} />);
  const header = screen.getByRole('combobox', { name: /selected wallet/i }).closest('header')!;
  expect(within(header).queryByText(new RegExp(error))).toBeNull();

  view.rerender(
    <Fixture
      sessionAnalysis={{ ...scan, scope: { ...scan.scope, label: 'Wallet Public wallet' } }}
    />,
  );
  expect(within(header).queryByText(new RegExp(error))).toBeNull();
});

it('routes coin-check failures into the header notice and clears them after recovery', () => {
  const error = 'Synthetic coin-check failure';
  const view = render(<Fixture coinError={error} />);
  const header = screen.getByRole('combobox', { name: /selected wallet/i }).closest('header')!;
  expect(within(header).getByText(error)).toBeDefined();
  view.rerender(<Fixture />);
  expect(within(header).queryByText(error)).toBeNull();
});

it('starts with transaction activity and exposes address scopes under one tab', () => {
  render(<Fixture />);
  const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
  expect(
    tabs.getAllByRole('button').map((button) => button.textContent?.replace(/\d+$/, '').trim()),
  ).toEqual(['Transactions', 'Coins', 'Addresses', 'Counterparties', 'Review']);
  expect(tabs.getByRole('button', { name: 'Transactions' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  expect(screen.getAllByLabelText('received').length).toBeGreaterThan(0);
  expect(
    screen.getAllByText(
      (_text, element) =>
        element?.classList.contains('bitcoin-amount') === true &&
        element.textContent?.replace(/\s/g, '').startsWith('+2.00000000') === true,
    ).length,
  ).toBeGreaterThan(0);
  fireEvent.click(screen.getAllByRole('button', { name: / label$/i })[0]);
  expect(tabs.getByRole('button', { name: 'Transactions' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  const editor = screen.getByRole('dialog', { name: 'Label selected records' });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Batch label' }), {
    target: { value: 'Public fixture context' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: 'Apply label' }));
  expect(screen.queryByRole('dialog', { name: 'Label selected records' })).toBeNull();
  expect(screen.getAllByText('Public fixture context').length).toBeGreaterThan(0);
  fireEvent.click(tabs.getByRole('button', { name: 'Addresses' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Addresses' }), {
    target: { value: 'change' },
  });
  expect(screen.getByText('No results')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Addresses' }), {
    target: { value: 'sources' },
  });
  expect(tabs.getByRole('button', { name: 'Addresses' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('combobox', { name: 'Addresses' }).getAttribute('aria-label')).toBe(
    'Addresses',
  );
});

it('filters both branches through one Addresses selector and restores it after Review', () => {
  render(<Fixture addressActivity />);
  fireEvent.click(screen.getByRole('button', { name: 'Addresses' }));
  const selector = screen.getByRole('combobox', { name: 'Addresses' });
  expect(
    within(selector)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Wallet (all)', 'Wallet (receive)', 'Wallet (change)', 'Sources', 'Destinations']);
  const records = screen.getByRole('list', { name: 'Addresses records' });
  expect(within(records).getAllByRole('link')).toHaveLength(3);
  fireEvent.change(selector, { target: { value: 'change' } });
  expect(within(records).getAllByRole('link')).toHaveLength(1);
  expect(within(records).getByText('Change · Index 7')).toBeTruthy();
  const detail = screen.getByRole('article', { name: 'Selected wallet item' });
  expect(within(detail).getByText('account/1/7')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'account/1/7' } });
  expect(within(records).getAllByRole('link')).toHaveLength(1);
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Wallet sections' })).getByRole('button', {
      name: /^Review/,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Addresses' }));
  expect((screen.getByRole('combobox', { name: 'Addresses' }) as HTMLSelectElement).value).toBe(
    'change',
  );
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('account/1/7');
});

it('opens the same address inspector from Review and preserves the selected address when its goal is answered', async () => {
  render(<Fixture addressActivity />);
  const change = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 1, 7, 1)[0];
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Wallet sections' })).getByRole('button', {
      name: /^Review/,
    }),
  );
  const records = screen.getByRole('list', { name: 'Review queue' });
  fireEvent.click(
    within(records).getByRole('link', { name: new RegExp(change.address.slice(0, 8)) }),
  );
  const detail = screen.getByRole('article', { name: 'Selected review item' });
  expect(within(detail).getByText('account/1/7')).toBeTruthy();
  expect(within(detail).getByRole('button', { name: 'Label review' })).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: 'Label review' }));
  expect(screen.getByText('What is this address for?')).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Label needs review' })).getByRole('button', {
      name: 'Add label',
    }),
  );
  const editor = await screen.findByRole('dialog', { name: 'Label selected records' });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Batch label' }), {
    target: { value: 'Project reserves' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: 'Apply label' }));
  expect(within(detail).getByText('account/1/7')).toBeTruthy();
  expect(within(detail).getByRole('button', { name: 'Edit label' }).textContent).toContain(
    'Project reserves',
  );
  expect(within(detail).queryByRole('button', { name: 'Label review' })).toBeNull();
});

it('opens a derived address directly from a transaction output while keeping the transaction list', () => {
  render(<Fixture />);
  const address = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address;
  const detail = screen.getByRole('article', { name: 'Selected wallet item' });
  fireEvent.click(within(detail).getByLabelText('Inputs and outputs').querySelector('summary')!);
  fireEvent.click(within(detail).getAllByRole('link', { name: `Open address ${address}` })[0]);
  expect(within(detail).getByText('account/0/0')).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Transactions records' })).toBeTruthy();
  fireEvent.click(within(detail).getByRole('button', { name: /Back$/ }));
  expect(within(detail).queryByText('account/0/0')).toBeNull();
});
it('filters address-description Review entries by branch without changing the saved browser choice', () => {
  render(<Fixture addressActivity addressReview />);
  const records = screen.getByRole('list', { name: 'Review queue' });
  expect(within(records).getAllByRole('link')).toHaveLength(3);
  fireEvent.change(screen.getByRole('combobox', { name: 'Addresses' }), {
    target: { value: 'change' },
  });
  expect(within(records).getAllByRole('link')).toHaveLength(1);
  expect(within(records).getByText('Change · Index 7')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Addresses' }));
  expect((screen.getByRole('combobox', { name: 'Addresses' }) as HTMLSelectElement).value).toBe(
    'receive',
  );
  expect(
    within(screen.getByRole('list', { name: 'Addresses records' })).getAllByRole('link'),
  ).toHaveLength(2);
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Wallet sections' })).getByRole('button', {
      name: /^Review/,
    }),
  );
  expect((screen.getByRole('combobox', { name: 'Addresses' }) as HTMLSelectElement).value).toBe(
    'change',
  );
  expect(
    within(screen.getByRole('list', { name: 'Review queue' })).getAllByRole('link'),
  ).toHaveLength(1);
});
it('restores browsing filters independently of the saved Review position', () => {
  render(<Fixture saved />);
  const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
  expect(tabs.getByRole('button', { name: /^Review/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(tabs.getByRole('button', { name: 'Transactions' }));
  expect(screen.getByRole('searchbox').getAttribute('value')).toBe(TX_FUNDING);
  fireEvent.click(tabs.getByRole('button', { name: /^Review/ }));
  expect(screen.getByRole('searchbox').getAttribute('value')).toBe('');
  fireEvent.click(tabs.getByRole('button', { name: 'Transactions' }));
  expect(screen.getByRole('searchbox').getAttribute('value')).toBe(TX_FUNDING);
});

it('opens the named counterparty editor without navigating away from transactions', () => {
  render(<Fixture />);
  fireEvent.click(screen.getAllByRole('button', { name: / recipients$/i })[0]);
  expect(screen.getByRole('dialog', { name: 'Recipients' })).toBeTruthy();
  expect(screen.getByRole('searchbox', { name: 'Search counterparties' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Transactions' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});
it.each(['Transactions', 'Coins', 'Addresses', 'Review'])(
  'keeps counterparty activity when inspecting from %s and scopes the Transactions jump',
  (tab) => {
    render(<Fixture counterparties receipt unspentReceipt />);
    const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
    fireEvent.click(tabs.getByRole('button', { name: new RegExp(`^${tab}`) }));
    const detail = screen.getByRole('article', { name: /Selected (wallet|review) item/ });
    fireEvent.click(within(detail).getAllByRole('link', { name: 'Public contact' })[0]);
    const party = screen.getByRole('region', { name: 'Counterparty details' });
    expect(within(party).getByText('1 transaction')).toBeTruthy();
    fireEvent.click(within(party).getByRole('button', { name: 'Show related transactions' }));
    const records = screen.getByRole('list', { name: 'Transactions records' });
    expect(within(records).getAllByRole('link')).toHaveLength(1);
    expect(
      within(records).getByRole('link', { name: new RegExp(TX_FUNDING.slice(0, 8)) }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Back to ${tab}`) }));
    expect(screen.getByRole('region', { name: 'Counterparty details' })).toBeTruthy();
  },
);
it('limits a transaction finding jump to its own review items', () => {
  render(<Fixture findings />);
  const row = within(screen.getByRole('list', { name: 'Transactions records' }))
    .getByRole('link', { name: new RegExp(TX_FUNDING.slice(0, 8)) })
    .closest('[role="listitem"]')!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^Review items/ }));
  const goals = screen.getByRole('region', { name: 'Review goals' });
  expect(within(goals).getByText('Receipt finding')).toBeTruthy();
  expect(within(goals).queryByText('Spending finding')).toBeNull();
});

it('preserves inspection and modifier selection through record links', () => {
  render(<Fixture />);
  const records = screen.getByRole('list', { name: 'Transactions records' });
  const receipt = within(records).getByRole('link', { name: new RegExp(TX_FUNDING.slice(0, 8)) });
  const payment = within(records).getByRole('link', { name: new RegExp(TX_SPENDING.slice(0, 8)) });
  fireEvent.click(payment);
  expect(payment.getAttribute('aria-current')).toBe('true');
  expect(receipt.getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('article', { name: 'Selected wallet item' })).toBeDefined();
  fireEvent.click(receipt, { ctrlKey: true });
  expect(
    (within(records).getByRole('checkbox', { name: `Select ${TX_FUNDING}` }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(screen.getByRole('article', { name: 'Batch selection details' })).toBeDefined();
  fireEvent.click(payment);
  expect(payment.getAttribute('aria-current')).toBe('true');
  expect(
    (within(records).getByRole('checkbox', { name: `Select ${TX_FUNDING}` }) as HTMLInputElement)
      .checked,
  ).toBe(false);
});

it('shows an icon-only annotation on the transaction row and selected record', () => {
  render(<Fixture />);
  const records = screen.getByRole('list', { name: 'Transactions records' });
  const record = within(records).getByRole('link', { name: new RegExp(TX_FUNDING.slice(0, 8)) });
  fireEvent.click(record);
  fireEvent.click(screen.getByRole('button', { name: 'Set icon: None' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Choose node icon' })).getByRole('button', {
      name: 'Star',
    }),
  );
  expect(within(record).getByText('★')).toBeDefined();
  const selected = screen.getByRole('article', { name: 'Selected wallet item' });
  expect(within(selected).getByRole('button', { name: 'Set icon: Star' }).textContent).toBe('★');
  expect(within(record).getByTitle(TX_FUNDING)).toBeDefined();
  expect(within(selected).getByRole('button', { name: 'Set icon: Star' })).toBeDefined();
});

it.each([
  [TX_FUNDING, 'Sender review', 'Senders'],
  [TX_SPENDING, 'Recipient review', 'Recipients'],
])('identifies who was involved in %s without answering its purpose', (txid, question, title) => {
  render(<Fixture receipt />);
  const records = screen.getByRole('list', { name: 'Transactions records' });
  const record = within(records).getByRole('link', { name: new RegExp(txid.slice(0, 8)) });
  fireEvent.click(
    within(record.closest('[role="listitem"]') as HTMLElement).getByRole('button', {
      name: /^Review items/,
    }),
  );
  const inspector = screen.getByRole('article', { name: 'Selected review item' });
  const chip = within(inspector).getByRole('button', { name: question });
  if (chip.getAttribute('aria-expanded') !== 'true') {
    // Close the review opened by the navigation jump before choosing another field.
    for (const dialog of screen.queryAllByRole('dialog'))
      fireEvent.click(within(dialog).getByRole('button', { name: /^Close / }));
    fireEvent.click(chip);
  }
  const review = screen.getByRole('dialog');
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  fireEvent.click(within(review).getByRole('button', { name: /^Add / }));
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => frames.splice(0).forEach((callback) => callback(0)));
  const editor = screen.getByRole('dialog', { name: title });
  fireEvent.change(within(editor).getByRole('searchbox', { name: 'Search counterparties' }), {
    target: { value: 'Public fixture contact' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: /Create/ }));
  expect(within(inspector).queryByRole('button', { name: question })).toBeNull();
  expect(within(inspector).getByRole('button', { name: 'Label review' })).toBeTruthy();
  expect(within(inspector).getByRole('link', { name: 'Public fixture contact' })).toBeTruthy();
  expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
  fireEvent.click(within(editor).getByRole('button', { name: `Close ${title.toLowerCase()}` }));
  expect(screen.queryByRole('dialog', { name: title })).toBeNull();
  expect(
    within(within(inspector).getByRole('heading', { level: 2 })).getByTitle(txid),
  ).toBeTruthy();
});

it('selects matching records from the first list header checkbox and retains selections outside a filter when clearing', () => {
  render(<Fixture />);
  const records = screen.getByRole('list', { name: 'Transactions records' });
  const all = within(records).getByRole('checkbox', {
    name: 'Select all matching records (2)',
  }) as HTMLInputElement;
  expect(records.firstElementChild?.contains(all)).toBe(true);
  expect(within(records.firstElementChild as HTMLElement).getByText('2/2 shown')).toBeTruthy();
  const funding = within(records).getByRole('checkbox', {
    name: `Select ${TX_FUNDING}`,
  }) as HTMLInputElement;
  const spending = within(records).getByRole('checkbox', {
    name: `Select ${TX_SPENDING}`,
  }) as HTMLInputElement;
  fireEvent.click(funding);
  expect(all.indeterminate).toBe(true);
  expect(all.getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(all);
  expect(all.checked).toBe(true);
  expect(funding.checked).toBe(true);
  expect(spending.checked).toBe(true);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter wallet records' }), {
    target: { value: TX_FUNDING },
  });
  const filteredAll = within(records).getByRole('checkbox', {
    name: 'Select all matching records (1)',
  }) as HTMLInputElement;
  expect(filteredAll.checked).toBe(true);
  fireEvent.click(filteredAll);
  fireEvent.click(screen.getByRole('button', { name: 'Clear wallet filters' }));
  expect(
    (within(records).getByRole('checkbox', { name: `Select ${TX_FUNDING}` }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(
    (within(records).getByRole('checkbox', { name: `Select ${TX_SPENDING}` }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter wallet records' }), {
    target: { value: 'no matching transaction' },
  });
  expect(
    (
      within(records).getByRole('checkbox', {
        name: 'Select all matching records (0)',
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  expect(within(records).getByText('0/0 shown')).toBeTruthy();
});

it('hides an answered purpose question and restores it when the description is removed', () => {
  render(<Fixture />);
  const record = within(screen.getByRole('list', { name: 'Transactions records' })).getByRole(
    'link',
    { name: new RegExp(TX_FUNDING.slice(0, 8)) },
  );
  fireEvent.click(
    within(record.closest('[role="listitem"]') as HTMLElement).getByRole('button', {
      name: /^Review items/,
    }),
  );
  const inspector = screen.getByRole('article', { name: 'Selected review item' });
  expect(within(inspector).getByRole('button', { name: 'Label review' })).toBeTruthy();
  fireEvent.click(within(inspector).getByRole('button', { name: / label$/i }));
  const editor = screen.getByRole('dialog', { name: 'Label selected records' });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Batch label' }), {
    target: { value: 'Public fixture income' },
  });
  fireEvent.click(within(editor).getByRole('button', { name: 'Apply label' }));
  expect(within(inspector).queryByRole('button', { name: 'Label review' })).toBeNull();
  expect(within(inspector).getByRole('button', { name: 'Edit label' }).textContent).toBe(
    'Public fixture income',
  );
  expect(
    within(within(inspector).getByRole('heading', { level: 2 })).getByTitle(TX_FUNDING),
  ).toBeTruthy();
  fireEvent.click(within(inspector).getByRole('button', { name: / label$/i }));
  const current = screen.getByRole('dialog', { name: 'Label selected records' });
  expect(
    (within(current).getByRole('textbox', { name: 'Batch label' }) as HTMLInputElement).value,
  ).toBe('Public fixture income');
  fireEvent.change(within(current).getByRole('textbox', { name: 'Batch label' }), {
    target: { value: '' },
  });
  fireEvent.click(within(current).getByRole('button', { name: 'Apply label' }));
  expect(within(inspector).getByRole('button', { name: 'Label review' })).toBeTruthy();
  expect(within(inspector).getByRole('button', { name: / label$/i })).toBeTruthy();
});

it('follows a historical wallet input and returns without changing the filtered list', () => {
  render(<Fixture />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter wallet records' }), {
    target: { value: TX_SPENDING },
  });
  const records = screen.getByRole('list', { name: 'Transactions records' });
  const payment = within(records).getByRole('link', { name: new RegExp(TX_SPENDING.slice(0, 8)) });
  fireEvent.click(payment);
  const inspector = screen.getByRole('article', { name: 'Selected wallet item' });
  const io = within(inspector).getByRole('group', { name: 'Inputs and outputs' });
  fireEvent.click(within(io).getByText(/Inputs \(2\) \/ Outputs \(2\)/));
  const input = within(io).getByRole('link', { name: `Open output ${TX_FUNDING}:0` });
  fireEvent.click(input);
  expect(
    within(within(inspector).getByRole('heading', { level: 2 })).getByTitle(`${TX_FUNDING}:0`),
  ).toBeTruthy();
  expect(payment.getAttribute('aria-current')).toBe('true');
  expect(
    (screen.getByRole('searchbox', { name: 'Filter wallet records' }) as HTMLInputElement).value,
  ).toBe(TX_SPENDING);
  expect(within(records).getAllByRole('link')).toHaveLength(1);
  fireEvent.click(within(inspector).getByRole('button', { name: '← Back' }));
  expect(
    within(within(inspector).getByRole('heading', { level: 2 })).getByTitle(TX_SPENDING),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: '← Back' })).toBeNull();
  const disclosures = [...inspector.querySelectorAll('details')];
  expect(
    disclosures.findIndex((item) => item.getAttribute('aria-label') === 'Inputs and outputs'),
  ).toBeLessThan(
    disclosures.findIndex((item) => item.getAttribute('aria-label') === 'Wallet accounting'),
  );
});

it('retains the selected finding after a decision so it can be reopened', () => {
  render(<Fixture findings />);
  const record = within(screen.getByRole('list', { name: 'Transactions records' })).getByRole(
    'link',
    { name: new RegExp(TX_FUNDING.slice(0, 8)) },
  );
  fireEvent.click(
    within(record.closest('[role="listitem"]') as HTMLElement).getByRole('button', {
      name: /^Review items/,
    }),
  );
  const inspector = screen.getByRole('article', { name: 'Selected review item' });
  fireEvent.click(within(inspector).getByRole('button', { name: 'Mark reviewed' }));
  expect(
    within(within(inspector).getByRole('heading', { level: 2 })).getByTitle(TX_FUNDING),
  ).toBeTruthy();
  expect(within(inspector).getByText('Reviewed')).toBeTruthy();
  fireEvent.click(within(inspector).getByRole('button', { name: 'Reopen' }));
  expect(within(inspector).queryByText('Reviewed')).toBeNull();
  expect(within(inspector).queryByText('Spending finding')).toBeNull();
});

it('restores checked rows, inspection, filters and scroll independently across ordinary tabs', () => {
  render(<Fixture addressActivity />);
  const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
  const section = screen.getByRole('region', { name: 'Wallet review workbench' });
  const records = screen.getByRole('list', { name: 'Transactions records' });
  fireEvent.click(within(records).getByRole('link', { name: new RegExp(TX_SPENDING.slice(0, 8)) }));
  fireEvent.click(within(records).getByRole('checkbox', { name: `Select ${TX_FUNDING}` }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: TX_SPENDING } });
  fireEvent.scroll(section, { target: { scrollTop: 300 } });
  fireEvent.click(tabs.getByRole('button', { name: 'Addresses' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Addresses' }), {
    target: { value: 'change' },
  });
  const change = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 1, 7, 1)[0].address;
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${change}` }));
  fireEvent.scroll(section, { target: { scrollTop: 100 } });
  fireEvent.click(tabs.getByRole('button', { name: 'Transactions' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(TX_SPENDING);
  expect(section.scrollTop).toBe(300);
  expect(screen.getByRole('article', { name: 'Batch selection details' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear wallet filters' }));
  expect(
    (screen.getByRole('checkbox', { name: `Select ${TX_FUNDING}` }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(
    within(screen.getByRole('list', { name: 'Transactions records' }))
      .getByRole('link', { name: new RegExp(TX_SPENDING.slice(0, 8)) })
      .getAttribute('aria-current'),
  ).toBe('true');
  fireEvent.click(tabs.getByRole('button', { name: 'Addresses' }));
  expect((screen.getByRole('combobox', { name: 'Addresses' }) as HTMLSelectElement).value).toBe(
    'change',
  );
  expect(
    (screen.getByRole('checkbox', { name: `Select ${change}` }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(section.scrollTop).toBe(100);
});

it('resumes a linked inspector when returning to its tab and keeps its Back action', () => {
  render(<Fixture />);
  const detail = screen.getByRole('article', { name: 'Selected wallet item' });
  const address = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address;
  fireEvent.click(within(detail).getByLabelText('Inputs and outputs').querySelector('summary')!);
  fireEvent.click(within(detail).getAllByRole('link', { name: `Open address ${address}` })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Addresses' }));
  fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
  const resumed = screen.getByRole('article', { name: 'Selected wallet item' });
  expect(within(resumed).getByText('account/0/0')).toBeTruthy();
  fireEvent.click(within(resumed).getByRole('button', { name: /Back$/ }));
  expect(within(resumed).queryByText('account/0/0')).toBeNull();
  expect(screen.getByRole('list', { name: 'Transactions records' })).toBeTruthy();
});

it('returns from nested related Transactions and Review while restoring the destination batch and keeping edits', () => {
  render(<Fixture counterparties findings receipt />);
  const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${TX_SPENDING}` }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: TX_SPENDING } });
  fireEvent.click(tabs.getByRole('button', { name: 'Counterparties' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find counterparties' }), {
    target: { value: 'contact' },
  });
  fireEvent.click(
    within(screen.getByRole('list', { name: 'Counterparty records' })).getByRole('link', {
      name: 'Public contact',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show related transactions' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  expect(
    within(screen.getByRole('list', { name: 'Transactions records' })).getAllByRole('link'),
  ).toHaveLength(1);
  const row = within(screen.getByRole('list', { name: 'Transactions records' }))
    .getByRole('link', { name: new RegExp(TX_FUNDING.slice(0, 8)) })
    .closest('[role="listitem"]')!;
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^Review items/ }));
  const detail = screen.getByRole('article', { name: 'Selected review item' });
  fireEvent.click(within(detail).getByRole('button', { name: / note$/i }));
  const note = screen.getByRole('textbox', { name: 'Entity notes' });
  fireEvent.change(note, { target: { value: 'Kept after returning' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close notes editor' }));
  fireEvent.click(screen.getByRole('button', { name: /Back to Transactions/ }));
  expect(
    within(screen.getByRole('article', { name: 'Selected wallet item' })).getByText(
      'Kept after returning',
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Back to Counterparties/ }));
  expect(
    (screen.getByRole('searchbox', { name: 'Find counterparties' }) as HTMLInputElement).value,
  ).toBe('contact');
  expect(
    within(screen.getByRole('list', { name: 'Counterparty records' }))
      .getByRole('link', { name: 'Public contact' })
      .getAttribute('aria-current'),
  ).toBe('true');
  fireEvent.click(tabs.getByRole('button', { name: 'Transactions' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(TX_SPENDING);
  expect(
    (screen.getByRole('checkbox', { name: `Select ${TX_SPENDING}` }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(screen.queryByRole('button', { name: /Back to Counterparties/ })).toBeNull();
  expect(screen.queryByText(/^Related activity/)).toBeNull();
});

it('returns a review jump to the original batch and focuses its restored selection details', () => {
  render(<Fixture findings />);
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${TX_SPENDING}` }));
  const row = within(screen.getByRole('list', { name: 'Transactions records' }))
    .getByRole('link', { name: new RegExp(TX_FUNDING.slice(0, 8)) })
    .closest('[role="listitem"]')!;
  const trigger = within(row as HTMLElement).getByRole('button', { name: /^Review items/ });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: /Back to Transactions/ }));
  const batch = screen.getByRole('article', { name: 'Batch selection details' });
  expect(
    (screen.getByRole('checkbox', { name: `Select ${TX_SPENDING}` }) as HTMLInputElement).checked,
  ).toBe(true);
  expect(document.activeElement).toBe(within(batch).getByRole('heading', { level: 2 }));
});

it('keeps inspector Back next to a related record opened inside a temporary transaction view', () => {
  render(<Fixture counterparties receipt />);
  const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
  fireEvent.click(tabs.getByRole('button', { name: 'Counterparties' }));
  fireEvent.click(
    within(screen.getByRole('list', { name: 'Counterparty records' })).getByRole('link', {
      name: 'Public contact',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show related transactions' }));
  const detail = screen.getByRole('article', { name: 'Selected wallet item' });
  const address = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address;
  fireEvent.click(within(detail).getByLabelText('Inputs and outputs').querySelector('summary')!);
  fireEvent.click(within(detail).getAllByRole('link', { name: `Open address ${address}` })[0]);
  expect(screen.getByRole('button', { name: /Back to Counterparties/ })).toBeTruthy();
  expect(within(detail).queryByRole('button', { name: /Back to Counterparties/ })).toBeNull();
  fireEvent.click(within(detail).getByRole('button', { name: /Back$/ }));
  expect(
    within(within(detail).getByRole('heading', { level: 2 })).getByTitle(TX_FUNDING),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Back to Counterparties/ }));
  expect(
    within(screen.getByRole('list', { name: 'Counterparty records' }))
      .getByRole('link', { name: 'Public contact' })
      .getAttribute('aria-current'),
  ).toBe('true');
});

it('clears the temporary return after repeating Show in Transactions through a manual tab switch', () => {
  render(<Fixture counterparties receipt />);
  const tabs = within(screen.getByRole('navigation', { name: 'Wallet sections' }));
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${TX_SPENDING}` }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: TX_SPENDING } });
  fireEvent.click(tabs.getByRole('button', { name: 'Counterparties' }));
  fireEvent.click(
    within(screen.getByRole('list', { name: 'Counterparty records' })).getByRole('link', {
      name: 'Public contact',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show related transactions' }));
  fireEvent.click(tabs.getByRole('button', { name: 'Counterparties' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show related transactions' }));
  const detail = screen.getByRole('article', { name: 'Selected wallet item' });
  const address = deriveAddresses(PUBLIC_ZPUB, 'mainnet', 'p2wpkh', 0, 0, 1)[0].address;
  fireEvent.click(within(detail).getByLabelText('Inputs and outputs').querySelector('summary')!);
  fireEvent.click(within(detail).getAllByRole('link', { name: `Open address ${address}` })[0]);
  fireEvent.click(screen.getByRole('button', { name: /Back to Counterparties/ }));
  expect(
    within(screen.getByRole('list', { name: 'Counterparty records' }))
      .getByRole('link', { name: 'Public contact' })
      .getAttribute('aria-current'),
  ).toBe('true');
  fireEvent.click(tabs.getByRole('button', { name: 'Transactions' }));
  expect(screen.queryByRole('button', { name: /Back/ })).toBeNull();
  expect(screen.queryByText(/^Related activity/)).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe(TX_SPENDING);
  expect(
    (screen.getByRole('checkbox', { name: `Select ${TX_SPENDING}` }) as HTMLInputElement).checked,
  ).toBe(true);
});

it('keeps the context return available after clearing a related transaction scope', () => {
  render(<Fixture counterparties receipt />);
  fireEvent.click(screen.getByRole('button', { name: 'Counterparties' }));
  fireEvent.click(
    within(screen.getByRole('list', { name: 'Counterparty records' })).getByRole('link', {
      name: 'Public contact',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show related transactions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear scope' }));
  expect(screen.queryByText(/^Related activity/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Clear scope' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Back to Counterparties/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));
  expect(screen.queryByRole('button', { name: /Back to Counterparties/ })).toBeNull();
});
