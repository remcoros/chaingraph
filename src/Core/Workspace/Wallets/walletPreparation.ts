import type { Wallet } from './wallets';
import type { Workspace } from '../workspace';

import { buildWalletReview } from './walletReview';
import { groupWalletRelationships } from './walletRelationships';
import { reconcileWalletUtxos } from './WalletUtxos/walletUtxoObservation';
import { buildWalletSelectionAddresses, buildWalletSelectionIndex } from './walletSelectionIndex';
import { createWalletOutputEvidenceResolver } from './walletOutputEvidence';
import type { WalletUtxoCheck } from './WalletUtxos/walletUtxoCheck';

type Dependencies = readonly unknown[];
const same = (a: Dependencies, b: Dependencies) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

interface PreparedReview {
  dependencies: Dependencies;
  value: WalletPreparation;
}

interface PreparedWallet {
  relationshipDependencies: Dependencies;
  walletAddresses: ReturnType<typeof buildWalletSelectionAddresses>;
  relationships: ReturnType<typeof groupWalletRelationships>;
  reviewDependencies?: Dependencies;
  // Keep the initial view and the latest dated UTXO projection separately.
  withoutUtxos?: PreparedReview;
  withUtxos?: PreparedReview;
}

export interface WalletPreparation {
  selectionIndex: ReturnType<typeof buildWalletSelectionIndex>;
  walletAddresses: ReturnType<typeof buildWalletSelectionAddresses>;
  relationships: ReturnType<typeof groupWalletRelationships>;
  review: ReturnType<typeof buildWalletReview>;
  currentUtxos: WalletUtxoCheck['records'];
  invalidCount: number;
}

function relationshipDependencies(wallet: Wallet): Dependencies {
  return [
    wallet.addresses,
    wallet.pendingTransactionIds,
    wallet.scanComplete,
    wallet.scannedAt,
    wallet.scanGap,
    wallet.scanLimit,
  ];
}

function reviewDependencies(workspace: Workspace, wallet: Wallet): Dependencies {
  return [
    wallet,
    workspace.annotations.entities,
    workspace.annotations.tags,
    workspace.wallets.reviews,
    workspace.analysis.findings,
  ];
}

/** Prepared views belong to one unlocked session, never its encrypted payload.
 * Dependencies are immutable source references, not the workspace wrapper or view.
 * Only the current chain snapshot, initial view and latest UTXO observation per
 * wallet are retained.
 */
export class WalletPreparationCache {
  private chain?: {
    id: string;
    network: Workspace['network'];
    transactions: Workspace['chainData']['transactions'];
    evidence: ReturnType<typeof createWalletOutputEvidenceResolver>;
    selectionIndex: ReturnType<typeof buildWalletSelectionIndex>;
  };
  private wallets = new Map<string, PreparedWallet>();
  private disposed = false;

  private matchesChain(workspace: Workspace) {
    return (
      this.chain?.id === workspace.id &&
      this.chain.network === workspace.network &&
      this.chain.transactions === workspace.chainData.transactions
    );
  }

  peek(
    workspace: Workspace,
    wallet: Wallet,
    utxos?: WalletUtxoCheck,
  ): WalletPreparation | undefined {
    if (this.disposed || !this.matchesChain(workspace)) return undefined;
    const cached = this.wallets.get(wallet.id);
    if (
      !cached ||
      !same(cached.relationshipDependencies, relationshipDependencies(wallet)) ||
      !same(cached.reviewDependencies ?? [], reviewDependencies(workspace, wallet))
    )
      return undefined;
    const review = utxos ? cached.withUtxos : cached.withoutUtxos;
    return review && same(review.dependencies, [utxos]) ? review.value : undefined;
  }

  prepare(workspace: Workspace, wallet: Wallet, utxos?: WalletUtxoCheck): WalletPreparation {
    if (this.disposed) throw new Error('Wallet preparation session is closed.');
    const liveWallets = new Set(workspace.wallets.definitions.map((entry) => entry.id));
    for (const id of this.wallets.keys()) if (!liveWallets.has(id)) this.wallets.delete(id);
    const hit = this.peek(workspace, wallet, utxos);
    if (hit) return hit;
    if (!this.matchesChain(workspace)) {
      this.wallets.clear();
      const evidence = createWalletOutputEvidenceResolver(workspace.network);
      this.chain = {
        id: workspace.id,
        network: workspace.network,
        transactions: workspace.chainData.transactions,
        evidence,
        selectionIndex: buildWalletSelectionIndex(workspace, evidence),
      };
    }
    const chain = this.chain!;
    let cached = this.wallets.get(wallet.id);
    const dependencies = relationshipDependencies(wallet);
    if (!cached || !same(cached.relationshipDependencies, dependencies)) {
      cached = {
        relationshipDependencies: dependencies,
        walletAddresses: buildWalletSelectionAddresses(wallet, workspace.network),
        relationships: groupWalletRelationships(
          workspace,
          wallet,
          chain.selectionIndex.prevouts,
          chain.evidence,
        ),
      };
      this.wallets.set(wallet.id, cached);
    }
    const metadata = reviewDependencies(workspace, wallet);
    if (!same(cached.reviewDependencies ?? [], metadata)) {
      cached.withUtxos = undefined;
      cached.withoutUtxos = undefined;
      cached.reviewDependencies = metadata;
    }
    // A check may finish before the first wallet render. Also retain the no-check view.
    if (utxos && !cached.withoutUtxos) this.prepare(workspace, wallet);
    const reconciledUtxos = reconcileWalletUtxos(
      utxos?.records ?? [],
      chain.selectionIndex.transactions,
      workspace.network,
    );
    const currentUtxos = reconciledUtxos.current.sort(
      (a, b) => b.valueSats - a.valueSats || a.txid.localeCompare(b.txid) || a.vout - b.vout,
    );
    const value: WalletPreparation = {
      selectionIndex: chain.selectionIndex,
      walletAddresses: cached.walletAddresses,
      relationships: cached.relationships,
      currentUtxos,
      invalidCount: reconciledUtxos.invalidCount,
      review: buildWalletReview(workspace, wallet, {
        utxos: utxos?.records,
        utxoCheckedAt: utxos?.checkedAt,
        utxoCheckedAddresses: utxos?.checkedAddresses,
        utxoTotalAddresses: utxos?.totalAddresses,
        utxoPartial: utxos?.nextCursor !== undefined || (utxos?.failed ?? 0) > 0,
        relationships: cached.relationships,
        prevouts: chain.selectionIndex.prevouts,
        evidence: chain.evidence,
      }),
    };
    const result = { dependencies: [utxos], value };
    if (utxos) cached.withUtxos = result;
    else cached.withoutUtxos = result;
    return value;
  }

  dispose() {
    this.chain = undefined;
    this.wallets.clear();
    this.disposed = true;
  }
}
