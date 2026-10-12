import { formatSats } from '../../../../../Core/Formatting';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BatchMetadataBar } from './BatchMetadataBar';
import { IconPicker } from '../../../../Controls/Metadata/IconPicker';
import { SelectionToolbar } from '../../../Selection/SelectionToolbar';
import { WalletReviewFlow } from './WalletReviewFlow';
import type { WalletReviewContext, WalletReviewFlowEntry } from '../walletReviewContext';
import { createWorkspace } from '../../../../../Core/Workspace/createWorkspace';
import { buildWalletReviewContext } from '../walletReviewContext';
import { transactions, TX_SPENDING } from '../../../../../../tests/fixtures/bitcoin';

const txid = 'a'.repeat(64);
const parentId = 'b'.repeat(64);
const output = (index: number, tx = txid): WalletReviewFlowEntry => ({
  id: `out:${tx}:${index}`,
  ownership: index === 0 ? 'wallet' : 'external',
  valueSats: 123456789,
  selected: false,
  missing: false,
});
const context = (): WalletReviewContext => ({
  status: 'loaded',
  transactionId: txid,
  transactionNodeId: `tx:${txid}`,
  transactionSelected: false,
  inputs: [output(0, parentId)],
  outputs: [output(0), output(1)],
  currentOutputs: [],
  role: 'wallet-related-transaction',
  missingPrevouts: 0,
});
const renderFlow = (
  flow: WalletReviewContext,
  editedNodeId?: string,
  workspace = createWorkspace('Flow controls test', 'mainnet'),
) =>
  renderToStaticMarkup(
    createElement(WalletReviewFlow, {
      context: flow,
      workspace,
      editedNodeId,
    }),
  );

