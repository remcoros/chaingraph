import { outpointReference } from '../../entityReferences';
import type { Wallet } from '../wallets';
import type { Workspace } from '../../workspace';
import type { Network } from '../../../Bitcoin';
import type { Transaction } from '../../../ChainData';
import {
  canonicalTransactionId,
  loadedWalletTransactions,
  validOutputIndex,
} from '../walletRelationships';

import { verifiedWalletAddresses, verifyWalletUtxo, type WalletUtxoRecord } from '../walletRecords';

/** A saved unspent check is historical evidence, not authority over a loaded spend.
 * Keep the source records intact; conflicting observations need a fresh check.
 */
export function reconcileWalletUtxos(
  records: readonly WalletUtxoRecord[],
  loaded: ReadonlyMap<string, Transaction>,
  network: Network,
) {
  const spent = new Set<string>();
  for (const transaction of loaded.values())
    for (const input of transaction.vin) {
      const parent = canonicalTransactionId(input.txid);
      if (input.coinbase === undefined && parent && validOutputIndex(input.vout))
        spent.add(outpointReference(parent, input.vout));
    }
  const current: WalletUtxoRecord[] = [];
  const withLoadedSpender: WalletUtxoRecord[] = [];
  let invalidCount = 0;
  for (const record of records) {
    const transaction = loaded.get(record.txid);
    if (transaction && !verifyWalletUtxo(record, transaction, network)) invalidCount++;
    else if (spent.has(outpointReference(record.txid, record.vout))) withLoadedSpender.push(record);
    else current.push(record);
  }
  return { current, withLoadedSpender, invalidCount };
}

export interface WalletUtxoObservation {
  workspaceId: string;
  network: Network;
  txid: string;
  vout: number;
  checkedAt: string;
}

/** Positive evidence only. An absent record says nothing about spend status. */
export function resolveWalletUtxoObservation(
  workspace:
    | (Pick<Workspace, 'id' | 'network'> & {
        chainData: Pick<Workspace['chainData'], 'transactions'>;
      })
    | undefined,
  wallet: Pick<Wallet, 'addresses'> | undefined,
  view: { records: WalletUtxoRecord[]; checkedAt: string } | undefined,
  selectedId: string | undefined,
): WalletUtxoObservation | undefined {
  if (!workspace || !wallet || !view || !selectedId || !Number.isFinite(Date.parse(view.checkedAt)))
    return undefined;
  const record = view.records.find(
    (item) => outpointReference(item.txid, item.vout) === selectedId,
  );
  if (!record) return undefined;
  if (
    reconcileWalletUtxos([record], loadedWalletTransactions(workspace), workspace.network)
      .withLoadedSpender.length
  )
    return undefined;
  const transaction = workspace.chainData.transactions[record.txid];
  if (
    !transaction ||
    !verifiedWalletAddresses(wallet, workspace.network).some(
      (item) => item.scripthash === record.scripthash,
    ) ||
    !verifyWalletUtxo(record, transaction, workspace.network)
  )
    return undefined;
  return {
    workspaceId: workspace.id,
    network: workspace.network,
    txid: record.txid,
    vout: record.vout,
    checkedAt: view.checkedAt,
  };
}

export function matchingWalletUtxoObservation(
  observation: WalletUtxoObservation | undefined,
  workspace: Workspace,
  txid: string | undefined,
  vout: number | undefined,
): WalletUtxoObservation | undefined {
  return observation?.workspaceId === workspace.id &&
    observation.network === workspace.network &&
    observation.txid === txid &&
    observation.vout === vout
    ? observation
    : undefined;
}
