import { indexPreviousOutputs, type PreviousOutputIndex } from '../../ChainData';
import { outputScriptHash } from '../../Bitcoin';
import { outpointReference } from '../entityReferences';
import { verifiedWalletAddresses } from '../Wallets/walletRecords';
import type { Wallet } from '../Wallets/wallets';
import type { Workspace } from '../workspace';
import type { WalletTransactionSubject } from './counterparties';

export interface CounterpartySubjectContext {
  prevouts: PreviousOutputIndex;
  scripthashes: ReadonlySet<string>;
}

/** Build explicit receipt/payment anchors from verified wallet scripts and loaded prevouts. */
export function walletTransactionCounterpartySubject(
  workspace: Workspace,
  wallet: Wallet,
  transactionId: string,
  direction: WalletTransactionSubject['direction'],
  prepared?: CounterpartySubjectContext,
): WalletTransactionSubject | undefined {
  const transaction = workspace.chainData.transactions[transactionId];
  if (!transaction || transaction.txid !== transactionId) return undefined;
  const scripts =
    prepared?.scripthashes ??
    new Set(verifiedWalletAddresses(wallet, workspace.network).map((entry) => entry.scripthash));
  const prevouts =
    direction === 'sent'
      ? (prepared?.prevouts ??
        indexPreviousOutputs({
          network: workspace.network,
          transactions: workspace.chainData.transactions,
        }))
      : undefined;
  const walletOutputIds =
    direction === 'received'
      ? transaction.vout.flatMap((output) =>
          scripts.has(outputScriptHash(output, workspace.network) ?? '')
            ? [outpointReference(transactionId, output.n)]
            : [],
        )
      : transaction.vin.flatMap((input) => {
          if (input.txid === undefined || input.vout === undefined || input.coinbase !== undefined)
            return [];
          const resolution = prevouts?.get(`${input.txid}:${input.vout}`);
          return resolution &&
            (resolution.status === 'loaded' || resolution.status === 'attached') &&
            scripts.has(outputScriptHash(resolution.output, workspace.network) ?? '')
            ? [outpointReference(input.txid, input.vout)]
            : [];
        });
  return walletOutputIds.length
    ? {
        kind: 'wallet-transaction',
        walletId: wallet.id,
        transactionId,
        direction,
        walletOutputIds: [...new Set(walletOutputIds)].sort(),
      }
    : undefined;
}
