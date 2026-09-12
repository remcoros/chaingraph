import type { Network, Transaction, Wallet, Workspace } from '../domain/types';
import { indexPreviousOutputs, resolvePreviousOutput } from '../domain/prevouts';
import {
  canonicalTransactionId,
  validOutputIndex,
  walletOutputEvidence,
  type WalletAddressRelationships,
} from '../domain/walletRelationships';
import { verifiedWalletAddresses } from '../domain/walletRecords';
import { parseTransaction, validateTransactionAddresses } from '../domain/workspace';
import { mergeFlowInputs } from './useFlowInputs';
import {
  loadWalletFlowInputWave,
  WALLET_FLOW_INPUT_WAVE_LIMIT,
  type WalletFlowInputReference,
} from './walletFlowInputs';

/** The loader observes only the evidence that can change its one-hop input plan. */
export type WalletCounterpartyWorkspace = Pick<
  Workspace,
  'id' | 'network' | 'wallets' | 'transactions'
>;

export interface WalletCounterpartyOptions {
  workspace: Workspace;
  wallet: Wallet;
  groups: WalletAddressRelationships;
  active: boolean;
  enabled: boolean;
  fetch: (network: Network, id: string, signal: AbortSignal) => Promise<Transaction>;
  update: (id: string, change: (current: Workspace) => Workspace, undo?: boolean) => void;
}

export type WalletCounterpartyConfiguration = Omit<
  WalletCounterpartyOptions,
  'workspace' | 'wallet'
> & {
  workspace: WalletCounterpartyWorkspace;
  wallet: Pick<Wallet, 'id'>;
};

interface InputContext {
  transactionId: string;
  walletOutputIds: string[];
  refs: WalletFlowInputReference[];
}

export interface WalletCounterpartyInputPlan {
  workspaceId: string;
  network: Network;
  walletId: string;
  sourceKey: string;
  contexts: InputContext[];
  missingIds: string[];
  nonAddressCount: number;
  unavailableCount: number;
}

function loaded(workspace: Pick<Workspace, 'transactions'>, id: string) {
  const transaction = workspace.transactions[id];
  return canonicalTransactionId(transaction?.txid) === id ? transaction : undefined;
}

/** Revalidate receiving contexts, not address history or newly fetched ancestry. */
function sourceEvidence(
  workspace: WalletCounterpartyWorkspace,
  walletId: string,
  contexts: InputContext[],
) {
  const wallet = workspace.wallets.find((entry) => entry.id === walletId);
  if (!wallet) return { contexts: [], sourceKey: '' };
  const hashes = new Set(
    verifiedWalletAddresses(wallet, workspace.network).map((entry) => entry.scripthash),
  );
  const valid: InputContext[] = [];
  const observations: unknown[] = [];
  for (const context of contexts) {
    const transaction = loaded(workspace, context.transactionId);
    if (!transaction) continue;
    const outputs = new Map<number, Transaction['vout'][number]>();
    for (const output of transaction.vout)
      if (!outputs.has(output.n)) outputs.set(output.n, output);
    const inputs = new Set(
      transaction.vin.flatMap((input) => {
        const txid = canonicalTransactionId(input.txid);
        return input.coinbase === undefined && txid && validOutputIndex(input.vout)
          ? [`out:${txid}:${input.vout}`]
          : [];
      }),
    );
    const walletOutputIds = context.walletOutputIds.filter((id) => {
      const [kind, txid, index] = id.split(':');
      if (kind !== 'out' || txid !== context.transactionId || !/^(0|[1-9]\d*)$/.test(index ?? ''))
        return false;
      const output = outputs.get(Number(index));
      return hashes.has(walletOutputEvidence(output, workspace.network).scripthash ?? '');
    });
    if (!walletOutputIds.length) continue;
    const refs = context.refs.filter(
      (ref) => ref.txid !== context.transactionId && inputs.has(ref.id),
    );
    if (!refs.length) continue;
    valid.push({ ...context, refs, walletOutputIds });
    observations.push([context.transactionId, transaction.vin, walletOutputIds, refs]);
  }
  return {
    contexts: valid,
    sourceKey: valid.length ? JSON.stringify([[...hashes].sort(), observations]) : '',
  };
}

