import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Network, Pencil, Tag, Smile, X } from 'lucide-react';
import { fetchTransaction } from '../lib/api';
import { traceSourceExists } from '../lib/tracing';
import { outputAddress } from '../domain/workspace';
import {
  formatSats,
  outputNodeId,
  sats,
  short,
  txNodeId,
  type GraphNode,
  type Transaction,
  type Workspace,
} from '../domain/types';
import {
  continuationHint,
  loadedSpenders,
  searchTraceSpenders,
  selectedOutpoint,
  traceId,
  TRACE_CANDIDATE_LIMIT,
  TRACE_TIMEOUT_MS,
  TRACE_TRAIL_LIMIT,
  type TraceOutpoint,
} from '../domain/traceWorkbench';
import './trace-workbench.css';

export interface TraceWorkbenchProps {
  workspace: Workspace;
  selected?: GraphNode;
  active: boolean;
  canQuery: boolean;
  queryDisabledReason?: string;
  onSelect: (id: string) => void;
  onMerge: (transactions: Transaction[], requiredSourceId: string) => boolean;
  onGraph: (id: string) => void;
  onAnnotate: (id: string, target: 'label' | 'tags' | 'icon') => void;
  renderMetadata?: (id: string) => ReactNode;
}
type Choices = { direction: 'backward' | 'forward'; txids: string[] };
type TrailEntry = { point: TraceOutpoint; via: string };

