import {
  outpointReference,
  transactionReference,
} from '../../../../../Core/Workspace/entityReferences';
import type { Workspace } from '../../../../../Core/Workspace/workspace';

import { relatedTransactions } from '../../../Selection/relatedTransactions';
import { walletOutputEvidence } from '../../../../../Core/Workspace/Wallets/walletRelationships';
import { walletRowFinding, type WalletRow } from '../walletRows';
import type { WalletSelectionIndex } from '../../../../../Core/Workspace/Wallets/walletSelectionIndex';

export interface WalletRelatedRecords {
  inputs: string[];
  outputs: string[];
  transactions: string[];
}

export function walletRelatedRecords(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
    analysis: Pick<Workspace['analysis'], 'findings'>;
  },
  row: WalletRow,
  index?: WalletSelectionIndex,
): WalletRelatedRecords {
  const inputs = new Set<string>();
  const outputs = new Set(row.outpointIds ?? []);
  const transactions = new Set(row.contextTransactionIds);
  const finding = walletRowFinding(workspace, row);
  for (const id of finding?.nodeIds ?? []) {
    if (id.startsWith('out:')) outputs.add(id);
  }
  for (const txid of finding?.txids ?? []) transactions.add(txid);
  if (row.kind === 'transaction' && row.txid) {
    const transaction = workspace.chainData.transactions[row.txid];
    transactions.delete(row.txid);
    for (const input of transaction?.vin ?? []) {
      if (input.txid !== undefined && input.vout !== undefined && input.coinbase === undefined)
        inputs.add(outpointReference(input.txid, input.vout));
    }
    for (const output of transaction?.vout ?? [])
      outputs.add(outpointReference(row.txid, output.n));
  } else if (row.kind === 'output') {
    outputs.delete(row.nodeId);
    if (row.txid) transactions.add(row.txid);
    if (index) {
      const creating = workspace.chainData.transactions[row.txid ?? ''];
      if (creating) transactions.add(creating.txid);
      const point = outpointReference(row.txid ?? '', Number(row.nodeId.split(':')[2]));
      for (const txid of index.spendingTransactionIds.get(point) ?? []) transactions.add(txid);
    } else
      for (const { tx } of relatedTransactions(workspace.chainData.transactions, {
        id: row.nodeId,
        kind: 'output',
        label: '',
        txid: row.txid,
        vout: Number(row.nodeId.split(':')[2]),
      }))
        transactions.add(tx.txid);
  } else if (!row.relationshipDirection && row.address) {
    if (index) {
      const contexts = new Set(row.contextTransactionIds);
      const byTransaction = new Map<string, string[]>();
      for (const id of index.addressOutputIds.get(row.address) ?? []) {
        const txid = id.slice(4, id.lastIndexOf(':'));
        if (!contexts.has(txid)) continue;
        const ids = byTransaction.get(txid) ?? [];
        ids.push(id);
        byTransaction.set(txid, ids);
      }
      for (const txid of row.contextTransactionIds)
        for (const id of byTransaction.get(txid) ?? []) outputs.add(id);
    } else
      for (const txid of row.contextTransactionIds) {
        const transaction = workspace.chainData.transactions[txid];
        for (const output of transaction?.vout ?? [])
          if (walletOutputEvidence(output, workspace.network).address === row.address)
            outputs.add(outpointReference(txid, output.n));
      }
  }
  return {
    inputs: [...inputs],
    outputs: [...outputs],
    transactions: [...transactions].map(transactionReference),
  };
}

/** Prefer exact chain relationships, then saved finding membership. Missing
 * evidence stays explicit rather than turning a shared finding into a flow. */
export function walletRelatedDescription(
  workspace: Workspace,
  row: WalletRow,
  id: string,
  index: WalletSelectionIndex,
): string {
  const spends = (txid: string, outpoint: string) =>
    index.spendingTransactionIds.get(outpoint)?.includes(txid) ?? false;
  const addressFor = (outpoint: string) => {
    const evidence = index.prevouts.get(outpoint.slice(4));
    return evidence?.status === 'loaded' || evidence?.status === 'attached'
      ? walletOutputEvidence(evidence.output, workspace.network).address
      : undefined;
  };
  if (id.startsWith('tx:')) {
    const txid = id.slice(3);
    const transaction = workspace.chainData.transactions[txid];
    if (row.kind === 'output') {
      if (row.txid === txid) return 'Creates this outpoint';
      if (spends(txid, row.nodeId)) return 'Spends this outpoint';
    }
    if (row.kind === 'transaction' && row.txid) {
      if (
        workspace.chainData.transactions[row.txid]?.vin.some(
          (input) =>
            input.coinbase === undefined && input.vout !== undefined && input.txid === txid,
        )
      )
        return 'Creates an input';
      if (
        transaction?.vin.some(
          (input) =>
            input.coinbase === undefined && input.vout !== undefined && input.txid === row.txid,
        )
      )
        return 'Spends an output';
    }
    if (row.address && transaction) {
      const receives = transaction.vout.some(
        (output) => walletOutputEvidence(output, workspace.network).address === row.address,
      );
      const sends = transaction.vin.some(
        (input) =>
          input.txid !== undefined &&
          input.vout !== undefined &&
          input.coinbase === undefined &&
          addressFor(outpointReference(input.txid, input.vout)) === row.address,
      );
      if (receives && sends) return 'Spends from and pays this address';
      if (receives) return 'Pays this address';
      if (sends) return 'Spends from this address';
    }
  } else if (id.startsWith('out:')) {
    const creatingTxid = id.slice(4, id.lastIndexOf(':'));
    if (row.kind === 'transaction' && row.txid) {
      if (spends(row.txid, id)) return 'Spent in this transaction';
      if (creatingTxid === row.txid) return 'Created by this transaction';
    }
    if (row.kind === 'output') {
      if (spends(creatingTxid, row.nodeId))
        return 'Created by a transaction that spends this outpoint';
      if (row.txid && spends(row.txid, id))
        return 'Spent by the transaction that created this outpoint';
      if (index.spendingTransactionIds.get(row.nodeId)?.some((txid) => spends(txid, id)))
        return 'Spent in the same transaction';
      const address = row.address ?? addressFor(row.nodeId);
      if (address && addressFor(id) === address) return 'Received at the same address';
      if (creatingTxid === row.txid) return 'Created in the same transaction';
    }
    if (row.kind === 'address' && row.address && addressFor(id) === row.address)
      return 'Received at this address';
  }
  const finding = walletRowFinding(workspace, row);
  if (
    finding?.nodeIds.includes(id) ||
    (id.startsWith('tx:') && finding?.txids.includes(id.slice(3)))
  )
    return 'Included in this finding';
  if (id.startsWith('tx:') && !workspace.chainData.transactions[id.slice(3)])
    return 'Relationship details unavailable until this transaction is loaded';
  if (id.startsWith('out:')) {
    const evidence = index.prevouts.get(id.slice(4));
    if (evidence?.status === 'conflict')
      return 'Conflicting output details prevent checking the relationship';
    if (!evidence || evidence.status === 'missing')
      return 'Relationship details unavailable until this output is loaded';
  }
  return 'Relationship details unavailable in loaded data';
}
