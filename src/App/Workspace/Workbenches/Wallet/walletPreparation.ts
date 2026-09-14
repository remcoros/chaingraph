import type { Wallet, Workspace } from '../../../../Domain/types';
import { buildWalletReview } from '../../../../Domain/Wallet/walletReview';
import { groupWalletRelationships } from '../../../../Domain/Wallet/walletRelationships';
import { verifyWalletUtxo } from '../../../../Domain/Wallet/walletRecords';
import {
  buildWalletSelectionAddresses,
  buildWalletSelectionIndex,
} from '../../../../Domain/Wallet/walletSelectionIndex';
import { createWalletOutputEvidenceResolver } from '../../../../Domain/Wallet/walletOutputEvidence';
import type { WalletUtxoView } from './useWalletUtxos';

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
  // Keep the initial view and latest UTXO observation separately. Returning to a
  // wallet starts a fresh UTXO check; old observations must not look current.
  withoutUtxos?: PreparedReview;
  expandedWithoutUtxos?: PreparedReview;
  withUtxos?: PreparedReview;
}

export interface WalletPreparation {
  selectionIndex: ReturnType<typeof buildWalletSelectionIndex>;
  walletAddresses: ReturnType<typeof buildWalletSelectionAddresses>;
  relationships: ReturnType<typeof groupWalletRelationships>;
  review: ReturnType<typeof buildWalletReview>;
  currentUtxos: WalletUtxoView['records'];
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
    workspace.annotations,
    workspace.tags,
    workspace.walletReviews,
    workspace.findings,
  ];
}

/** Prepared views belong to one unlocked session, never its encrypted payload.
 * Dependencies are immutable source references, not the workspace wrapper or view.
 * Only the current chain snapshot, initial page, latest expanded page and latest
 * UTXO observation per wallet are retained.
 */
export class WalletPreparationCache {
  private chain?: {
    id: string;
    network: Workspace['network'];
    transactions: Workspace['transactions'];
    evidence: ReturnType<typeof createWalletOutputEvidenceResolver>;
    selectionIndex: ReturnType<typeof buildWalletSelectionIndex>;
  };
  private wallets = new Map<string, PreparedWallet>();
  private disposed = false;

  private matchesChain(workspace: Workspace) {
    return (
      this.chain?.id === workspace.id &&
      this.chain.network === workspace.network &&
      this.chain.transactions === workspace.transactions
    );
  }

  peek(
    workspace: Workspace,
    wallet: Wallet,
    utxos?: WalletUtxoView,
    page = 1,
  ): WalletPreparation | undefined {
    if (this.disposed || !this.matchesChain(workspace)) return undefined;
    const cached = this.wallets.get(wallet.id);
    if (
      !cached ||
      !same(cached.relationshipDependencies, relationshipDependencies(wallet)) ||
      !same(cached.reviewDependencies ?? [], reviewDependencies(workspace, wallet))
    )
      return undefined;
    const review = utxos
      ? cached.withUtxos
      : page === 1
        ? cached.withoutUtxos
        : cached.expandedWithoutUtxos;
    return review && same(review.dependencies, [utxos, page]) ? review.value : undefined;
  }

  prepare(
    workspace: Workspace,
    wallet: Wallet,
    utxos?: WalletUtxoView,
    page = 1,
  ): WalletPreparation {
    if (this.disposed) throw new Error('Wallet preparation session is closed.');
    const liveWallets = new Set(workspace.wallets.map((entry) => entry.id));
    for (const id of this.wallets.keys()) if (!liveWallets.has(id)) this.wallets.delete(id);
    const hit = this.peek(workspace, wallet, utxos, page);
    if (hit) return hit;
    if (!this.matchesChain(workspace)) {
      this.wallets.clear();
      const evidence = createWalletOutputEvidenceResolver(workspace.network);
      this.chain = {
        id: workspace.id,
        network: workspace.network,
        transactions: workspace.transactions,
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
      cached.expandedWithoutUtxos = undefined;
      cached.reviewDependencies = metadata;
    }
    // A check may finish before the first wallet render. Still retain a view
    // that can be shown immediately on return, without reusing that old check.
    if ((utxos || page !== 1) && !cached.withoutUtxos) this.prepare(workspace, wallet);
    const currentUtxos = (utxos?.records ?? [])
      .filter(
        (record) =>
          !workspace.transactions[record.txid] ||
          verifyWalletUtxo(record, workspace.transactions[record.txid], workspace.network),
      )
      .sort((a, b) => b.valueSats - a.valueSats || a.txid.localeCompare(b.txid) || a.vout - b.vout);
    const value: WalletPreparation = {
      selectionIndex: chain.selectionIndex,
      walletAddresses: cached.walletAddresses,
      relationships: cached.relationships,
      currentUtxos,
      invalidCount: (utxos?.records.length ?? 0) - currentUtxos.length,
      review: buildWalletReview(workspace, wallet, {
        utxos: utxos ? currentUtxos : undefined,
        utxoCheckedAt: utxos?.checkedAt,
        utxoCheckedAddresses: utxos?.checkedAddresses,
        utxoTotalAddresses: utxos?.totalAddresses,
        utxoPartial: utxos?.nextCursor !== undefined || (utxos?.failed ?? 0) > 0,
        page,
        relationships: cached.relationships,
        prevouts: chain.selectionIndex.prevouts,
        evidence: chain.evidence,
      }),
    };
    const result = { dependencies: [utxos, page], value };
    if (utxos) cached.withUtxos = result;
    else if (page === 1) cached.withoutUtxos = result;
    else cached.expandedWithoutUtxos = result;
    return value;
  }

  dispose() {
    this.chain = undefined;
    this.wallets.clear();
    this.disposed = true;
  }
}
