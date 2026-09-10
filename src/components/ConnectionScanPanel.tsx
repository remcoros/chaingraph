import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Crosshair,
  Info,
  LoaderCircle,
  Plus,
  ScanLine,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { short, type Transaction, type Workspace } from '../domain/types';
import {
  DEFAULT_SCAN_SETTINGS,
  SCAN_LIMITS,
  type ScanResult,
  type ScanRun,
  type ScanSettings,
  type ScanStopReason,
} from '../domain/connectionScan';
import { replaceScanRun, clearScanRuns, prepareScanPath } from '../domain/connectionScanRecords';
import { runConnectionScanInWorker } from '../lib/connectionScanRunner';
import type { TransactionFetchScope } from '../lib/transactionScheduler';
import { traceSourceExists } from '../lib/tracing';
import { indexLoadedSpends } from '../domain/transactionFlow';
import { presentScanRun, scanStatus } from '../domain/connectionScanPresentation';
import './connection-scan.css';

const reasons: Record<ScanStopReason, string> = {
  depth: 'Hop limit',
  'fan-out': 'Branch limit',
  time: 'Time limit',
  transactions: 'Transaction limit',
  unknown: 'Missing chain data',
  failure: 'Lookup failed',
  results: 'Result limit',
  cancelled: 'Cancelled',
};
const eligible = (id?: string): id is string => !!id && /^(tx|out):/.test(id);
const nameFor = (workspace: Workspace, id: string) => workspace.annotations[id]?.label || short(id);

type Props = {
  workspace: Workspace;
  selectionId?: string;
  visibleNodeIds: string[];
  addedNodeIds: string[];
  loadedSpenders: ReadonlyMap<string, readonly string[]>;
  active: boolean;
  canQuery: boolean;
  scope: TransactionFetchScope;
  isCurrent: () => boolean;
  onChange: (update: (workspace: Workspace) => Workspace, undo?: boolean) => void;
  onSelect: (id: string) => void;
  onAdd: (result: ScanResult, prefixLength: number, evidence?: Record<string, Transaction>) => void;
};

