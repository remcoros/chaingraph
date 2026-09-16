import { expect, it } from 'vitest';
import { walletRelatedRecords } from './walletRelatedRecords';
import { createWorkspace } from '../../../createWorkspace';
import type { WalletRow } from '../walletRows';
import {
  transactions,
  TX_FUNDING,
  TX_SPENDING,
  RECEIVE_ADDRESS,
} from '../../../../../../tests/fixtures/bitcoin';

const row = (nodeId: string, kind: WalletRow['kind']): WalletRow => ({
  key: nodeId,
  nodeId,
  kind,
  identifier: nodeId.slice(nodeId.indexOf(':') + 1),
  title: '',
  description: '',
  meta: '',
  contextTransactionIds: [],
  reviews: [],
  status: 'open',
  changed: false,
});
const fixture = () => {
  const workspace = createWorkspace('Public related records', 'mainnet');
  workspace.transactions = structuredClone(transactions);
  return workspace;
};

it('lists the actual input and output outpoints for a transaction', () => {
  const record = { ...row(`tx:${TX_SPENDING}`, 'transaction'), txid: TX_SPENDING };
  const related = walletRelatedRecords(fixture(), record);
  expect(related.inputs).toEqual([`out:${TX_FUNDING}:0`, `out:${TX_FUNDING}:1`]);
  expect(related.outputs).toEqual([`out:${TX_SPENDING}:0`, `out:${TX_SPENDING}:1`]);
  expect(related.transactions).toEqual([]);
});

it('lists creating and loaded spending transactions for an outpoint', () => {
  const record = { ...row(`out:${TX_FUNDING}:0`, 'output'), txid: TX_FUNDING };
  expect(walletRelatedRecords(fixture(), record).transactions).toEqual([
    `tx:${TX_FUNDING}`,
    `tx:${TX_SPENDING}`,
  ]);
});

it('uses authoritative scripts for address outpoints rather than a conflicting display label', () => {
  const workspace = fixture();
  workspace.transactions[TX_FUNDING].vout[1].scriptPubKey.address = RECEIVE_ADDRESS;
  const record = {
    ...row(`addr:${RECEIVE_ADDRESS}`, 'address'),
    address: RECEIVE_ADDRESS,
    contextTransactionIds: [TX_FUNDING, TX_SPENDING],
  };
  expect(walletRelatedRecords(workspace, record).outputs).toEqual([
    `out:${TX_FUNDING}:0`,
    `out:${TX_SPENDING}:0`,
  ]);
});
