import { addressToScriptHash, outputScriptHash } from '../../Bitcoin';
import type { Workspace } from '../workspace';
import { indexPreviousOutputs } from '../../ChainData';

export interface WalletMatchSubject {
  id: string;
  kind: 'transaction' | 'output' | 'address';
  txid?: string;
  address?: string;
}

export interface WalletMatch {
  walletIds: string[];
  /** A transaction is associated with matching outputs, not wholly wallet-owned. */
  kind: 'output' | 'address' | 'transaction';
}

/** Project wallet addresses verified by workspace import or browser derivation.
 * No key derivation, history inference or network requests happen here. A raw
 * output script, when present, is authoritative over decoded address text.
 */
export function buildWalletMatches(
  workspace: Pick<Workspace, 'network'> & {
    chainData: Pick<Workspace['chainData'], 'transactions'>;
    wallets: Pick<Workspace['wallets'], 'definitions'>;
  },
  subjects: readonly WalletMatchSubject[],
): Map<string, WalletMatch> {
  const walletsByScript = new Map<string, Set<string>>();
  for (const wallet of workspace.wallets.definitions) {
    for (const address of wallet.addresses) {
      let hash: string;
      try {
        hash = addressToScriptHash(address.address, workspace.network);
      } catch {
        continue;
      }
      if (hash !== address.scripthash) continue;
      const wallets = walletsByScript.get(hash) ?? new Set<string>();
      wallets.add(wallet.id);
      walletsByScript.set(hash, wallets);
    }
  }
  if (!walletsByScript.size) return new Map();
  const outputWallets = new Map<string, Set<string>>();
  const transactionWallets = new Map<string, Set<string>>();
  const associate = (txid: string, wallets: Set<string>) => {
    const associated = transactionWallets.get(txid) ?? new Set<string>();
    for (const id of wallets) associated.add(id);
    transactionWallets.set(txid, associated);
  };
  for (const [outpoint, resolution] of indexPreviousOutputs({
    network: workspace.network,
    transactions: workspace.chainData.transactions,
  })) {
    if (resolution.status !== 'loaded' && resolution.status !== 'attached') continue;
    const hash = outputScriptHash(resolution.output, workspace.network);
    const wallets = hash ? walletsByScript.get(hash) : undefined;
    if (!wallets) continue;
    outputWallets.set(outpoint, wallets);
    associate(outpoint.slice(0, 64), wallets);
  }
  for (const transaction of Object.values(workspace.chainData.transactions)) {
    for (const input of transaction.vin) {
      if (input.txid === undefined || input.vout === undefined) continue;
      const wallets = outputWallets.get(`${input.txid}:${input.vout}`);
      if (wallets) associate(transaction.txid, wallets);
    }
  }
  const matches = new Map<string, WalletMatch>();
  for (const node of subjects) {
    let wallets: Set<string> | undefined;
    if (node.kind === 'transaction')
      wallets = transactionWallets.get(node.txid ?? node.id.slice(3));
    else if (node.kind === 'output') wallets = outputWallets.get(node.id.slice(4));
    else if (node.address) {
      try {
        wallets = walletsByScript.get(addressToScriptHash(node.address, workspace.network));
      } catch {
        /* Unsupported display-only addresses do not establish a match. */
      }
    }
    if (wallets?.size) matches.set(node.id, { walletIds: [...wallets], kind: node.kind });
  }
  return matches;
}
