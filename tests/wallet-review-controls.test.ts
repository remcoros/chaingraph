import { formatSats } from '../src/domain/amountFormat';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BatchMetadataBar } from '../src/components/BatchMetadataBar';
import { IconPicker } from '../src/components/IconPicker';
import { SelectionToolbar } from '../src/components/SelectionToolbar';
import { WalletReviewFlow } from '../src/components/WalletReviewFlow';
import type { WalletReviewContext, WalletReviewFlowEntry } from '../src/domain/walletReviewContext';
import { newWorkspace } from '../src/domain/workspace';

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
const renderFlow = (flow: WalletReviewContext, editedNodeId?: string) =>
  renderToStaticMarkup(
    createElement(WalletReviewFlow, {
      context: flow,
      workspace: newWorkspace('Flow controls test', 'mainnet'),
      walletName: 'Test wallet',
      editedNodeId,
      onShowInGraph: vi.fn(),
    }),
  );

describe('Wallet transaction flow controls', () => {
  it('uses non-clickable cards with identity-specific graph magnifiers and full values', () => {
    const html = renderFlow(context(), `out:${txid}:0`);
    expect(html).not.toMatch(/<button[^>]*class="wallet-flow-node/);
    expect(html.match(/class="wallet-flow-show"/g)).toHaveLength(4);
    expect(html).toContain(`aria-label="Show transaction ${txid} on graph"`);
    expect(html).toContain(`aria-label="Show input ${parentId}:0 on graph"`);
    expect(html).toContain(`aria-label="Show output ${txid}:0 on graph"`);
    expect(html).toContain('title="Show on graph"');
    expect(html).toContain(`title="${formatSats(123_456_789)}"`);
    expect(html).toContain('Editing output');
    expect(html).toContain('Your wallet');
    expect(html).toContain('No wallet match');
    expect(html).toMatch(
      /<span[^>]*class="wallet-help"[^>]*role="img"[^>]*aria-label="Wallet flow evidence"/,
    );
    expect(html).not.toMatch(/<button[^>]*class="[^"]*wallet-help/);
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
    expect(html).toContain(`aria-label="Show output ${txid}:999 on graph"`);
    expect(html).not.toContain(`aria-label="Show output ${txid}:998 on graph"`);
    expect(html.match(/class="wallet-flow-show"/g)).toHaveLength(4);
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
    expect(html).toContain(
      `aria-label="Coinbase input for ${txid} has no previous output" disabled=""`,
    );
    expect(html).not.toContain(`aria-label="Show input ${txid}`);
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
    expect(html).toContain(`aria-label="Show output ${txid}:0 on graph"`);
  });

  it('keeps an unresolved input without an outpoint unknown and non-actionable', () => {
    const flow = context();
    flow.inputs = [{ id: `tx:${txid}`, ownership: 'unknown', selected: false, missing: true }];
    const html = renderFlow(flow, `tx:${txid}`);
    expect(html).toContain(`aria-label="Input for ${txid} has no known outpoint" disabled=""`);
    expect(html).toContain('Unknown');
    expect(html).not.toContain('Editing input');
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
    const workspace = newWorkspace('Batch controls test', 'mainnet');
    const ids = [`out:${txid}:0`, `out:${txid}:1`];
    for (const id of ids)
      workspace.annotations[id] = { icon: '★', label: '', note: '', bookmarked: false };
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
    workspace.annotations[ids[1]].icon = '';
    expect(render()).toContain('aria-label="Set icon: Mixed"');
    workspace.annotations[ids[0]].icon = '';
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
    const workspace = newWorkspace('Graph selection test', 'mainnet');
    const ids = [`out:${txid}:0`, `out:${txid}:1`];
    for (const id of ids)
      workspace.annotations[id] = { icon: '★', label: '', note: '', bookmarked: false };
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
    workspace.annotations[ids[1]].icon = '';
    expect(render()).toContain('aria-label="Set an icon on 2 selected entities: Mixed"');
  });
});
