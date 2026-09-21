import { expect, it } from 'vitest';
import { assertWorkspaceBudget } from './budgets';
import { MAX_WALLET_HISTORY_ENTRIES } from './Wallets/wallets';

it('rejects aggregate wallet address history before schema parsing', () => {
  expect(() =>
    assertWorkspaceBudget({
      chainData: {},
      wallets: {
        definitions: [
          {
            addresses: [{ history: Array.from({ length: MAX_WALLET_HISTORY_ENTRIES + 1 }) }],
          },
        ],
      },
    }),
  ).toThrow(`at most ${MAX_WALLET_HISTORY_ENTRIES.toLocaleString('en-US')} wallet address history`);
});

it('does not enumerate a malformed chain-data scalar before schema validation rejects it', () => {
  expect(() => assertWorkspaceBudget({ chainData: 'not a chain-data record' })).not.toThrow();
});