describe('Wallet transaction flow controls', () => {
  it('keeps flow cards informational while retaining exact copies and values', () => {
    const html = renderFlow(context(), `out:${txid}:0`);
    expect(html).not.toMatch(/<button[^>]*class="wallet-flow-node/);
    expect(html).not.toMatch(/aria-label="Show [^"]+ on graph"/);
    expect(html).toContain(`title="${formatSats(123_456_789)}"`);
    expect(html).toContain('Editing output');
    expect(html).toContain('Your wallet');
    expect(html).not.toContain('No wallet match');
    expect(html).toContain('aria-label="Copy outpoint"');
    expect(html).toContain('aria-label="Copy transaction ID"');
  });

  it('marks the edited input or transaction rather than treating every selection as an output', () => {
    const input = renderFlow(context(), `out:${parentId}:0`);
    expect(input).toContain('Editing input');
    expect(input).not.toContain('Editing output');
    const transaction = renderFlow(context(), `tx:${txid}`);
    expect(transaction).toContain('wallet-flow-transaction-node is-selected');
    expect(transaction).toContain('Editing transaction');
    expect(transaction).not.toContain('Editing input');
  });

  it('keeps the edited entity in a bounded collapsed list even at the end of a large transaction', () => {
    const flow = context();
    flow.outputs = Array.from({ length: 1000 }, (_, index) => output(index));
    const html = renderFlow(flow, `out:${txid}:999`);
    expect(html).toContain(`title="${txid}:999"`);
    expect(html).not.toContain(`title="${txid}:998"`);
    expect(html.match(/data-flow-entry=/g)).toHaveLength(3);
    expect(html).toContain('Outputs <b>1000</b>');
    expect(html).toContain('aria-label="Expand outputs" aria-expanded="false"');
  });

  it('does not invent an outpoint or offer graph navigation for coinbase inputs', () => {
    const flow = context();
    flow.inputs = [
      {
        id: `tx:${txid}`,
        ownership: 'unknown',
        selected: false,
        missing: false,
        coinbase: true,
      },
    ];
    const html = renderFlow(flow, `tx:${txid}`);
    expect(html).toContain('Newly mined coins');
    expect(html.match(/aria-label="Copy outpoint"/g)).toHaveLength(2);
    expect(html).toContain('Editing transaction');
  });

  it('identifies an edited address without implying that its output annotation is being edited', () => {
    const flow = context();
    flow.outputs[0].address = 'matched-address';
    flow.outputs[0].selected = true;
    flow.selectedNodeId = 'addr:matched-address';
    const html = renderFlow(flow);
    expect(html).toContain('Editing address');
    expect(html).not.toContain('Editing output');
    expect(html).not.toContain('Editing transaction');
    expect(html).toContain('aria-label="Copy address"');
  });

  it('keeps an unresolved input without an outpoint unknown and non-actionable', () => {
    const flow = context();
    flow.inputs = [{ id: `tx:${txid}`, ownership: 'unknown', selected: false, missing: true }];
    const html = renderFlow(flow, `tx:${txid}`);
    expect(html).toContain('Unknown');
    expect(html).toContain('Value not loaded');
    expect(html).not.toContain('Editing input');
  });

  it('shows exact transaction annotations, block time and independently calculated fee values', () => {
    const workspace = createWorkspace('Flow transaction facts', 'mainnet');
    workspace.chainData.transactions = structuredClone(transactions);
    workspace.chainData.transactions[TX_SPENDING].status = {
      kind: 'confirmed',
      blockHeight: 800000,
      blocktime: 1690168629,
    };
    const id = `tx:${TX_SPENDING}`;
    workspace.annotations.entities[id] = {
      icon: '★',
      label: 'Invoice payment',
      note: '',
      bookmarked: false,
    };
    workspace.annotations.tags = [
      { id: 'invoice', name: 'Invoice', color: '#ffaa00', nodeIds: [id] },
    ];
    const flow = buildWalletReviewContext(workspace, { addresses: [] }, { nodeId: id });
    const html = renderFlow(flow, id, workspace);
    expect(html).toContain('★');
    expect(html).toContain('Invoice payment');
    expect(html).toContain('title="Invoice"');
    expect(html).toContain('#800000');
    expect(html).toContain('dateTime="2023-07-24T03:17:09.000Z"');
    expect(html).toContain('48.08 sat/vB');
    expect(html).toContain(formatSats(10000));
    // A missing block timestamp must not also hide the independently known fee.
    flow.transaction = { ...flow.transaction!, status: { kind: 'confirmed', blockHeight: 800000 } };
    const withoutTime = renderFlow(flow, id, workspace);
    expect(withoutTime).not.toContain('<time');
    expect(withoutTime).toContain('48.08 sat/vB');
    expect(withoutTime).toContain(formatSats(10000));
    const incomplete = renderFlow(flow, id, createWorkspace('Missing fee evidence', 'mainnet'));
    expect(incomplete).toContain('Fee unknown');
    expect(incomplete).not.toContain('48.08 sat/vB');
  });
});

describe('Compact metadata icon controls', () => {
  it('renders one icon-and-caption button with field and current value in its accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(IconPicker, {
        compact: true,
        value: '★',
        fieldLabel: 'Set icon',
        onChange: vi.fn(),
      }),
    );
    expect(html).not.toContain('icon-picker-label');
    expect(html).toContain('aria-label="Set icon: Star"');
    expect(html).toContain('★</span><span>Icon</span>');
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('shows the common batch icon, distinguishes mixed and empty values, and honors inactivity', () => {
    const workspace = createWorkspace('Batch controls test', 'mainnet');
    const ids = [`out:${txid}:0`, `out:${txid}:1`];
    for (const id of ids)
      workspace.annotations.entities[id] = { icon: '★', label: '', note: '', bookmarked: false };
    const render = (active = true) =>
      renderToStaticMarkup(
        createElement(BatchMetadataBar, {
          workspace,
          ids,
          active,
          scopeLabel: 'outputs',
          onChange: vi.fn(),
          onNotice: vi.fn(),
        }),
      );
    expect(render()).toContain('aria-label="Set icon: Star"');
    workspace.annotations.entities[ids[1]].icon = '';
    expect(render()).toContain('aria-label="Set icon: Mixed"');
    workspace.annotations.entities[ids[0]].icon = '';
    expect(render()).toContain('aria-label="Set icon: None"');
    expect(render()).toContain('Replace icons');
    expect(render(false)).toBe('');
  });

  it('keeps the existing Inspector picker presentation unchanged', () => {
    const html = renderToStaticMarkup(createElement(IconPicker, { value: '', onChange: vi.fn() }));
    expect(html).toContain('icon-picker-label');
    expect(html).toContain('aria-label="Node icon: None"');
    expect(html).not.toContain('icon-picker-compact');
  });

  it('shows a common or mixed icon in the graph selection toolbar with its explicit scope', () => {
    const workspace = createWorkspace('Graph selection test', 'mainnet');
    const ids = [`out:${txid}:0`, `out:${txid}:1`];
    for (const id of ids)
      workspace.annotations.entities[id] = { icon: '★', label: '', note: '', bookmarked: false };
    const render = () =>
      renderToStaticMarkup(
        createElement(SelectionToolbar, {
          workspace,
          selection: {
            ids,
            mode: true,
            count: 2,
            setMode: vi.fn(),
            has: () => true,
            toggle: vi.fn(),
            replace: vi.fn(),
            remove: vi.fn(),
            clear: vi.fn(),
          },
          visibleSelectedCount: 2,
          hiddenSelectedCount: 0,
          undoToken: 0,
          onApply: vi.fn(),
          onSetHidden: vi.fn(),
          onIsolate: vi.fn(),
          onUndo: vi.fn(),
        }),
      );
    expect(render()).toContain('aria-label="Set an icon on 2 selected entities: Star"');
    expect(render()).not.toContain('icon-picker-label');
    workspace.annotations.entities[ids[1]].icon = '';
    expect(render()).toContain('aria-label="Set an icon on 2 selected entities: Mixed"');
  });
});
