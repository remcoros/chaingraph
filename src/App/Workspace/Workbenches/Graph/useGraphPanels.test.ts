import { describe, expect, it } from 'vitest';
import { graphPanelsInView, resolveGraphPanelState } from './useGraphPanels';

describe('graph panel state', () => {
  it('resolves a complete runtime state from an empty saved view', () => {
    expect(resolveGraphPanelState(undefined)).toEqual({
      left: { tab: 'wallets', collapsed: false },
      right: { tab: 'inspect', collapsed: false },
      flow: {},
      mobile: 'graph',
    });
  });

  it('applies tour panel previews without changing the saved state', () => {
    const saved = resolveGraphPanelState({
      left: { tab: 'tags', collapsed: true },
      right: { tab: 'scan', collapsed: true },
      flow: { height: 'collapsed', transactionId: 'txid' },
      mobile: 'left',
    });

    expect(
      graphPanelsInView(saved, {
        preview: { panel: 'graph', leftTab: 'entities', flowOpen: true },
        previewing: true,
        hasSelectedWallet: true,
      }),
    ).toEqual({
      left: { tab: 'entities', collapsed: false },
      right: { tab: 'scan', collapsed: false },
      flow: { height: 'expanded', transactionId: 'txid' },
      mobile: 'graph',
    });
    expect(saved).toEqual({
      left: { tab: 'tags', collapsed: true },
      right: { tab: 'scan', collapsed: true },
      flow: { height: 'collapsed', transactionId: 'txid' },
      mobile: 'left',
    });
  });

  it('shows Inspector when a saved wallet record tab has no wallet', () => {
    const saved = resolveGraphPanelState({ right: { tab: 'transactions' } });

    expect(
      graphPanelsInView(saved, {
        preview: undefined,
        previewing: false,
        hasSelectedWallet: false,
      }).right.tab,
    ).toBe('inspect');
  });
});
