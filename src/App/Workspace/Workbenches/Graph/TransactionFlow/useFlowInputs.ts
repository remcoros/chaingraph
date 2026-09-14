import { TRANSACTION_BATCH_CONCURRENCY } from '../../../../../Infra/Bitcoin/transactionScheduler';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  flowInputPlan,
  mergeFlowInputs,
  type FlowPlanWorkspace,
} from '../../../../../Domain/Chain/flowInputs';
import type { GraphNode, Transaction, Workspace } from '../../../../../Domain/types';
import { relatedTransactions } from '../../../../../Domain/Chain/transactionInspection';
import { indexPreviousOutputs } from '../../../../../Domain/Chain/prevouts';
import { indexLoadedSpends } from '../../../../../Domain/Chain/transactionFlow';
import { mapLimit } from '../../../../../Infra/Bitcoin/api';

/** Default navigation resolves only the selected outpoint. Bulk input details are explicit. */
export function useFlowInputs(options: {
  workspace?: Workspace;
  selected?: GraphNode;
  enabled: boolean;
  fetch: (id: string, signal: AbortSignal) => Promise<Transaction>;
  update: (id: string, edit: (current: Workspace) => Workspace, undo?: boolean) => void;
}) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const workspace = options.workspace;
  const transactions = workspace?.transactions;
  const network = workspace?.network;
  const selected = options.selected;
  const flowState = workspace?.view.transactionFlow;
  const flowWorkspace = useMemo<FlowPlanWorkspace | undefined>(
    () =>
      transactions && network
        ? { network, transactions, view: { transactionFlow: flowState } }
        : undefined,
    [transactions, network, flowState],
  );
  // These indexes cover all loaded transactions. Keep them stable across selection
  // and presentation updates so an inspection click only resolves its local flow.
  const spends = useMemo(
    () => (transactions ? indexLoadedSpends(transactions) : undefined),
    [transactions],
  );
  const related = useMemo(
    () => (transactions && selected ? relatedTransactions(transactions, selected, spends) : []),
    [transactions, selected, spends],
  );
  const prevouts = useMemo(
    () => (transactions && network ? indexPreviousOutputs({ transactions, network }) : new Map()),
    [transactions, network],
  );
  const plans = useMemo(
    () =>
      flowWorkspace
        ? {
            selected: flowInputPlan(flowWorkspace, selected, false, { related, prevouts }),
            all: flowInputPlan(flowWorkspace, selected, true, { related, prevouts }),
          }
        : undefined,
    [flowWorkspace, selected, related, prevouts],
  );
  const selectedPlan = plans?.selected;
  const allPlan = plans?.all;
  const target =
    options.workspace && options.selected
      ? `${options.workspace.id}:${options.workspace.network}:${selectedPlan?.transactionId ?? ''}:${options.selected.id}`
      : '';
  const enabled = options.enabled && options.workspace?.view.transactionFlow?.open !== false;
  const [attempt, setAttempt] = useState(0);
  const [bulkTarget, setBulkTarget] = useState('');
  const allInputs = bulkTarget === target;
  // Returning to an earlier selection must not silently repeat a bulk action.
  useEffect(() => setBulkTarget(''), [target]);
  const missingInputCount = allPlan?.missing.length ?? 0;
  const [state, setState] = useState({ target: '', loading: false, error: '' });
  const activePlan = allInputs ? allPlan : selectedPlan;
  const hasMissingInputs = (activePlan?.missing.length ?? 0) > 0;
  useEffect(() => {
    if (!target || !enabled) return;
    const { workspace, selected, fetch, update } = latest.current;
    if (!workspace) return;
    if (!activePlan) return;
    const { transactionId, missing } = activePlan;
    update(
      workspace.id,
      (current) => mergeFlowInputs(current, transactionId, selected, [], allInputs),
      false,
    );
    if (!missing.length) return;
    const controller = new AbortController();
    setState({ target, loading: true, error: '' });
    // Pin the displayed transaction before parent arrivals can change related-transaction ordering.
    if (transactionId && workspace.view.transactionFlow?.transactionId !== transactionId)
      update(
        workspace.id,
        (current) => ({
          ...current,
          view: {
            ...current.view,
            transactionFlow: { ...current.view.transactionFlow, transactionId },
          },
        }),
        false,
      );
    void (async () => {
      const loaded: Transaction[] = [];
      let failed = 0;
      const reasons = new Set<string>();
      await mapLimit(missing.slice(0, 500), TRANSACTION_BATCH_CONCURRENCY, async (id) => {
        try {
          const tx = await fetch(id, controller.signal);
          controller.signal.throwIfAborted();
          loaded.push(tx);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          failed = failed + 1;
          // Categorize known backend failures without echoing arbitrary exception text.
          const message = error instanceof Error ? error.message.toLowerCase() : '';
          if (message.includes('timed out')) reasons.add('The backend request timed out.');
          else if (message.includes('size limit'))
            reasons.add('The backend response exceeded its size limit.');
          else if (message.includes('rate limit'))
            reasons.add('The backend rate limit was reached.');
          else if (message.includes('disconnected') || message.includes('connection failed'))
            reasons.add('The backend connection is unavailable.');
          else if (message === 'electrum rejected the request')
            reasons.add('Electrum rejected the transaction request.');
        }
      });
      controller.signal.throwIfAborted();
      if (loaded.length)
        update(
          workspace.id,
          (current) => mergeFlowInputs(current, transactionId, selected, loaded, allInputs),
          false,
        );
      setState({
        target,
        loading: false,
        error: failed
          ? `${failed} ${allInputs ? 'input' : 'creating'} transaction${failed === 1 ? '' : 's'} could not be loaded from the backend. ${loaded.length ? `${loaded.length} loaded successfully. ` : ''}${[...reasons].join(' ')}${reasons.size ? ' ' : ''}Retry this request; other paths have not been followed.`
          : missing.length > 500
            ? 'Loaded 500 input transactions. Continue to load the remaining inputs.'
            : '',
      });
    })().catch(() => {
      if (!controller.signal.aborted)
        setState({
          target,
          loading: false,
          error: 'Input transactions could not be added. Check workspace limits and retry.',
        });
    });
    return () => controller.abort();
  }, [target, enabled, attempt, allInputs, activePlan]);
  return {
    missingInputCount,
    onLoadAllInputs: () => {
      setBulkTarget(target);
      setAttempt((value) => value + 1);
    },
    inputLoading: enabled && hasMissingInputs && state.target === target && state.loading,
    inputError: hasMissingInputs && state.target === target ? state.error : '',
    onRetryInputs: () => setAttempt((value) => value + 1),
  };
}
