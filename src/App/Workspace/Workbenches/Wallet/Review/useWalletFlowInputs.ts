import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { PreviousOutputIndex } from '../../../../../Domain/Chain/prevouts';
import type { Network } from '../../../../../Domain/Chain/network';
import type { Transaction } from '../../../../../Domain/Chain/transaction';
import type { Workspace } from '../../../workspace';
import type { WalletReviewFlowEntry } from '../walletReviewContext';
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
  update: (id: string, edit: (current: Workspace) => Workspace, undo?: boolean) => void;
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

interface FlowInputScope {
  key: string;
  attempt: number;
  attempted: string[];
  failed: string[];
  missingOutputs: string[];
}

function freshFlowInputScope(key: string, attempt: number): FlowInputScope {
  return { key, attempt, attempted: [], failed: [], missingOutputs: [] };
}

function currentFlowInputScope(scope: FlowInputScope, key: string, attempt: number) {
  if (scope.key !== key) return freshFlowInputScope(key, attempt);
  if (scope.attempt === attempt) return scope;
  return {
    key,
    attempt,
    attempted: [
      ...new Set(scope.missingOutputs.map((id) => id.split(':')[1]).filter(Boolean)),
    ].sort(),
    failed: [],
    missingOutputs: scope.missingOutputs,
  };
}

function sortedIds(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

/** Visible direct prevouts only, cancelled when the Wallet context or visibility changes. */
export function useWalletFlowInputs(options: Options) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const target = targetKey(options);
  const source = walletFlowSourceKey(options.workspace, options.walletId, options.transactionId);
  const [attempt, setAttempt] = useState(0);
  const scopeKey = JSON.stringify([target, source, options.enabled]);
  const [scopeState, setScopeState] = useState<FlowInputScope>(() =>
    freshFlowInputScope(scopeKey, attempt),
  );
  const scope = currentFlowInputScope(scopeState, scopeKey, attempt);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Reports the outcome of fetching previous outputs for a review row.
    if (scope !== scopeState) setScopeState(scope);
  }, [scope, scopeState]);
  const attempted = new Set(scope.attempted);
  const currentScope = useEffectEvent(() => ({
    attempted: new Set(scope.attempted),
    failed: new Set(scope.failed),
    missingOutputs: new Set(scope.missingOutputs),
  }));
  const plan = walletFlowInputPlan(
    options.workspace,
    options.walletId,
    options.transactionId,
    options.inputs,
    attempted,
    options.prevouts,
  );
  const visibleKey = JSON.stringify(plan.refs);
  const cacheKey = JSON.stringify([plan.missing, plan.missingOutputCount]);
  const [state, setState] = useState({ key: '', loading: false, error: '' });
  useEffect(() => {
    if (!options.enabled || !source) return;
    const {
      attempted: ownedAttempted,
      failed: ownedFailed,
      missingOutputs: ownedMissingOutputs,
    } = currentScope();
    const { workspace, walletId, transactionId, inputs, fetch, update } = latest.current;
    const controller = new AbortController();
    const active = () =>
      !controller.signal.aborted &&
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
      ownedAttempted,
      latest.current.prevouts,
    );
    const message = () => {
      const absent =
        currentPlan.missingOutputCount > 0 ||
        currentPlan.refs.some((ref) => ownedMissingOutputs.has(ref.id))
          ? 'A loaded parent does not contain the requested output. Other outputs were not substituted.'
          : '';
      const failedCount = currentPlan.missing.filter((id) => ownedFailed.has(id)).length;
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
    ids.forEach((id) => ownedAttempted.add(id));
    setScopeState((current) =>
      current.key === scopeKey && current.attempt === attempt
        ? { ...current, attempted: sortedIds([...current.attempted, ...ids]) }
        : current,
    );
    setState({ key: scopeKey, loading: true, error: message() });
    let finished = false;
    void (async () => {
      const result = await loadWalletFlowInputWave(
        workspace.network,
        ids,
        fetch,
        controller.signal,
      );
      if (!active()) return;
      result.failed.forEach((id) => ownedFailed.add(id));
      for (const transaction of result.loaded)
        for (const ref of currentPlan.refs)
          if (
            ref.txid === transaction.txid &&
            !transaction.vout.some((output) => output.n === ref.vout)
          )
            ownedMissingOutputs.add(ref.id);
      setScopeState((current) =>
        current.key === scopeKey && current.attempt === attempt
          ? {
              ...current,
              attempted: sortedIds([...current.attempted, ...ownedAttempted]),
              failed: sortedIds(ownedFailed),
              missingOutputs: sortedIds(ownedMissingOutputs),
            }
          : current,
      );
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
      finished = true;
    })().catch(() => {
      if (!active()) return;
      ids.forEach((id) => ownedFailed.add(id));
      setScopeState((current) =>
        current.key === scopeKey && current.attempt === attempt
          ? {
              ...current,
              attempted: sortedIds([...current.attempted, ...ownedAttempted]),
              failed: sortedIds(ownedFailed),
              missingOutputs: sortedIds(ownedMissingOutputs),
            }
          : current,
      );
      setState({
        key: scopeKey,
        loading: false,
        error: 'Input details could not be added. Retry to try again.',
      });
      finished = true;
    });
    return () => {
      controller.abort();
      // Unfinished requests can be tried again if a different visible range still needs them.
      if (finished) return;
      ids.forEach((id) => {
        if (
          !ownedFailed.has(id) &&
          !currentPlan.refs.some((ref) => ref.txid === id && ownedMissingOutputs.has(ref.id))
        )
          ownedAttempted.delete(id);
      });
      setScopeState((current) =>
        current.key === scopeKey && current.attempt === attempt
          ? {
              ...current,
              attempted: current.attempted.filter((id) => ownedAttempted.has(id)),
              failed: sortedIds(ownedFailed),
              missingOutputs: sortedIds(ownedMissingOutputs),
            }
          : current,
      );
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
