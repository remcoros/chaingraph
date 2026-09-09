import { useEffect, useRef, useState } from 'react';
import type { PreviousOutputIndex } from '../domain/prevouts';
import type { Network, Transaction, Workspace } from '../domain/types';
import type { WalletReviewFlowEntry } from '../domain/walletReviewContext';
import {
  loadWalletFlowInputWave,
  mergeWalletFlowInputs,
  walletFlowInputPlan,
  walletFlowSourceKey,
} from './walletFlowInputs';

export { mergeWalletFlowInputs } from './walletFlowInputs';

interface Options {
  workspace: Workspace;
  /** Must describe the same immutable transaction snapshot and network. */
  prevouts?: PreviousOutputIndex;
  walletId: string;
  selectionKey: string;
  transactionId?: string;
  inputs: readonly WalletReviewFlowEntry[];
  enabled: boolean;
  fetch: (network: Network, id: string, signal: AbortSignal) => Promise<Transaction>;
  update: (id: string, change: (current: Workspace) => Workspace, undo?: boolean) => void;
}

function targetKey(options: Options) {
  return JSON.stringify([
    options.workspace.id,
    options.workspace.network,
    options.walletId,
    options.selectionKey,
    options.transactionId,
  ]);
}

/** Visible direct prevouts only, cancelled when the Wallet context or visibility changes. */
export function useWalletFlowInputs(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const target = targetKey(options);
  const source = walletFlowSourceKey(options.workspace, options.walletId, options.transactionId);
  const [attempt, setAttempt] = useState(0);
  const scopeKey = JSON.stringify([target, source, options.enabled]);
  const scope = useRef({
    key: scopeKey,
    attempt,
    attempted: new Set<string>(),
    failed: new Set<string>(),
    missingOutputs: new Set<string>(),
  });
  if (scope.current.key !== scopeKey)
    scope.current = {
      key: scopeKey,
      attempt,
      attempted: new Set(),
      failed: new Set(),
      missingOutputs: new Set(),
    };
  else if (scope.current.attempt !== attempt) {
    scope.current.attempt = attempt;
    scope.current.attempted = new Set(
      [...scope.current.missingOutputs].map((id) => id.split(':')[1]),
    );
    scope.current.failed.clear();
  }
  const plan = walletFlowInputPlan(
    options.workspace,
    options.walletId,
    options.transactionId,
    options.inputs,
    scope.current.attempted,
    options.prevouts,
  );
  const visibleKey = JSON.stringify(plan.refs);
  const cacheKey = JSON.stringify([plan.missing, plan.missingOutputCount]);
  const [state, setState] = useState({ key: '', loading: false, error: '' });
  useEffect(() => {
    if (!options.enabled || !source) return;
    const owned = scope.current;
    const { workspace, walletId, transactionId, inputs, fetch, update } = latest.current;
    const controller = new AbortController();
    const active = () =>
      !controller.signal.aborted &&
      scope.current === owned &&
      latest.current.enabled &&
      targetKey(latest.current) === target &&
      walletFlowSourceKey(latest.current.workspace, walletId, transactionId) === source &&
      JSON.stringify(
        walletFlowInputPlan(
          latest.current.workspace,
          walletId,
          transactionId,
          latest.current.inputs,
          undefined,
          latest.current.prevouts,
        ).refs,
      ) === visibleKey;
    const currentPlan = walletFlowInputPlan(
      workspace,
      walletId,
      transactionId,
      inputs,
      owned.attempted,
      latest.current.prevouts,
    );
    const message = () => {
      const absent =
        currentPlan.missingOutputCount > 0 ||
        currentPlan.refs.some((ref) => owned.missingOutputs.has(ref.id))
          ? 'A loaded parent does not contain the requested output. Other outputs were not substituted.'
          : '';
      const failedCount = currentPlan.missing.filter((id) => owned.failed.has(id)).length;
      const failed = failedCount
        ? `${failedCount} input transaction${failedCount === 1 ? '' : 's'} could not be loaded. Retry to try again.`
        : '';
      return [absent, failed].filter(Boolean).join(' ');
    };
    const ids = currentPlan.transactionIds;
    if (!ids.length) {
      setState({ key: scopeKey, loading: false, error: message() });
      return () => controller.abort();
    }
    ids.forEach((id) => owned.attempted.add(id));
    setState({ key: scopeKey, loading: true, error: message() });
    void (async () => {
      const result = await loadWalletFlowInputWave(
        workspace.network,
        ids,
        fetch,
        controller.signal,
      );
      if (!active()) return;
      result.failed.forEach((id) => owned.failed.add(id));
      for (const transaction of result.loaded)
        for (const ref of currentPlan.refs)
          if (
            ref.txid === transaction.txid &&
            !transaction.vout.some((output) => output.n === ref.vout)
          )
            owned.missingOutputs.add(ref.id);
      const additions = result.loaded.filter(
        (transaction) =>
          !latest.current.workspace.transactions[transaction.txid] &&
          currentPlan.refs.some(
            (ref) =>
              ref.txid === transaction.txid &&
              transaction.vout.some((output) => output.n === ref.vout),
          ),
      );
      if (additions.length)
        update(
          workspace.id,
          (current) =>
            active() &&
            current.id === workspace.id &&
            current.network === workspace.network &&
            walletFlowSourceKey(current, walletId, transactionId) === source
              ? mergeWalletFlowInputs(current, walletId, transactionId, inputs, additions)
              : current,
          false,
        );
      if (active()) setState({ key: scopeKey, loading: false, error: message() });
    })().catch(() => {
      if (!active()) return;
      ids.forEach((id) => owned.failed.add(id));
      setState({
        key: scopeKey,
        loading: false,
        error: 'Input details could not be added. Retry to try again.',
      });
    });
    return () => {
      controller.abort();
      // Unfinished requests can be tried again if a different visible range still needs them.
      ids.forEach((id) => {
        if (
          !owned.failed.has(id) &&
          !currentPlan.refs.some((ref) => ref.txid === id && owned.missingOutputs.has(ref.id))
        )
          owned.attempted.delete(id);
      });
    };
  }, [scopeKey, target, source, visibleKey, cacheKey, attempt, options.enabled]);
  const cachedError = plan.missingOutputCount
    ? 'A loaded parent does not contain the requested output. Other outputs were not substituted.'
    : '';
  return {
    loading: options.enabled && state.key === scopeKey && state.loading,
    error: options.enabled && source ? (state.key === scopeKey ? state.error : cachedError) : '',
    retry: () => setAttempt((value) => value + 1),
    pendingCount: plan.pendingCount,
  };
}