/** A run owns its source and targets. Selection only supplies an explicit new run. */
export function ConnectionScanPanel(props: Props) {
  const { workspace, selectionId, active, scope, canQuery, onChange, onSelect } = props;
  const [settings, setSettings] = useState<ScanSettings>(() => ({
    ...(workspace.connectionScans?.runs.at(-1)?.settings ?? DEFAULT_SCAN_SETTINGS),
  }));
  const [liveRun, setLiveRun] = useState<ScanRun>();
  const [transientEvidence, setTransientEvidence] = useState<Record<string, Transaction>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'connection' | 'boundary'>('all');
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const dismissed = useRef(new Set<string>());
  const latestProgress = useRef<
    { run: ScanRun; evidence: Record<string, Transaction> } | undefined
  >(undefined);
  const current = useRef(props);
  current.current = props;
  const runs = workspace.connectionScans?.runs ?? [];
  const rawRun = liveRun ?? runs.at(-1);
  const run = rawRun ? presentScanRun(rawRun, dismissed.current) : undefined;
  const source = selectionId;
  const savedSpenders = useMemo(
    () => indexLoadedSpends(workspace.connectionScans?.evidence ?? {}),
    [workspace.connectionScans?.evidence],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) controller.current?.abort();
  }, [active]);

  function clearResults() {
    controller.current?.abort();
    controller.current = undefined;
    setBusy(false);
    setLiveRun(undefined);
    setTransientEvidence(undefined);
    setError('');
    setFilter('all');
    dismissed.current.clear();
    latestProgress.current = undefined;
    onChange(clearScanRuns, false);
  }

  function retainResult(incoming: { run: ScanRun; evidence: Record<string, Transaction> }) {
    const result = { ...incoming, run: presentScanRun(incoming.run, dismissed.current) };
    latestProgress.current = result;
    setLiveRun(result.run);
    try {
      onChange((w) => replaceScanRun(w, result.run, result.evidence), false);
      setTransientEvidence(undefined);
      setError('');
    } catch {
      // Results remain usable in this session even if their evidence exceeds storage bounds.
      setTransientEvidence(result.evidence);
      try {
        onChange((w) => replaceScanRun(w, result.run), false);
      } catch {
        // The inline error also covers unavailable workspace storage or validation.
      }
      setError(
        'Some path evidence could not be retained. Add the path now or scan again after reopening.',
      );
    }
  }

  async function start(startSource: string | undefined) {
    if (!eligible(startSource) || busy || controller.current) return;
    setError('');
    const frozenSettings = { ...settings };
    for (const [key, label, maximum] of [
      ['maxHops', 'Max transaction hops', SCAN_LIMITS.maxHops],
      ['maxTransactions', 'Transactions examined', SCAN_LIMITS.maxTransactions],
      ['maxMilliseconds', 'Time limit in milliseconds', SCAN_LIMITS.maxMilliseconds],
      ['fanOut', 'Branch size', SCAN_LIMITS.fanOut],
    ] as const) {
      if (
        !Number.isSafeInteger(frozenSettings[key]) ||
        frozenSettings[key] < 1 ||
        frozenSettings[key] > maximum
      ) {
        setError(`${label} must be between 1 and ${maximum}.`);
        return;
      }
    }
    const targetIds = [
      ...new Set(
        (frozenSettings.targetScope === 'visible'
          ? props.visibleNodeIds
          : props.addedNodeIds
        ).filter((id) => eligible(id) && id !== startSource),
      ),
    ];
    if (targetIds.length > SCAN_LIMITS.maxTargets) {
      setError(`Choose a smaller graph scope: at most ${SCAN_LIMITS.maxTargets} targets per scan.`);
      return;
    }
    if (!targetIds.length) {
      setError('Add another transaction or output to the target scope first.');
      return;
    }
    if (!traceSourceExists(workspace, startSource)) {
      setError('Source evidence is no longer loaded. Add its saved path or load the source first.');
      return;
    }
    const initial: ScanRun = {
      id: crypto.randomUUID(),
      source: startSource,
      targetIds,
      settings: frozenSettings,
      startedAt: new Date().toISOString(),
      status: 'running',
      examined: 0,
      stopReasons: [],
      results: [],
    };
    try {
      onChange((w) => replaceScanRun(w, initial), false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Scan could not start.');
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    dismissed.current.clear();
    latestProgress.current = { run: initial, evidence: {} };
    setSettings(frozenSettings);
    setTransientEvidence(undefined);
    setLiveRun(initial);
    setFilter('all');
    try {
      const result = await runConnectionScanInWorker({
        request: {
          id: initial.id,
          source: startSource,
          targetIds,
          displayedNodeIds: [...props.visibleNodeIds],
          settings: frozenSettings,
        },
        network: workspace.network,
        transactions: { ...workspace.connectionScans?.evidence, ...workspace.transactions },
        loadedSpenders: (id) => [
          ...new Set([
            ...(props.loadedSpenders.get(id) ?? []),
            ...(savedSpenders.get(id)?.map((tx) => tx.txid) ?? []),
          ]),
        ],
        scope,
        signal: abort.signal,
        allowNetwork: canQuery,
        isCurrent: () => mounted.current && current.current.isCurrent(),
        onProgress: (progress, evidence) => {
          if (!mounted.current || controller.current !== abort || !current.current.isCurrent())
            return;
          const next = presentScanRun(progress, dismissed.current);
          if (next.results.length !== latestProgress.current?.run.results.length) {
            retainResult({ run: next, evidence });
          } else {
            latestProgress.current = { run: next, evidence };
            setLiveRun(next);
          }
        },
      });
      if (!mounted.current || controller.current !== abort || !current.current.isCurrent()) return;
      setLiveRun(result.run);
      retainResult(result);
    } catch {
      if (!mounted.current || controller.current !== abort || !current.current.isCurrent()) return;
      const failed: ScanRun = {
        ...(latestProgress.current?.run ?? initial),
        status: abort.signal.aborted ? 'cancelled' : 'failed',
        stopReasons: [abort.signal.aborted ? 'cancelled' : 'failure'],
      };
      setLiveRun(failed);
      retainResult({ run: failed, evidence: latestProgress.current?.evidence ?? {} });
      if (!abort.signal.aborted)
        setError('Scan could not finish. Retry when evidence is available.');
    } finally {
      if (mounted.current && controller.current === abort) {
        controller.current = undefined;
        setBusy(false);
      }
    }
  }

  const results = run?.results.filter((item) => !item.dismissed) ?? [];
  const status = run ? scanStatus(run, busy) : undefined;
  const shownResults = results.filter((item) => filter === 'all' || item.kind === filter);
  return (
    <div className="connection-scan" hidden={!active}>
      <section className="panel-section">
        <div className="connection-scan-source">
          <span className="muted">Selected node</span>
          <strong title={source}>
            {source && eligible(source)
              ? nameFor(workspace, source)
              : 'Select a transaction or output'}
          </strong>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void start(source);
          }}
        >
          <fieldset disabled={busy} className="connection-scan-fields">
            <label>
              Direction
              <select
                value={settings.direction}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    direction: event.target.value as ScanSettings['direction'],
                  })
                }
              >
                <option value="downstream">Downstream</option>
                <option value="upstream">Upstream</option>
                <option value="both">Both</option>
              </select>
            </label>
            <label>
              Targets
              <select
                value={settings.targetScope}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    targetScope: event.target.value as ScanSettings['targetScope'],
                  })
                }
              >
                <option value="visible">Visible graph</option>
                <option value="added">All added nodes</option>
              </select>
            </label>
            <label>
              Max transaction hops
              <input
                type="number"
                min={1}
                max={SCAN_LIMITS.maxHops}
                required
                value={settings.maxHops}
                onChange={(event) =>
                  setSettings({ ...settings, maxHops: event.target.valueAsNumber })
                }
              />
            </label>
            <details className="connection-scan-advanced">
              <summary>Advanced limits</summary>
              <label>
                Transactions examined
                <input
                  type="number"
                  min={1}
                  max={SCAN_LIMITS.maxTransactions}
                  required
                  value={settings.maxTransactions}
                  onChange={(event) =>
                    setSettings({ ...settings, maxTransactions: event.target.valueAsNumber })
                  }
                />
              </label>
              <label>
                Time limit (seconds)
                <input
                  type="number"
                  min={1}
                  max={SCAN_LIMITS.maxMilliseconds / 1000}
                  required
                  value={settings.maxMilliseconds / 1000}
                  onChange={(event) =>
                    setSettings({ ...settings, maxMilliseconds: event.target.valueAsNumber * 1000 })
                  }
                />
              </label>
              <label>
                Stop at branch size
                <input
                  type="number"
                  min={1}
                  max={SCAN_LIMITS.fanOut}
                  required
                  value={settings.fanOut}
                  onChange={(event) =>
                    setSettings({ ...settings, fanOut: event.target.valueAsNumber })
                  }
                />
              </label>
            </details>
          </fieldset>
          <div className="connection-scan-actions">
            {busy ? (
              <button type="button" onClick={() => controller.current?.abort()}>
                <Square size={13} />
                Cancel
              </button>
            ) : (
              <button className="primary" disabled={!eligible(source)} type="submit">
                <ScanLine size={15} />
                Scan selection
              </button>
            )}
          </div>
        </form>
        {!canQuery && <p className="small muted">Offline: loaded evidence only.</p>}
        {error && (
          <p className="connection-scan-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {run && status && (
        <section className="panel-section connection-scan-results" aria-label="Scan results">
          <div className="connection-scan-results-source">
            <span className="muted">Results from</span>
            <button
              type="button"
              className="text-button"
              disabled={!traceSourceExists(workspace, run.source)}
              title={run.source}
              aria-label={`Select scan source: ${nameFor(workspace, run.source)}`}
              onClick={() => onSelect(run.source)}
            >
              <Crosshair size={14} />
              <span>{nameFor(workspace, run.source)}</span>
            </button>
          </div>
          <div
            className={`connection-scan-status is-${status.tone}`}
            role="status"
            aria-live="polite"
          >
            {status.tone === 'running' ? (
              <LoaderCircle size={15} />
            ) : status.tone === 'complete' ? (
              <Check size={15} />
            ) : (
              <TriangleAlert size={15} />
            )}
            <strong>{status.label}</strong>
          </div>
          <details className="connection-scan-run-details">
            <summary
              title="Scan details"
              aria-label={`Scan details: ${run.examined} of ${run.settings.maxTransactions} transactions checked`}
            >
              <Info size={13} /> {run.examined} / {run.settings.maxTransactions} checked
            </summary>
            <dl>
              <dt>Targets</dt>
              <dd>
                {run.targetIds.length}{' '}
                {run.settings.targetScope === 'visible' ? 'visible' : 'added'} graph nodes
              </dd>
              <dt>Direction</dt>
              <dd>
                {run.settings.direction === 'both'
                  ? 'Upstream and downstream'
                  : run.settings.direction === 'upstream'
                    ? 'Upstream'
                    : 'Downstream'}
              </dd>
              <dt>Max hops</dt>
              <dd>{run.settings.maxHops}</dd>
              <dt>Time limit</dt>
              <dd>{run.settings.maxMilliseconds / 1000} seconds</dd>
              <dt>Stop at</dt>
              <dd>{run.settings.fanOut} branches</dd>
            </dl>
          </details>
          {!busy && !run.results.some((item) => item.kind === 'connection') && (
            <p className="small muted">No connection found within these limits.</p>
          )}
          <div className="connection-scan-results-toolbar">
            <label className="connection-scan-result-filter">
              Results
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as typeof filter)}
              >
                <option value="all">All ({results.length})</option>
                <option value="connection">
                  Connections ({results.filter((item) => item.kind === 'connection').length})
                </option>
                <option value="boundary">
                  Stopping points ({results.filter((item) => item.kind === 'boundary').length})
                </option>
              </select>
            </label>
            <button
              type="button"
              className="text-button connection-scan-clear"
              onClick={clearResults}
              aria-label="Clear all results"
              title="Clear all results"
            >
              <Trash2 size={14} /> Clear
            </button>
          </div>
          {shownResults.map((result) => (
            <ScanResultRow
              key={`${run.id}:${result.id}`}
              workspace={
                transientEvidence
                  ? {
                      ...workspace,
                      connectionScans: {
                        runs,
                        evidence: {
                          ...workspace.connectionScans?.evidence,
                          ...transientEvidence,
                        },
                      },
                    }
                  : workspace
              }
              result={result}
              fanOut={run.settings.fanOut}
              visibleNodeIds={props.visibleNodeIds}
              onSelect={onSelect}
              onAdd={(row, length) => props.onAdd(row, length, transientEvidence)}
              onDismiss={() => {
                dismissed.current.add(result.id);
                retainResult({
                  run: latestProgress.current?.run ?? run,
                  evidence:
                    latestProgress.current?.evidence ??
                    transientEvidence ??
                    workspace.connectionScans?.evidence ??
                    {},
                });
              }}
            />
          ))}
          {!shownResults.length && results.length > 0 && (
            <p className="small muted">No results match this filter.</p>
          )}
        </section>
      )}
    </div>
  );
}

