import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../Core/ChainData';
import { createWorkspace } from '../../../Core/Workspace/createWorkspace';
import {
  TransactionBlockTime,
  TransactionBlockTimeSeparated,
  TransactionBlockTimeWithFee,
  TransactionTimestamp,
  TransactionTimestampWithFee,
} from './TransactionBlockTime';

function fixture() {
  const workspace = createWorkspace('Transaction display fixture', 'mainnet');
  const parent: Transaction = {
    txid: 'a'.repeat(64),
    vin: [],
    vout: [{ n: 0, value: 0.00001, scriptPubKey: { hex: '0014' } }],
  };
  const transaction: Transaction = {
    txid: 'b'.repeat(64),
    vin: [{ txid: parent.txid, vout: 0 }],
    vout: [{ n: 0, value: 0.00000826, scriptPubKey: { hex: '0014' } }],
    vsize: 1740,
    status: { kind: 'confirmed', blockHeight: 800000, blocktime: 1690168629 },
  };
  workspace.chainData.transactions = { [parent.txid]: parent, [transaction.txid]: transaction };
  return { workspace, transaction };
}

const variants = [
  { Component: TransactionBlockTime, status: true, fee: false, separated: false, separators: 0 },
  {
    Component: TransactionBlockTimeWithFee,
    status: true,
    fee: true,
    separated: false,
    separators: 1,
  },
  {
    Component: TransactionBlockTimeSeparated,
    status: true,
    fee: false,
    separated: true,
    separators: 1,
  },
  { Component: TransactionTimestamp, status: false, fee: false, separated: false, separators: 0 },
  {
    Component: TransactionTimestampWithFee,
    status: false,
    fee: true,
    separated: true,
    separators: 1,
  },
] satisfies {
  Component: ComponentType<ReturnType<typeof fixture>>;
  status: boolean;
  fee: boolean;
  separated: boolean;
  separators: number;
}[];

describe('transaction display variants', () => {
  it.each(variants)(
    'preserves confirmed metadata for $Component.name',
    ({ Component, status, fee, separated, separators }) => {
      const html = renderToStaticMarkup(createElement(Component, fixture()));
      expect(html.includes('#800000')).toBe(status);
      expect(html).toContain('<time dateTime="2023-07-24T03:17:09.000Z"');
      expect(html).toContain('Block timestamp: 2023-07-24 03:17:09. Not the exact payment time.');
      expect(html.includes('0.10 sat/vB')).toBe(fee);
      expect(html.includes('transaction-block-time-separated')).toBe(separated);
      expect(html.match(/aria-hidden="true">·/g) ?? []).toHaveLength(separators);
    },
  );

  it.each(variants)(
    'keeps missing block timestamps absent for $Component.name',
    ({ Component, status }) => {
      const props = fixture();
      props.transaction.status = { kind: 'confirmed', blockHeight: 800000 };
      const html = renderToStaticMarkup(createElement(Component, props));
      if (status) expect(html).toContain('#800000');
      else expect(html).toBe('');
      expect(html).not.toContain('<time');
      expect(html).not.toContain('sat/vB');
      expect(html).not.toContain('transaction-block-time-separator"');
    },
  );

  it.each(['mempool', 'inactive'] as const)(
    'does not show a stale block timestamp or fee for %s observations',
    (kind) => {
      const props = fixture();
      props.transaction.status = { kind, blocktime: 1690168629 };
      for (const { Component, status } of variants) {
        const html = renderToStaticMarkup(createElement(Component, props));
        if (status)
          expect(html).toContain(kind === 'mempool' ? 'Unconfirmed' : 'Outside active chain');
        else expect(html).toBe('');
        expect(html).not.toContain('<time');
        expect(html).not.toContain('sat/vB');
      }
    },
  );

  it('keeps incomplete fee evidence unknown and omits fees when workspace data is absent', () => {
    const props = fixture();
    props.transaction.vsize = undefined;
    for (const Component of [TransactionBlockTimeWithFee, TransactionTimestampWithFee]) {
      const html = renderToStaticMarkup(createElement(Component, props));
      expect(html).toContain('Fee unknown');
      expect(html.match(/aria-hidden="true">·/g)).toHaveLength(1);
      const withoutWorkspace = renderToStaticMarkup(
        createElement(Component, { transaction: props.transaction }),
      );
      expect(withoutWorkspace).toContain('<time');
      expect(withoutWorkspace).not.toContain('Fee unknown');
      expect(withoutWorkspace).not.toContain('transaction-block-time-separator"');
    }
  });

  it('keeps an unloaded transaction unknown instead of adding a timestamp or fee', () => {
    expect(renderToStaticMarkup(<TransactionBlockTimeWithFee />)).toContain('Status unknown');
    expect(renderToStaticMarkup(<TransactionTimestampWithFee />)).toBe('');
  });
});
