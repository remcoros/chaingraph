// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { GraphContextToolbar } from './GraphContextToolbar';

afterEach(cleanup);

describe('GraphContextToolbar address actions', () => {
  it('keeps complete output and last-five transaction scopes in compact controls', () => {
    const showOutputs = vi.fn();
    const showLastTransactions = vi.fn();
    render(
      <GraphContextToolbar
        selectedKind="address"
        canShowOutputs
        outputCount={3}
        onShowOutputs={showOutputs}
        canShowLastTransactions
        lastTransactionCount={2}
        onShowLastTransactions={showLastTransactions}
        onAddSide={() => {}}
        onHideSide={() => {}}
        onRemoveSide={() => {}}
        hideSelectionCount={0}
        removeSelectionCount={0}
        onHideSelection={() => {}}
        onRemoveSelection={() => {}}
        canHideBranch={false}
        canRemoveBranch={false}
        onHideBranch={() => {}}
        onRemoveBranch={() => {}}
        unconnectedCount={0}
        removableOutputCount={0}
        showAllOutputCount={0}
        onHideUnconnected={() => {}}
        onRemoveUnconnected={() => {}}
        onShowAllOutputs={() => {}}
      />,
    );

    const outputs = screen.getByRole('button', { name: 'Show outputs (3)' });
    expect(outputs.textContent).toBe('(3)');
    expect(outputs.classList.contains('graph-context-wide-action')).toBe(false);
    expect(outputs.querySelector('.lucide-arrow-right-from-line')).not.toBeNull();
    fireEvent.click(outputs);
    expect(showOutputs).toHaveBeenCalledOnce();

    const transactions = screen.getByRole('button', { name: 'Show last 5 transactions (2)' });
    expect(transactions.textContent).toBe('(2)');
    expect(transactions.classList.contains('graph-context-wide-action')).toBe(false);
    fireEvent.click(transactions);
    expect(showLastTransactions).toHaveBeenCalledOnce();
  });
});