function ScanResultRow({
  workspace,
  result,
  fanOut,
  visibleNodeIds,
  onSelect,
  onAdd,
  onDismiss,
}: {
  workspace: Workspace;
  result: ScanResult;
  fanOut: number;
  visibleNodeIds: string[];
  onSelect: (id: string) => void;
  onAdd: (result: ScanResult, prefixLength: number) => void;
  onDismiss: () => void;
}) {
  const [prefixLength, setPrefixLength] = useState(result.path.length);
  const [error, setError] = useState('');
  const fullPlan = useMemo(
    () => prepareScanPath(workspace, result),
    [
      workspace.transactions,
      workspace.connectionScans?.evidence,
      workspace.view.graphNodeIds,
      result,
    ],
  );
  const plan =
    prefixLength === result.path.length
      ? fullPlan
      : prepareScanPath(workspace, result, prefixLength);
  const connection = result.kind === 'connection';
  const relation =
    result.relationship === 'shared-ancestor'
      ? 'Shared ancestor'
      : result.relationship === 'shared-descendant'
        ? 'Shared descendant'
        : 'Connection';
  const title = connection ? relation : reasons[result.reason ?? 'unknown'];
  const visible = new Set(visibleNodeIds);
  const obscured = plan.nodeIds.some((id) => !visible.has(id) && !plan.newNodeIds.includes(id));
  const description = connection
    ? undefined
    : result.reason === 'fan-out'
      ? `Stopped at ${fanOut}+ ${result.endpoint.startsWith('tx:') ? 'inputs or outputs' : 'connected transactions'}.`
      : result.reason === 'unknown'
        ? 'Further chain data is unavailable.'
        : result.reason === 'failure'
          ? 'Could not load the next step.'
          : result.reason === 'transactions'
            ? 'Transaction budget reached at this step.'
            : result.reason === 'cancelled'
              ? 'Scan cancelled at this step.'
              : 'Scan stopped at this step.';
  return (
    <article
      className={`connection-scan-result ${connection ? 'is-connection' : result.reason === 'failure' ? 'is-failure' : 'is-boundary'}`}
      aria-label={`${title}: ${nameFor(workspace, result.endpoint)}`}
    >
      <div className="connection-scan-result-heading">
        {connection ? <Check size={15} /> : <TriangleAlert size={15} />}
        <strong>{title}</strong>
        <button
          type="button"
          className="text-button connection-scan-dismiss"
          onClick={onDismiss}
          title="Dismiss result"
          aria-label={`Dismiss ${nameFor(workspace, result.endpoint)}`}
        >
          <X size={15} />
        </button>
      </div>
      <div className="connection-scan-result-endpoint">
        <span title={result.endpoint}>{nameFor(workspace, result.endpoint)}</span>
        <small>
          {result.hops} {result.hops === 1 ? 'hop' : 'hops'}
        </small>
      </div>
      <div className="connection-scan-result-body">
        {description && <p className="connection-scan-result-description">{description}</p>}
        {connection && fullPlan.newNodeIds.includes(result.endpoint) && (
          <p className="small muted">Endpoint removed from graph. Add restores it.</p>
        )}

        {plan.missingTxids.length > 0 && (
          <p className="small connection-scan-error">
            Path evidence must be reloaded before adding.
          </p>
        )}
        {obscured && (
          <p className="small muted">Adding reveals hidden nodes and resets graph filters.</p>
        )}
        {error && (
          <p className="connection-scan-error" role="alert">
            {error}
          </p>
        )}
        <details className="connection-scan-path-section">
          <summary>
            Path{' '}
            <span>
              {prefixLength} {prefixLength === 1 ? 'node' : 'nodes'}
            </span>
          </summary>
          {(result.path.length > 5 || fullPlan.missingTxids.length > 0) &&
            result.path.length > 1 && (
              <label>
                Path length
                <select
                  value={prefixLength}
                  onChange={(event) => setPrefixLength(Number(event.target.value))}
                >
                  {result.path.map((id, index) => (
                    <option key={`${id}:${index}`} value={index + 1}>
                      {index + 1} / {result.path.length}: {short(id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          <ol className="connection-scan-path">
            {result.path.slice(0, prefixLength).map((id, index) => (
              <li key={`${id}:${index}`} title={id}>
                <span aria-label={index ? result.directions[index - 1] : 'Source'}>
                  {index ? (result.directions[index - 1] === 'upstream' ? '↑' : '↓') : '●'}
                </span>
                <span>{nameFor(workspace, id)}</span>
                {plan.newNodeIds.includes(id) && <small>New</small>}
              </li>
            ))}
          </ol>
        </details>
      </div>
      <footer className="connection-scan-result-actions">
        <button
          type="button"
          disabled={!traceSourceExists(workspace, result.endpoint)}
          aria-label="Select endpoint"
          title="Select endpoint"
          onClick={() => onSelect(result.endpoint)}
        >
          <Crosshair size={14} /> Select
        </button>
        <button
          type="button"
          disabled={plan.missingTxids.length > 0}
          title={`Add path: ${plan.newNodeIds.length} new nodes`}
          aria-label={`Add path: ${plan.newNodeIds.length} new nodes`}
          onClick={() => {
            try {
              onAdd(result, prefixLength);
              setError('');
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Path could not be added.');
            }
          }}
        >
          <Plus size={15} /> Add (+{plan.newNodeIds.length})
        </button>
      </footer>
    </article>
  );
}