export function walletCounterpartyInputPlan(
  workspace: WalletCounterpartyWorkspace,
  wallet: Pick<Wallet, 'id'>,
  groups: WalletAddressRelationships,
): WalletCounterpartyInputPlan {
  const byTransaction = new Map<
    string,
    { ids: Set<string>; refs: Map<string, WalletFlowInputReference> }
  >();
  for (const entry of [
    ...groups.sources.flatMap((group) => group.outpoints),
    ...groups.sourceExceptions,
  ]) {
    const txid = canonicalTransactionId(entry.txid);
    if (!txid || !validOutputIndex(entry.vout) || entry.id !== `out:${txid}:${entry.vout}`)
      continue;
    for (const context of entry.contexts) {
      const transactionId = canonicalTransactionId(context.transactionId);
      if (!transactionId) continue;
      const current = byTransaction.get(transactionId) ?? {
        ids: new Set<string>(),
        refs: new Map<string, WalletFlowInputReference>(),
      };
      for (const id of context.walletOutputIds) current.ids.add(id);
      current.refs.set(entry.id, { id: entry.id, txid, vout: entry.vout });
      byTransaction.set(transactionId, current);
    }
  }
  const evidence = sourceEvidence(
    workspace,
    wallet.id,
    [...byTransaction.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([transactionId, entry]) => ({
        transactionId,
        walletOutputIds: [...entry.ids].sort(),
        refs: [...entry.refs.values()].sort((a, b) => a.id.localeCompare(b.id)),
      })),
  );
  const missing = new Set<string>();
  const unavailable = new Set<string>();
  const prevouts = indexPreviousOutputs(workspace);
  for (const ref of evidence.contexts.flatMap((context) => context.refs)) {
    const resolution = resolvePreviousOutput(workspace, ref, prevouts);
    if (resolution.status === 'loaded' || resolution.status === 'attached') continue;
    if (!workspace.transactions[ref.txid]) missing.add(ref.txid);
    else unavailable.add(ref.id);
  }
  const nonAddress = new Set<string>();
  for (const entry of [...groups.sourceExceptions, ...groups.destinationExceptions]) {
    if (entry.missing) continue;
    const resolution = resolvePreviousOutput(workspace, entry, prevouts);
    const output =
      resolution.status === 'loaded' || resolution.status === 'attached'
        ? resolution.output
        : undefined;
    const script = walletOutputEvidence(output, workspace.network);
    if (script.scripthash && !script.address) nonAddress.add(entry.id);
    else if (!script.address) unavailable.add(entry.id);
  }
  return {
    workspaceId: workspace.id,
    network: workspace.network,
    walletId: wallet.id,
    ...evidence,
    missingIds: [...missing].sort(),
    nonAddressCount: nonAddress.size,
    unavailableCount: unavailable.size,
  };
}

/** Only new parents are merged. All requested outputs shared across receiving
 * transactions become focused context together, never cache-only promotions. */
export function mergeWalletCounterpartyInputs(
  workspace: Workspace,
  plan: WalletCounterpartyInputPlan,
  candidates: readonly Transaction[],
): Workspace {
  if (
    !plan.sourceKey ||
    workspace.id !== plan.workspaceId ||
    workspace.network !== plan.network ||
    sourceEvidence(workspace, plan.walletId, plan.contexts).sourceKey !== plan.sourceKey
  )
    return workspace;
  let merged = workspace;
  for (const candidate of candidates.slice(0, WALLET_FLOW_INPUT_WAVE_LIMIT)) {
    if (merged.transactions[candidate.txid]) continue;
    let transaction: Transaction;
    try {
      transaction = parseTransaction(candidate);
      validateTransactionAddresses(transaction, workspace.network);
    } catch {
      // Recheck at the merge boundary, including independently supplied observations.
      continue;
    }
    const references = plan.contexts.flatMap((context) =>
      context.refs
        .filter(
          (ref) =>
            ref.txid === transaction.txid &&
            transaction.vout.some((output) => output.n === ref.vout),
        )
        .map((ref) => ({ ...ref, transactionId: context.transactionId })),
    );
    for (const [index, ref] of references.entries())
      merged = mergeFlowInputs(
        merged,
        ref.transactionId,
        { ...ref, kind: 'output', label: '' },
        index === 0 ? [transaction] : [],
      );
  }
  return merged;
}

export interface WalletCounterpartyState {
  loading: boolean;
  /** Remaining distinct uncached parents in current one-hop receiving contexts. */
  missingCount: number;
  /** Failed parent transactions still missing, without upstream exception text. */
  failedCount: number;
  nonAddressCount: number;
  /** Cached missing outpoints or unusable script evidence, not a refetch queue. */
  unavailableCount: number;
}

/** Testable lifecycle shared by the hook. One automatic wave per activation;
 * source changes cancel work but never grant another automatic wave. */
