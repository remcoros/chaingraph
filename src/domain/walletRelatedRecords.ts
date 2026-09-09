import { outputNodeId, txNodeId, type Workspace } from './types';
import { relatedTransactions } from './transactionInspection';
import { walletOutputEvidence } from './walletRelationships';
import type { WalletRow } from './walletWorkbenchRows';

export interface WalletRelatedRecords {
  inputs: string[];
  outputs: string[];
  transactions: string[];
}

export function walletRelatedRecords(workspace: Workspace, row: WalletRow): WalletRelatedRecords {
  const inputs = new Set<string>();
  const outputs = new Set(row.outpointIds ?? []);
  const transactions = new Set(row.contextTransactionIds);
  if (row.kind === 'transaction' && row.txid) {
    const transaction = workspace.transactions[row.txid];
    transactions.delete(row.txid);
    for (const input of transaction?.vin ?? []) {
      if (input.txid !== undefined && input.vout !== undefined && input.coinbase === undefined)
        inputs.add(outputNodeId(input.txid, input.vout));
    }
    for (const output of transaction?.vout ?? []) outputs.add(outputNodeId(row.txid, output.n));
  } else if (row.kind === 'output') {
    outputs.delete(row.nodeId);
    if (row.txid) transactions.add(row.txid);
    for (const { tx } of relatedTransactions(workspace.transactions, {
      id: row.nodeId,
      kind: 'output',
      label: '',
      txid: row.txid,
      vout: Number(row.nodeId.split(':')[2]),
    }))
      transactions.add(tx.txid);
  } else if (!row.relationshipDirection && row.address) {
    for (const txid of row.contextTransactionIds) {
      const transaction = workspace.transactions[txid];
      for (const output of transaction?.vout ?? [])
        if (walletOutputEvidence(output, workspace.network).address === row.address)
          outputs.add(outputNodeId(txid, output.n));
    }
  }
  return {
    inputs: [...inputs],
    outputs: [...outputs],
    transactions: [...transactions].map(txNodeId),
  };
}
