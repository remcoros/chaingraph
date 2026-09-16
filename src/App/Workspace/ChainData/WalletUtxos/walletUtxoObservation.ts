import { outputNodeId, type Network, type Wallet, type Workspace } from '../../../../Domain/types';
import {
  verifiedWalletAddresses,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from '../../../../Domain/Wallet/walletRecords';

export interface WalletUtxoObservation {
  workspaceId: string;
  network: Network;
  txid: string;
  vout: number;
  checkedAt: string;
}

/** Positive evidence only. An absent record says nothing about spend status. */
export function resolveWalletUtxoObservation(
  workspace: Pick<Workspace, 'id' | 'network' | 'transactions'> | undefined,
  wallet: Pick<Wallet, 'addresses'> | undefined,
  view: { records: WalletUtxoRecord[]; checkedAt: string } | undefined,
  selectedId: string | undefined,
): WalletUtxoObservation | undefined {
  if (!workspace || !wallet || !view || !selectedId || !Number.isFinite(Date.parse(view.checkedAt)))
    return undefined;
  const record = view.records.find((item) => outputNodeId(item.txid, item.vout) === selectedId);
  if (!record) return undefined;
  const transaction = workspace.transactions[record.txid];
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