export function createWalletCounterpartyLoader(readLatest?: () => WalletCounterpartyConfiguration) {
  let options: WalletCounterpartyConfiguration | undefined;
  const liveOptions = () => readLatest?.() ?? options;
  let target = '';
  let source = '';
  let generation = 0;
  let automaticStarted = false;
  const attempted = new Set<string>();
  const failed = new Set<string>();
  const listeners = new Set<() => void>();
  let wave: { controller: AbortController; ids: string[] } | undefined;
  let snapshot: WalletCounterpartyState = {
    loading: false,
    missingCount: 0,
    failedCount: 0,
    nonAddressCount: 0,
    unavailableCount: 0,
  };
  const planFor = (value: WalletCounterpartyConfiguration) =>
    walletCounterpartyInputPlan(value.workspace, value.wallet, value.groups);
  const refresh = () => {
    const plan = options?.active ? planFor(options) : undefined;
    const missing = new Set(plan?.missingIds);
    for (const id of failed) if (!missing.has(id)) failed.delete(id);
    const next = {
      loading: !!wave && !!options?.active && !!options?.enabled,
      missingCount: missing.size,
      failedCount: failed.size,
      nonAddressCount: plan?.nonAddressCount ?? 0,
      unavailableCount: plan?.unavailableCount ?? 0,
    };
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    if (!wave) return;
    wave.controller.abort();
    for (const id of wave.ids) attempted.delete(id);
    wave = undefined;
  };
  const start = (retryOnly = false) => {
    if (!options?.active || !options.enabled || wave) return;
    const current = options;
    const plan = planFor(current);
    const ids = plan.missingIds
      .filter((id) => (retryOnly ? failed.has(id) : !attempted.has(id) && !failed.has(id)))
      .slice(0, WALLET_FLOW_INPUT_WAVE_LIMIT);
    if (!ids.length || !plan.sourceKey) return;
    const controller = new AbortController();
    const owned = { controller, ids };
    wave = owned;
    const captured = generation;
    const valid = () => {
      const latest = liveOptions();
      return (
        !controller.signal.aborted &&
        generation === captured &&
        !!latest?.active &&
        latest.enabled &&
        latest.wallet.id === plan.walletId &&
        latest.workspace.id === plan.workspaceId &&
        latest.workspace.network === plan.network &&
        sourceEvidence(latest.workspace, plan.walletId, plan.contexts).sourceKey === plan.sourceKey
      );
    };
    for (const id of ids) {
      attempted.add(id);
      failed.delete(id);
    }
    refresh();
    void (async () => {
      const result = await loadWalletFlowInputWave(
        plan.network,
        ids,
        async (network, id, signal) => {
          if (!valid()) {
            controller.abort();
            signal.throwIfAborted();
          }
          // Another local loader may fill queued parents while four requests are in flight.
          const cached = liveOptions()?.workspace.transactions[id];
          return cached ?? current.fetch(network, id, signal);
        },
        controller.signal,
      );
      if (!valid()) return;
      for (const id of result.failed) failed.add(id);
      const refs = plan.contexts.flatMap((context) => context.refs);
      const additions = result.loaded.filter((transaction) => {
        if (liveOptions()?.workspace.transactions[transaction.txid]) return false;
        const usable = refs.some(
          (ref) =>
            ref.txid === transaction.txid &&
            transaction.vout.some((output) => output.n === ref.vout),
        );
        if (!usable) failed.add(transaction.txid);
        return usable;
      });
      if (additions.length)
        current.update(
          plan.workspaceId,
          (workspace) =>
            valid() ? mergeWalletCounterpartyInputs(workspace, plan, additions) : workspace,
          false,
        );
    })()
      .catch(() => {
        if (!valid()) return;
        for (const id of ids) failed.add(id);
      })
      .finally(() => {
        if (wave !== owned) return;
        wave = undefined;
        refresh();
      });
  };
  return {
    configure(next: WalletCounterpartyConfiguration) {
      const key = JSON.stringify([next.workspace.id, next.workspace.network, next.wallet.id]);
      const activated = next.active && !options?.active;
      if (key !== target || activated) {
        cancel();
        generation++;
        automaticStarted = false;
        attempted.clear();
        failed.clear();
      }
      const nextSource = next.active ? planFor(next).sourceKey : '';
      if (nextSource !== source || !next.active || !next.enabled) {
        cancel();
        generation++;
      }
      options = next;
      target = key;
      source = nextSource;
      refresh();
      if (next.active && next.enabled && !automaticStarted) {
        automaticStarted = true;
        start();
      }
    },
    stop() {
      cancel();
      options = undefined;
      generation++;
      target = '';
      source = '';
      automaticStarted = false;
      attempted.clear();
      failed.clear();
      refresh();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    loadMore: () => start(),
    retry: () => start(true),
  };
}