export function TraceWorkbench({
  workspace,
  selected,
  active,
  canQuery,
  queryDisabledReason,
  onSelect,
  onMerge,
  onGraph,
  onAnnotate,
  renderMetadata,
}: TraceWorkbenchProps) {
  const point = selectedOutpoint(selected);
  const pointId = point && traceId(point);
  const sourceExists = useMemo(
    () => !!pointId && traceSourceExists(workspace, pointId),
    [workspace.transactions, pointId],
  );
  const creator = point && workspace.transactions[point.txid];
  const output = creator && creator.vout.find((item) => item.n === point.vout);
  const spenders = useMemo(
    () => (point ? loadedSpenders(workspace, point) : []),
    [workspace.transactions, pointId],
  );
  const [choices, setChoices] = useState<Choices>();
  const [branch, setBranch] = useState('');
  const [message, setMessage] = useState('');
  const [unspentObservation, setUnspentObservation] = useState<{
    scope: string;
    checkedAt: string;
  }>();
  const observationScope = `${workspace.id}:${workspace.network}:${pointId}`;
  const observedUnspentAt =
    unspentObservation?.scope === observationScope ? unspentObservation.checkedAt : undefined;
  const [busy, setBusy] = useState(false);
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const request = useRef<AbortController | undefined>(undefined);
  const source = useRef({
    workspaceId: workspace.id,
    network: workspace.network,
    pointId,
    active,
    transactions: workspace.transactions,
  });
  source.current = {
    workspaceId: workspace.id,
    network: workspace.network,
    pointId,
    active,
    transactions: workspace.transactions,
  };

  useEffect(() => {
    request.current?.abort();
    request.current = undefined;
    setBusy(false);
    return () => request.current?.abort();
  }, [active, workspace.id, workspace.network, pointId, sourceExists]);
  useEffect(() => {
    setTrail([]);
    setChoices(undefined);
    setMessage('');
  }, [workspace.id, workspace.network]);
  useEffect(() => {
    setChoices(undefined);
    setBranch('');
    setMessage('');
  }, [pointId]);
  useEffect(() => {
    setUnspentObservation(undefined);
  }, [observationScope, sourceExists]);
  useEffect(() => {
    if (active && point)
      setTrail((previous) =>
        previous.at(-1) && traceId(previous.at(-1)!.point) === traceId(point)
          ? previous
          : [...previous, { point, via: 'Selected output' }].slice(-TRACE_TRAIL_LIMIT),
      );
  }, [pointId, active]);

  function go(next: TraceOutpoint, via: string) {
    request.current?.abort();
    setTrail((previous) => [...previous, { point: next, via }].slice(-TRACE_TRAIL_LIMIT));
    onSelect(traceId(next));
  }
  function offer(direction: Choices['direction'], txs: Transaction[]) {
    setChoices({ direction, txids: txs.map((tx) => tx.txid) });
    setBranch('');
  }
  async function scan(direction: Choices['direction']) {
    if (!point || !pointId || busy || !active || !sourceExists) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setChoices(undefined);
    setMessage('');
    setUnspentObservation(undefined);
    const expected = { workspaceId: workspace.id, network: workspace.network, pointId };
    const valid = () =>
      !controller.signal.aborted &&
      source.current.active &&
      source.current.workspaceId === expected.workspaceId &&
      source.current.network === expected.network &&
      source.current.pointId === expected.pointId;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TRACE_TIMEOUT_MS);
    try {
      let tx = creator;
      if (!tx) {
        if (!canQuery) {
          setMessage(queryDisabledReason || 'Live lookup is unavailable. Select a loaded output.');
          return;
        }
        tx = await fetchTransaction(workspace.network, point.txid, controller.signal);
        if (!valid() || !onMerge([tx], pointId)) return;
      }
      if (!tx.vout.some((item) => item.n === point.vout)) {
        setMessage('This output is missing from its creating transaction.');
        return;
      }
      if (direction === 'backward') {
        offer('backward', [tx]);
        setMessage(
          tx.vin.some((input) => input.coinbase !== undefined)
            ? 'Coinbase transaction: there is no previous outpoint to follow.'
            : 'The creating transaction is exact. Choosing one of its inputs is a branch choice, not a proven mapping to this output.',
        );
      } else if (spenders.length) {
        offer('forward', spenders);
        setMessage(
          'Loaded spending transactions reference this exact outpoint. These are saved observations, not a current confirmation check. Choose an output to continue through the transaction.',
        );
      } else {
        if (!canQuery) {
          setMessage(
            queryDisabledReason ||
              'No spender loaded. Live lookup is unavailable; spending status is unknown.',
          );
          return;
        }
        const result = await searchTraceSpenders(
          { ...workspace, transactions: { ...workspace.transactions, [tx.txid]: tx } },
          point,
          controller.signal,
        );
        if (
          !valid() ||
          !onMerge([], pointId) ||
          (result.transactions.length > 0 && !onMerge(result.transactions, pointId))
        )
          return;
        if (result.transactions.length) offer('forward', result.transactions);
        if (result.observation?.status === 'unspent')
          setUnspentObservation({
            scope: observationScope,
            checkedAt: result.observation.checkedAt,
          });
        const coverage = `Checked ${result.inspected} history candidates. ${result.remaining ? `${result.remaining} beyond the ${TRACE_CANDIDATE_LIMIT}-candidate limit. ` : ''}${result.failed ? `${result.failed} failed lookups. Partial results. ` : ''}${result.statusUnavailable ? 'Current UTXO check unavailable. ' : ''}`;
        setMessage(
          result.observation?.status === 'unspent'
            ? `Observed unspent at ${new Date(result.observation.checkedAt).toLocaleTimeString()}, with mempool spends included. This temporary observation can change.`
            : `${result.transactions.length ? 'Exact spending outpoint link found. Choose an output to continue.' : 'No spender found in this bounded search. Spending status remains unknown; absence is not proof of an unspent output.'} ${coverage}`,
        );
      }
    } catch {
      if (
        request.current === controller &&
        source.current.active &&
        source.current.pointId === expected.pointId
      )
        setMessage(
          timedOut
            ? 'Lookup timed out after 15 seconds. No unfinished results were added. Try again or inspect loaded data.'
            : controller.signal.aborted
              ? 'Lookup cancelled. No unfinished results were added.'
              : 'Lookup failed. Loaded data remains available; spending status is unknown.',
        );
    } finally {
      clearTimeout(timer);
      if (request.current === controller) {
        request.current = undefined;
        setBusy(false);
      }
    }
  }

  const choiceTransactions =
    choices?.txids.flatMap((id) =>
      workspace.transactions[id] ? [workspace.transactions[id]] : [],
    ) ?? [];
  const branches = choiceTransactions.flatMap((tx) =>
    choices?.direction === 'backward'
      ? tx.vin.flatMap((input) =>
          input.txid !== undefined && input.vout !== undefined
            ? [
                {
                  point: { txid: input.txid, vout: input.vout },
                  label: `${short(input.txid)}:${input.vout}`,
                  via: `Backward branch through ${short(tx.txid)}; exact input outpoint`,
                },
              ]
            : [],
        )
      : tx.vout.map((item) => ({
          point: { txid: tx.txid, vout: item.n },
          label: `${short(tx.txid)}:${item.n} · ${formatSats(sats(item.value))}${item.scriptPubKey.type === 'nulldata' ? ' · Unspendable data' : ''}`,
          via: `Forward branch through ${short(tx.txid)}; chosen output, no satoshi mapping`,
        })),
  );
  const selectedBranch = branches.find((item) => traceId(item.point) === branch);
  const entryOutputs =
    !point && (selected?.kind === 'transaction' || selected?.kind === 'address')
      ? Object.values(workspace.transactions).flatMap((tx) =>
          tx.vout
            .filter((item) =>
              selected?.kind === 'transaction'
                ? tx.txid === selected.txid
                : selected?.kind === 'address'
                  ? outputAddress(item) === selected.address
                  : false,
            )
            .map((item) => ({ txid: tx.txid, output: item })),
        )
      : [];

  return (
    <section className="trace-workbench" aria-label="Trace workbench" hidden={!active}>
      <header className="trace-heading">
        <div>
          <h1>Trace</h1>
          <p>Follow one output branch at a time.</p>
        </div>
        {pointId && (
          <button onClick={() => onGraph(pointId)}>
            <Network size={14} /> Graph
          </button>
        )}
      </header>
      {!point ? (
        <div className="trace-empty">
          <h2>Choose an output to begin</h2>
          <p>
            Select an output or input in Graph, or choose a loaded output from the current
            transaction or address. No branch is chosen automatically.
          </p>
          {entryOutputs.length > 0 ? (
            <label>
              Output
              <select
                aria-label="Choose trace output"
                value=""
                onChange={(event) => onSelect(event.target.value)}
              >
                <option value="">Choose an outpoint…</option>
                {entryOutputs.map(({ txid, output: item }) => (
                  <option key={outputNodeId(txid, item.n)} value={outputNodeId(txid, item.n)}>
                    {short(txid)}:{item.n} · {formatSats(sats(item.value))}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No output choices are loaded for this selection. Select an output in Graph.</p>
          )}
        </div>
      ) : (
        <>
          <p className="trace-limits">
            Loaded data first. Forward lookup checks one script history and at most{' '}
            {TRACE_CANDIDATE_LIMIT} candidate transactions, with a 15-second timeout. No recursive
            scan.
          </p>
          {!canQuery && (
            <p className="trace-notice">
              {queryDisabledReason ||
                'Live queries are unavailable. Loaded branches remain available.'}
            </p>
          )}
          <div className="trace-flow">
            <div className="trace-neighbor">
              <span>Previous</span>
              <strong>Creating transaction</strong>
              <button
                className="trace-id"
                disabled={!creator}
                onClick={() => onGraph(txNodeId(point.txid))}
              >
                {short(point.txid)}
              </button>
              <small>Exact creation link</small>
              <button disabled={busy || !sourceExists} onClick={() => void scan('backward')}>
                <ArrowLeft size={14} /> Scan backward
              </button>
            </div>
            <div className="trace-current">
              <span>Current output</span>
              <strong className="trace-id" title={`${point.txid}:${point.vout}`}>
                {short(point.txid)}:{point.vout}
              </strong>
              <details className="trace-outpoint">
                <summary>Full outpoint</summary>
                <code>
                  {point.txid}:{point.vout}
                </code>
              </details>
              <strong>{formatSats(output ? sats(output.value) : selected?.value)}</strong>
              <small>
                {output
                  ? output.scriptPubKey.type || 'Script type unknown'
                  : 'Creating transaction not loaded'}
              </small>
              {workspace.annotations[pointId!]?.label && (
                <p>{workspace.annotations[pointId!].label}</p>
              )}
              {renderMetadata?.(pointId!)}
              <div className="trace-metadata">
                <button onClick={() => onAnnotate(pointId!, 'label')}>
                  <Pencil size={13} /> Label
                </button>
                <button onClick={() => onAnnotate(pointId!, 'tags')}>
                  <Tag size={13} /> Tags
                </button>
                <button onClick={() => onAnnotate(pointId!, 'icon')}>
                  <Smile size={13} /> Icon
                </button>
              </div>
              {!renderMetadata &&
                (workspace.tags ?? []).some((tag) => tag.nodeIds.includes(pointId!)) && (
                  <small>
                    Tags:{' '}
                    {(workspace.tags ?? [])
                      .filter((tag) => tag.nodeIds.includes(pointId!))
                      .map((tag) => tag.name)
                      .join(', ')}
                  </small>
                )}
            </div>
            <div className="trace-neighbor">
              <span>Next</span>
              <strong>Spending transaction</strong>
              {spenders.length ? (
                <span>
                  {spenders.length === 1
                    ? short(spenders[0].txid)
                    : 'Multiple loaded spend alternatives'}
                </span>
              ) : observedUnspentAt ? (
                <small>
                  Observed unspent at {new Date(observedUnspentAt).toLocaleTimeString()}.
                </small>
              ) : (
                <small>No spender loaded. Status unknown.</small>
              )}
              <small>
                {spenders.length
                  ? 'Exact input outpoint link'
                  : observedUnspentAt
                    ? 'Temporary Core observation, including mempool spends'
                    : 'Search only this output'}
              </small>
              <button disabled={busy || !sourceExists} onClick={() => void scan('forward')}>
                <ArrowRight size={14} /> Scan forward
              </button>
            </div>
          </div>
          <div aria-live="polite" className="trace-status">
            {busy ? (
              <p>
                Looking up this branch…{' '}
                <button onClick={() => request.current?.abort()}>
                  <X size={13} /> Cancel
                </button>
              </p>
            ) : (
              message && (
                <p>
                  {observedUnspentAt && spenders.length
                    ? 'Loaded spending transactions now reference this exact outpoint. The earlier unspent observation is no longer used.'
                    : message}
                </p>
              )
            )}
          </div>
          {choices && (
            <section className="trace-choices" aria-label="Choose continuation">
              <h2>
                {choices.direction === 'backward'
                  ? 'Choose a previous input'
                  : 'Choose a next output'}
              </h2>
              {choiceTransactions.map((tx) => {
                const hint = continuationHint(tx);
                return (
                  <div key={tx.txid} className="trace-explanation">
                    <button className="trace-id" onClick={() => onGraph(txNodeId(tx.txid))}>
                      {short(tx.txid)}
                    </button>
                    <strong>
                      {choices.direction === 'backward' ? 'Input branch choice' : hint.title}
                    </strong>
                    <p>
                      {choices.direction === 'backward'
                        ? `${tx.vin.length} inputs created ${tx.vout.length} outputs. Bitcoin does not identify which input funded this particular output. ${tx.vin.length > 1 ? 'Collaborative funding, including PayJoin, cannot be ruled out.' : 'The input outpoint link is exact; ownership continuity is not established.'}`
                        : hint.explanation}
                    </p>
                  </div>
                );
              })}
              {branches.length > 0 && (
                <div className="trace-choice-row">
                  <label>
                    Branch
                    <select
                      aria-label="Trace branch"
                      value={branch}
                      onChange={(event) => setBranch(event.target.value)}
                    >
                      <option value="">Choose an outpoint…</option>
                      {branches.map((item) => (
                        <option key={traceId(item.point)} value={traceId(item.point)}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!selectedBranch}
                    onClick={() => selectedBranch && go(selectedBranch.point, selectedBranch.via)}
                  >
                    <ArrowRight size={14} /> Follow selected branch
                  </button>
                </div>
              )}
            </section>
          )}
          <p className="trace-footnote">
            Creating and spending links name exact outpoints. Continuing through a transaction is
            your chosen branch, not an authoritative satoshi path or proof of common ownership.
          </p>
          <section className="trace-trail" aria-label="Trace trail">
            <div className="trace-trail-heading">
              <h2>Trail</h2>
              {trail.length > 1 && (
                <button
                  disabled={!traceSourceExists(workspace, traceId(trail[trail.length - 2].point))}
                  onClick={() => {
                    const previous = trail[trail.length - 2];
                    setTrail(trail.slice(0, -1));
                    onSelect(traceId(previous.point));
                  }}
                >
                  <ArrowLeft size={13} /> Back in trail
                </button>
              )}
            </div>
            <p>Session only. Keeps the latest {TRACE_TRAIL_LIMIT} selections.</p>
            <ol>
              {trail.map((item, index) => (
                <li key={`${traceId(item.point)}:${index}`}>
                  <button
                    aria-current={index === trail.length - 1 ? 'step' : undefined}
                    disabled={!traceSourceExists(workspace, traceId(item.point))}
                    onClick={() => {
                      setTrail(trail.slice(0, index + 1));
                      onSelect(traceId(item.point));
                    }}
                  >
                    {short(item.point.txid)}:{item.point.vout}
                  </button>
                  <span>
                    {item.via}
                    {!workspace.transactions[item.point.txid] ? ' · Transaction not loaded' : ''}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </section>
  );
}
