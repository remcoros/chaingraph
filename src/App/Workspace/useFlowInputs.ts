import { TRANSACTION_BATCH_CONCURRENCY } from '../../Infra/Bitcoin/transactionScheduler';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, Transaction, Workspace } from '../../Domain/types';
import { relatedTransactions } from '../../Domain/Chain/transactionInspection';
import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
} from '../../Domain/Chain/prevouts';
import { indexLoadedSpends } from '../../Domain/Chain/transactionFlow';
import { mergeTransactionObservations } from '../../Domain/Chain/prevouts';
import { mapLimit } from '../../Infra/Bitcoin/api';

type FlowPlanWorkspace = Pick<Workspace, 'network' | 'transactions'> & {
  view: Pick<Workspace['view'], 'transactionFlow'>;
};

/** Default navigation resolves only the selected outpoint. Bulk input details are explicit. */
export function flowInputPlan(
  workspace: FlowPlanWorkspace,
  selected?: GraphNode,
  allInputs = false,
  prepared?: {
    related: ReturnType<typeof relatedTransactions>;
    prevouts: PreviousOutputIndex;
  },
) {
  const related =
    prepared?.related ?? (selected ? relatedTransactions(workspace.transactions, selected) : []);
  const current =
    related.find(({ tx }) => tx.txid === workspace.view.transactionFlow?.transactionId) ??
    related[0];
  const prevouts = allInputs ? (prepared?.prevouts ?? indexPreviousOutputs(workspace)) : undefined;
  const missing = new Set(
    allInputs
      ? (current?.tx.vin.flatMap((input) => {
          if (!input.txid || workspace.transactions[input.txid]) return [];
          const resolution = resolvePreviousOutput(workspace, input, prevouts);
          return resolution.status === 'missing' || resolution.status === 'conflict'
            ? [input.txid]
            : [];
        }) ?? [])
      : [],
  );
  if (selected?.kind === 'output' && selected.txid && !workspace.transactions[selected.txid])
    missing.add(selected.txid);
  return { transactionId: current?.tx.txid, missing: [...missing] };
}

/** Keep automatically fetched parents as focused input context until explicitly inspected. */
export function mergeFlowInputs(
  workspace: Workspace,
  transactionId: string | undefined,
  selected: GraphNode | undefined,
  loaded: Transaction[],
  allInputs = false,
) {
  // A removal may complete while its input requests are in flight. Never restore
  // the removed investigation branch when those requests finally arrive.
  if (transactionId && !workspace.transactions[transactionId]) return workspace;
  const context = { ...workspace.inputContext };
  const provenance = new Set([...(workspace.contextTransactionIds ?? []), ...Object.keys(context)]);
  const current = transactionId ? workspace.transactions[transactionId] : undefined;
  const references = allInputs
    ? (current?.vin.flatMap((input) =>
        input.txid && input.vout !== undefined ? [{ txid: input.txid, vout: input.vout }] : [],
      ) ?? [])
    : [];
  if (selected?.kind === 'output' && selected.txid && selected.vout !== undefined)
    references.push({ txid: selected.txid, vout: selected.vout });
  const added = new Set(loaded.map((tx) => tx.txid));
  for (const ref of references) {
    if (ref.txid === transactionId) continue;
    if (context[ref.txid] || (added.has(ref.txid) && !workspace.transactions[ref.txid]))
      context[ref.txid] = [...new Set([...(context[ref.txid] ?? []), ref.vout])].sort(
        (a, b) => a - b,
      );
  }
  for (const tx of loaded) if (!workspace.transactions[tx.txid]) provenance.add(tx.txid);
  if (transactionId && (allInputs || selected?.kind !== 'output')) delete context[transactionId];
  const inputContext = Object.keys(context).length ? context : undefined;
  if (!loaded.length && JSON.stringify(inputContext) === JSON.stringify(workspace.inputContext))
    return workspace;
  return {
    ...workspace,
    inputContext,
    contextTransactionIds: provenance.size ? [...provenance] : undefined,
    transactions: loaded.length
      ? {
          ...workspace.transactions,
          ...Object.fromEntries(
            loaded.map((tx) => [
              tx.txid,
              mergeTransactionObservations(workspace.transactions[tx.txid], tx, workspace.network),
            ]),
          ),
        }
      : workspace.transactions,
  };
}

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
