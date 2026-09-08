import { useEffect, useRef, useState } from 'react';
import type { GraphNode, Transaction, Workspace } from '../domain/types';
import { relatedTransactions } from '../domain/transactionInspection';
import { mapLimit } from './api';

/** Only the displayed transaction's direct inputs, never recursive graph expansion. */
export function flowInputPlan(workspace: Workspace, selected?: GraphNode) {
  const related = selected ? relatedTransactions(workspace.transactions, selected) : [];
  const current =
    related.find(({ tx }) => tx.txid === workspace.view.transactionFlow?.transactionId) ??
    related[0];
  const missing = new Set(
    current?.tx.vin.flatMap((input) =>
      input.txid && !workspace.transactions[input.txid] ? [input.txid] : [],
    ) ?? [],
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
) {
  // A removal may complete while its input requests are in flight. Never restore
  // the removed investigation branch when those requests finally arrive.
  if (transactionId && !workspace.transactions[transactionId]) return workspace;
  const context = { ...workspace.inputContext };
  const provenance = new Set([...(workspace.contextTransactionIds ?? []), ...Object.keys(context)]);
  const current = transactionId ? workspace.transactions[transactionId] : undefined;
  const references =
    current?.vin.flatMap((input) =>
      input.txid && input.vout !== undefined ? [{ txid: input.txid, vout: input.vout }] : [],
    ) ?? [];
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
  if (transactionId) delete context[transactionId];
  const inputContext = Object.keys(context).length ? context : undefined;
  if (!loaded.length && JSON.stringify(inputContext) === JSON.stringify(workspace.inputContext))
    return workspace;
  return {
    ...workspace,
    inputContext,
    contextTransactionIds: provenance.size ? [...provenance] : undefined,
    transactions: {
      ...workspace.transactions,
      ...Object.fromEntries(loaded.map((tx) => [tx.txid, tx])),
    },
  };
}

export function useFlowInputs(options: {
  workspace?: Workspace;
  selected?: GraphNode;
  enabled: boolean;
  fetch: (id: string, signal: AbortSignal) => Promise<Transaction>;
  update: (id: string, change: (current: Workspace) => Workspace, undo?: boolean) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const plan = options.workspace ? flowInputPlan(options.workspace, options.selected) : undefined;
  const target =
    options.workspace && options.selected
      ? `${options.workspace.id}:${options.workspace.network}:${plan?.transactionId ?? ''}:${options.selected.id}`
      : '';
  const enabled = options.enabled && options.workspace?.view.transactionFlow?.open !== false;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ target: '', loading: false, error: '' });
  useEffect(() => {
    if (!target || !enabled) return;
    const { workspace, selected, fetch, update } = latest.current;
    if (!workspace) return;
    const { transactionId, missing } = flowInputPlan(workspace, selected);
    update(workspace.id, (current) => mergeFlowInputs(current, transactionId, selected, []), false);
    if (!missing.length) {
      setState({ target, loading: false, error: '' });
      return;
    }
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
      await mapLimit(missing.slice(0, 500), 4, async (id) => {
        try {
          const tx = await fetch(id, controller.signal);
          controller.signal.throwIfAborted();
          loaded.push(tx);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          failed++;
        }
      });
      controller.signal.throwIfAborted();
      if (loaded.length)
        update(
          workspace.id,
          (current) => mergeFlowInputs(current, transactionId, selected, loaded),
          false,
        );
      setState({
        target,
        loading: false,
        error: failed
          ? `${failed} input transaction${failed === 1 ? '' : 's'} could not be loaded. Retry when the upstream is available.`
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
  }, [target, enabled, attempt]);
  return {
    inputLoading: enabled && state.target === target && state.loading,
    inputError: state.target === target ? state.error : '',
    onRetryInputs: () => setAttempt((value) => value + 1),
  };
}
