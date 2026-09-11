import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftFromLine,
  Check,
  CircleDot,
  Crosshair,
  Info,
  LoaderCircle,
  Plus,
  RotateCw,
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
} from '../domain/connectionScan';
import { replaceScanRun, clearScanRuns } from '../domain/connectionScanRecords';
import { prepareScanPathAddition, prepareScanNodeAddition } from '../domain/connectionScanAddition';
import { loadScanActionEvidence } from '../lib/connectionScanActionEvidence';
import { runConnectionScanInWorker } from '../lib/connectionScanRunner';
import type { TransactionFetchScope } from '../lib/transactionScheduler';
import { traceSourceExists } from '../lib/tracing';
import { indexLoadedSpends } from '../domain/transactionFlow';
import {
  presentScanRun,
  scanStatus,
  resultFinding,
  resultCategory,
  scanRelationPresentation,
  scanResultTooltip,
  type ScanResultFinding,
} from '../domain/connectionScanPresentation';
import {
  groupScanResults,
  groupScanRuns,
  mergeScanRunSnapshots,
  scanResultGroupKey,
  scanMeetingNode,
} from '../domain/connectionScanGroups';
import { retryConnectionScanResult, applyScanRecheck } from '../lib/connectionScanRetry';
import { transactionStatus } from '../domain/transactionStatus';
import { prepareCustomScanTargets } from '../domain/connectionScanTargets';
import { prepareNeighbourScanTargets } from '../domain/connectionScanNeighbours';
import { WalletHelp } from './WalletHelp';
import './connection-scan.css';

const titles: Record<ScanResultFinding, string> = {
  'upstream-connection': 'Funding path',
  'downstream-connection': 'Spending path',
  'shared-ancestor': 'Shared ancestor',
  'shared-descendant': 'Shared descendant',
  'many-inputs': 'Many inputs',
  'many-outputs': 'Many outputs',
  unspent: 'Unspent output',
  coinbase: 'Coinbase origin',
  unspendable: 'Unspendable output',
  'transaction-unavailable': 'Transaction unavailable',
  'spend-unknown': 'Spend status unknown',
  'lookup-failed': 'Lookup failed',
  'conflicting-evidence': 'Conflicting evidence',
};
const eligible = (id?: string): id is string => !!id && /^(tx|out):/.test(id);
const nameFor = (workspace: Workspace, id: string) => workspace.annotations[id]?.label || short(id);

type Props = {
  workspace: Workspace;
  selectionId?: string;
  customTargetIds: readonly string[];
  pickingTargets: boolean;
  onPickTargets: (invoker: HTMLButtonElement) => void;
  onCancelPicking: () => void;
  onRemoveTarget: (id: string) => void;
  visibleNodeIds: string[];
  addedNodeIds: string[];
  loadedSpenders: ReadonlyMap<string, readonly string[]>;
  neighbours: ReadonlyMap<string, readonly string[]>;
  active: boolean;
  canQuery: boolean;
  scope: TransactionFetchScope;
  isCurrent: () => boolean;
  onChange: (update: (workspace: Workspace) => Workspace, undo?: boolean) => void;
  onSelect: (id: string, evidence?: Record<string, Transaction>) => void;
  onAdd: (result: ScanResult, prefixLength: number, evidence?: Record<string, Transaction>) => void;
};

/** A run owns its source and targets. Selection only supplies an explicit new run. */
export function ConnectionScanPanel(props: Props) {
  const { workspace, selectionId, active, scope, canQuery, onChange } = props;
  const [settings, setSettings] = useState<ScanSettings>(() => ({
    ...(workspace.connectionScans?.runs.at(-1)?.settings ?? DEFAULT_SCAN_SETTINGS),
  }));
  const [liveRuns, setLiveRuns] = useState<ScanRun[]>([]);
  const [transientEvidence, setTransientEvidence] = useState<Record<string, Transaction>>();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string>();
  const actionController = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'findings' | 'connection' | 'branch' | 'issue' | 'endpoint'>(
    'findings',
  );
  const [retrying, setRetrying] = useState<{ runId: string; resultId: string }>();
  const [retryNotice, setRetryNotice] = useState('');
  const retryController = useRef<AbortController | undefined>(undefined);
  const dismissedGroups = useRef(new Set<string>());
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const dismissed = useRef(new Map<string, Set<string>>());
  const latestProgress = useRef<
    { run: ScanRun; evidence: Record<string, Transaction> } | undefined
  >(undefined);
  const current = useRef(props);
  current.current = props;
  const runs = workspace.connectionScans?.runs ?? [];
  const scanRuns = mergeScanRunSnapshots(runs, liveRuns).map((item) =>
    presentScanRun(item, dismissed.current.get(item.id) ?? new Set()),
  );
  const run = scanRuns.at(-1);
  const source = selectionId;
  const customTargetPlan = useMemo(() => {
    if (settings.targetScope !== 'custom' || !eligible(source)) return { ids: [], error: '' };
    try {
      return {
        ids: prepareCustomScanTargets({
          pickedNodeIds: props.customTargetIds,
          source,
        }),
        error: '',
      };
    } catch (cause) {
      return {
        ids: [],
        error: cause instanceof Error ? cause.message : 'Targets could not be prepared.',
      };
    }
  }, [props.customTargetIds, source, settings.targetScope]);
  const neighbourTargetPlan = useMemo(() => {
    if (!active || settings.targetScope !== 'neighbours' || !eligible(source))
      return { ids: [], capped: false, error: '' };
    try {
      return {
        ...prepareNeighbourScanTargets({ source, neighbours: props.neighbours }),
        error: '',
      };
    } catch (cause) {
      return {
        ids: [],
        capped: false,
        error: cause instanceof Error ? cause.message : 'Neighbours could not be prepared.',
      };
    }
  }, [active, source, settings.targetScope, props.neighbours]);
  const savedSpenders = useMemo(
    () => indexLoadedSpends(workspace.connectionScans?.evidence ?? {}),
    [workspace.connectionScans?.evidence],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      retryController.current?.abort();
      actionController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) {
      controller.current?.abort();
      retryController.current?.abort();
      actionController.current?.abort();
    }
  }, [active]);

  useEffect(() => {
    actionController.current?.abort();
  }, [selectionId]);

  function clearResults() {
    actionController.current?.abort();
    controller.current?.abort();
    controller.current = undefined;
    retryController.current?.abort();
    retryController.current = undefined;
    setRetrying(undefined);
    setRetryNotice('');
    dismissedGroups.current.clear();
    setBusy(false);
    setLiveRuns([]);
    setTransientEvidence(undefined);
    setError('');
    setFilter('findings');
    dismissed.current.clear();
    latestProgress.current = undefined;
    onChange(clearScanRuns, false);
  }

  function presentIncoming(incoming: ScanRun) {
    return presentScanRun(
      {
        ...incoming,
        results: incoming.results.map((result) =>
          dismissedGroups.current.has(`${incoming.id}:${scanResultGroupKey(result)}`)
            ? { ...result, dismissed: true }
            : result,
        ),
      },
      dismissed.current.get(incoming.id) ?? new Set(),
    );
  }

  function showRun(incoming: ScanRun) {
    setLiveRuns((previous) => mergeScanRunSnapshots(previous, [incoming]));
  }

  function retainResult(incoming: { run: ScanRun; evidence: Record<string, Transaction> }) {
    const result = { ...incoming, run: presentIncoming(incoming.run) };
    if (latestProgress.current?.run.id === result.run.id) latestProgress.current = result;
    showRun(result.run);
    try {
      onChange((w) => replaceScanRun(w, result.run, result.evidence), false);
      setError('');
    } catch {
      // Results remain usable in this session even if their evidence exceeds storage bounds.
      setTransientEvidence((previous) => ({ ...previous, ...result.evidence }));
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

  async function addOrSelect(result: ScanResult, prefixLength: number, nodeId?: string) {
    if (actionController.current) return;
    const owner = current.current;
    if (nodeId && traceSourceExists(owner.workspace, nodeId)) {
      owner.onSelect(nodeId);
      return;
    }
    const snapshot = {
      ...owner.workspace,
      connectionScans: {
        runs: owner.workspace.connectionScans?.runs ?? [],
        evidence: { ...owner.workspace.connectionScans?.evidence, ...transientEvidence },
      },
    };
    const plan = nodeId
      ? prepareScanNodeAddition(snapshot, nodeId)
      : prepareScanPathAddition(snapshot, result, prefixLength);
    if (plan.blockedByConflict) throw new Error('Path evidence conflicts. Choose an earlier step.');
    const abort = new AbortController();
    actionController.current = abort;
    setAdding(nodeId ? `node:${nodeId}` : `path:${result.id}`);
    try {
      const evidence = await loadScanActionEvidence({
        workspace: snapshot,
        missingTxids: plan.missingTxids,
        scope: owner.scope,
        canQuery: owner.canQuery,
        signal: abort.signal,
        isCurrent: () => mounted.current && current.current.active && owner.isCurrent(),
      });
      abort.signal.throwIfAborted();
      if (!mounted.current || !current.current.active || !owner.isCurrent())
        throw new DOMException('Path action cancelled.', 'AbortError');
      const proof = { ...plan.transactions, ...evidence };
      if (nodeId) owner.onSelect(nodeId, proof);
      else owner.onAdd(result, prefixLength, proof);
    } finally {
      if (actionController.current === abort) actionController.current = undefined;
      if (mounted.current) setAdding(undefined);
    }
  }

  async function start(startSource: string | undefined) {
    if (
      !eligible(startSource) ||
      busy ||
      props.pickingTargets ||
      controller.current ||
      retryController.current ||
      actionController.current
    )
      return;
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
    let targetIds: string[];
    try {
      targetIds =
        frozenSettings.targetScope === 'neighbours'
          ? prepareNeighbourScanTargets({ source: startSource, neighbours: props.neighbours }).ids
          : frozenSettings.targetScope === 'custom'
            ? prepareCustomScanTargets({
                pickedNodeIds: props.customTargetIds,
                source: startSource,
              })
            : [
                ...new Set(
                  (frozenSettings.targetScope === 'visible'
                    ? props.visibleNodeIds
                    : props.addedNodeIds
                  ).filter((id) => eligible(id) && id !== startSource),
                ),
              ];
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Targets could not be prepared.');
      return;
    }
    if (targetIds.length > SCAN_LIMITS.maxTargets) {
      setError(
        `Choose Neighbours, pick custom targets or choose a smaller graph scope: at most ${SCAN_LIMITS.maxTargets} targets per scan.`,
      );
      return;
    }
    if (!targetIds.length) {
      setError(
        frozenSettings.targetScope === 'custom'
          ? 'Pick another transaction or output as a target.'
          : frozenSettings.targetScope === 'neighbours'
            ? 'No loaded neighbours. Load a connected transaction or pick custom targets.'
            : 'Add another transaction or output to the target scope first.',
      );
      return;
    }
    if (!traceSourceExists(workspace, startSource)) {
      setError('Source evidence is no longer loaded. Add its saved path or load the source first.');
      return;
    }
    if (scanRuns.filter((item) => item.results.length > 0).length >= SCAN_LIMITS.maxRuns) {
      setError('Scan results span 20 scans. Clear results before starting another scan.');
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
    setRetryNotice('');
    latestProgress.current = { run: initial, evidence: {} };
    setSettings(frozenSettings);
    showRun(initial);
    setFilter('findings');
    try {
      const result = await runConnectionScanInWorker({
        request: {
          id: initial.id,
          source: startSource,
          targetIds,
          displayedNodeIds: [...props.visibleNodeIds],
          // Automatic targets already belong to loaded evidence, even when their
          // nodes are not on the canvas. This also applies to fixed custom picks.
          knownNodeIds: [...props.neighbours.keys()],
          knownLinks:
            frozenSettings.targetScope === 'custom'
              ? undefined
              : [...props.neighbours].flatMap(([node, adjacent]) =>
                  adjacent.filter((next) => node < next).map((next) => [node, next] as const),
                ),
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
          const next = presentIncoming(progress);
          if (next.results.length !== latestProgress.current?.run.results.length) {
            retainResult({ run: next, evidence });
          } else {
            latestProgress.current = { run: next, evidence };
            showRun(next);
          }
        },
      });
      if (!mounted.current || controller.current !== abort || !current.current.isCurrent()) return;
      showRun(result.run);
      retainResult(result);
    } catch {
      if (!mounted.current || controller.current !== abort || !current.current.isCurrent()) return;
      const failed: ScanRun = {
        ...(latestProgress.current?.run ?? initial),
        status: abort.signal.aborted ? 'cancelled' : 'failed',
        stopReasons: [abort.signal.aborted ? 'cancelled' : 'failure'],
      };
      showRun(failed);
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

  async function retry(owner: ScanRun, result: ScanResult) {
    if (busy || retryController.current) return;
    const abort = new AbortController();
    retryController.current = abort;
    setRetrying({ runId: owner.id, resultId: result.id });
    setRetryNotice('');
    const runId = owner.id;
    try {
      const currentEvidence = {
        ...workspace.connectionScans?.evidence,
        ...transientEvidence,
        ...latestProgress.current?.evidence,
      };
      const checked = await retryConnectionScanResult({
        run: owner,
        result,
        network: workspace.network,
        transactions: { ...currentEvidence, ...workspace.transactions },
        scope,
        signal: abort.signal,
        allowNetwork: canQuery,
        loadedSpenders: (id) => [
          ...new Set([
            ...(props.loadedSpenders.get(id) ?? []),
            ...(savedSpenders.get(id)?.map((tx) => tx.txid) ?? []),
          ]),
        ],
        isCurrent: () =>
          mounted.current && retryController.current === abort && current.current.isCurrent(),
      });
      if (
        abort.signal.aborted ||
        retryController.current !== abort ||
        !mounted.current ||
        !current.current.isCurrent()
      )
        return;
      if (checked.globalReason) {
        setRetryNotice(
          checked.globalReason === 'rate-limited'
            ? 'Backend rate limit reached. Retry later.'
            : checked.globalReason === 'offline'
              ? 'Connect the backend to retry this lookup.'
              : 'Lookup could not finish. Retry when the backend is available.',
        );
        return;
      }
      const latest =
        latestProgress.current?.run.id === runId
          ? latestProgress.current.run
          : (current.current.workspace.connectionScans?.runs.find((item) => item.id === runId) ??
            owner);
      retainResult({
        run: applyScanRecheck(latest, result, checked.observation),
        evidence: { ...currentEvidence, ...checked.evidence },
      });
      setRetryNotice(
        checked.observation ? '' : `Lookup resolved for ${nameFor(workspace, result.endpoint)}.`,
      );
    } catch {
      if (
        !abort.signal.aborted &&
        retryController.current === abort &&
        mounted.current &&
        current.current.isCurrent()
      )
        setRetryNotice('Lookup could not finish. Retry with the backend connected.');
    } finally {
      if (retryController.current === abort) {
        retryController.current = undefined;
        if (mounted.current) setRetrying(undefined);
      }
    }
  }

  const groups = groupScanRuns(scanRuns);
  const status = run ? scanStatus(run, busy) : undefined;
  const shownGroups = groups.filter((group) =>
    filter === 'findings' ? group.category !== 'endpoint' : group.category === filter,
  );
  return (
    <div className="connection-scan" hidden={!active}>
      <section className="panel-section">
        <div className="connection-scan-source">
          <span className="muted">
            {source?.startsWith('tx:')
              ? 'TRANSACTION'
              : source?.startsWith('out:')
                ? 'TRANSACTION OUTPUT'
                : 'SELECTION'}
          </span>
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
          <fieldset disabled={busy || !!retrying} className="connection-scan-fields">
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
                <option value="both">Both</option>
                <option value="upstream">Sources</option>
                <option value="downstream">Destinations</option>
              </select>
            </label>
            <label>
              Targets
              <select
                value={settings.targetScope}
                onChange={(event) => {
                  props.onCancelPicking();
                  setError('');
                  setSettings({
                    ...settings,
                    targetScope: event.target.value as ScanSettings['targetScope'],
                  });
                }}
              >
                <option value="neighbours">Neighbours</option>
                <option value="visible">Visible graph</option>
                <option value="added">All added nodes</option>
                <option value="custom">Custom targets</option>
              </select>
            </label>
            {settings.targetScope === 'neighbours' &&
              eligible(source) &&
              (neighbourTargetPlan.error ? (
                <p className="connection-scan-error" role="alert">
                  {neighbourTargetPlan.error}
                </p>
              ) : (
                <span
                  className="small muted"
                  title="Nearest nodes connected by loaded transaction links, including hidden and filtered nodes."
                >
                  {neighbourTargetPlan.capped
                    ? `Nearest ${neighbourTargetPlan.ids.length.toLocaleString()} loaded nodes`
                    : neighbourTargetPlan.ids.length
                      ? `${neighbourTargetPlan.ids.length.toLocaleString()} nearby loaded nodes`
                      : 'No loaded neighbours'}
                </span>
              ))}
            {settings.targetScope === 'custom' && (
              <div className="connection-scan-custom-targets">
                <button
                  type="button"
                  disabled={!eligible(source) || props.pickingTargets}
                  onClick={(event) => props.onPickTargets(event.currentTarget)}
                >
                  <Crosshair size={14} /> Pick target(s)
                </button>
                {props.customTargetIds.length > 0 && (
                  <>
                    <span className="small muted">
                      {props.customTargetIds.length} picked
                      {!customTargetPlan.error && ` · ${customTargetPlan.ids.length} targets`}
                    </span>
                    <div className="connection-scan-picked-list" aria-label="Custom scan targets">
                      {props.customTargetIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          className="text-button"
                          disabled={props.pickingTargets}
                          title={`Remove ${id}`}
                          aria-label={`Remove target ${id}`}
                          onClick={() => props.onRemoveTarget(id)}
                        >
                          {short(id)} <X size={12} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {customTargetPlan.error && (
                  <p className="connection-scan-error" role="alert">
                    {customTargetPlan.error}
                  </p>
                )}
              </div>
            )}
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
            {busy || retrying || adding ? (
              <button
                type="button"
                onClick={() => {
                  controller.current?.abort();
                  retryController.current?.abort();
                  actionController.current?.abort();
                }}
              >
                <Square size={13} />
                Cancel
              </button>
            ) : (
              <button
                className="primary"
                disabled={
                  !eligible(source) ||
                  props.pickingTargets ||
                  (settings.targetScope === 'neighbours' && !neighbourTargetPlan.ids.length) ||
                  (settings.targetScope === 'custom' &&
                    (!customTargetPlan.ids.length || !!customTargetPlan.error))
                }
                type="submit"
              >
                <ScanLine size={15} />
                Scan selection
              </button>
            )}
          </div>
        </form>
        {run && status && (
          <>
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
                  {run.settings.targetScope === 'custom'
                    ? 'custom targets'
                    : run.settings.targetScope === 'neighbours'
                      ? 'nearby loaded nodes'
                      : `${run.settings.targetScope === 'visible' ? 'visible' : 'added'} graph nodes`}
                </dd>
                <dt>Direction</dt>
                <dd>
                  {run.settings.direction === 'both'
                    ? 'Sources and destinations'
                    : run.settings.direction === 'upstream'
                      ? 'Sources'
                      : 'Destinations'}
                </dd>
                <dt>Max hops</dt>
                <dd>{run.settings.maxHops}</dd>
                <dt>Time limit</dt>
                <dd>{run.settings.maxMilliseconds / 1000} seconds</dd>
                <dt>Stop at</dt>
                <dd>{run.settings.fanOut} branches</dd>
                {!!run.omittedResults?.endpoints && (
                  <>
                    <dt>Other endpoints</dt>
                    <dd>{run.omittedResults.endpoints} omitted</dd>
                  </>
                )}
                {!!run.omittedResults?.issues && (
                  <>
                    <dt>Other issues</dt>
                    <dd>{run.omittedResults.issues} omitted</dd>
                  </>
                )}
              </dl>
            </details>
          </>
        )}
        {!canQuery && <p className="small muted">Offline: loaded evidence only.</p>}
        {error && (
          <p className="connection-scan-error" role="alert">
            {error}
          </p>
        )}
      </section>
      {run && status && (
        <section className="panel-section connection-scan-results" aria-label="Scan results">
          {retryNotice && (
            <p className="small muted" role="status">
              {retryNotice}
            </p>
          )}
          {!busy && !run.results.some((item) => item.kind === 'connection') && (
            <p className="small muted">Latest scan found no connection within its limits.</p>
          )}
          <div className="connection-scan-results-toolbar">
            <label className="connection-scan-result-filter">
              Results
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as typeof filter)}
              >
                <option value="findings">
                  Findings ({groups.filter((g) => g.category !== 'endpoint').length})
                </option>
                <option value="connection">
                  Connections ({groups.filter((g) => g.category === 'connection').length})
                </option>
                <option value="branch">
                  Branch choices ({groups.filter((g) => g.category === 'branch').length})
                </option>
                <option value="issue">
                  Evidence problems ({groups.filter((g) => g.category === 'issue').length})
                </option>
                <option value="endpoint">
                  Endpoints ({groups.filter((g) => g.category === 'endpoint').length})
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
          {shownGroups.map((group) => (
            <ScanResultGroup
              key={group.id}
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
              group={group}
              active={active}
              retrying={retrying?.runId === group.run.id ? retrying.resultId : undefined}
              retryDisabled={busy || !!adding || !!retrying}
              actionBusy={!!adding}
              activeAction={adding}
              onRetry={(row) => retry(group.run, row)}
              visibleNodeIds={props.visibleNodeIds}
              onSelect={(id) => addOrSelect(group.results[0], group.results[0].path.length, id)}
              onAdd={(row, length) => addOrSelect(row, length)}
              onDismiss={() => {
                actionController.current?.abort();
                dismissedGroups.current.add(group.id);
                const ids = dismissed.current.get(group.run.id) ?? new Set<string>();
                for (const result of group.results) ids.add(result.id);
                dismissed.current.set(group.run.id, ids);
                retainResult({
                  run:
                    latestProgress.current?.run.id === group.run.id
                      ? latestProgress.current.run
                      : group.run,
                  evidence: {
                    ...workspace.connectionScans?.evidence,
                    ...transientEvidence,
                    ...latestProgress.current?.evidence,
                  },
                });
              }}
            />
          ))}
          {!shownGroups.length && groups.length > 0 && (
            <p className="small muted">No results match this filter.</p>
          )}
        </section>
      )}
    </div>
  );
}

type ResultRowProps = {
  active: boolean;
  workspace: Workspace;
  result: ScanResult;
  alternatives: ScanResult[];
  onPathChange: (id: string) => void;
  visibleNodeIds: string[];
  onSelect: (id: string) => Promise<void>;
  onAdd: (result: ScanResult, prefixLength: number) => Promise<void>;
  actionBusy: boolean;
  activeAction?: string;
  onDismiss: () => void;
  onRetry: (result: ScanResult) => void;
  retrying?: string;
  retryDisabled: boolean;
};

function ScanResultGroup({
  group,
  ...props
}: Omit<ResultRowProps, 'result' | 'alternatives' | 'onPathChange'> & {
  group: ReturnType<typeof groupScanResults>[number];
}) {
  const [selected, setSelected] = useState(group.results[0].id);
  const result = group.results.find((item) => item.id === selected) ?? group.results[0];
  return (
    <ScanResultRow
      {...props}
      key={result.id}
      result={result}
      alternatives={group.results}
      onPathChange={setSelected}
    />
  );
}

function ScanPathNodeLabel({ workspace, id }: { workspace: Workspace; id: string }) {
  const transaction = id.startsWith('tx:')
    ? (workspace.transactions[id.slice(3)] ?? workspace.connectionScans?.evidence[id.slice(3)])
    : undefined;
  return (
    <>
      <span className="connection-scan-path-name">{nameFor(workspace, id)}</span>
      {id.startsWith('tx:') && (
        <span
          className="connection-scan-path-counts"
          title={
            transaction
              ? `${transaction.vin.length} inputs / ${transaction.vout.length} outputs`
              : 'Input/output counts unavailable'
          }
        >
          {' '}
          ({transaction?.vin.length ?? '?'}/{transaction?.vout.length ?? '?'})
        </span>
      )}
    </>
  );
}

function ScanResultRow({
  active,
  workspace,
  result,
  alternatives,
  onPathChange,
  visibleNodeIds,
  onSelect,
  onAdd,
  onDismiss,
  onRetry,
  retrying,
  retryDisabled,
  actionBusy,
  activeAction,
}: ResultRowProps) {
  const finding = resultFinding(result)!;
  const category = resultCategory(result);
  const hasDirection = !!(result.scanDirection ?? result.directions[0]);
  const conflict = finding === 'conflicting-evidence';
  const prefixLength = conflict ? Math.max(1, result.path.length - 1) : result.path.length;
  const [error, setError] = useState('');
  const plan = useMemo(
    () => prepareScanPathAddition(workspace, result, prefixLength),
    [
      workspace.transactions,
      workspace.connectionScans?.evidence,
      workspace.view.graphNodeIds,
      result,
      prefixLength,
    ],
  );
  const creatorId = plan.creatorId;
  const openNode = (id: string) => {
    setError('');
    void onSelect(id).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not open this node.');
    });
  };
  const connection = category === 'connection';
  const relation = scanRelationPresentation(result);
  const title = relation?.title ?? titles[finding];
  const isPrefix = prefixLength < result.path.length;
  const addLabel = isPrefix ? 'Add prefix' : result.context ? 'Add reconnection' : 'Add path';
  const visible = new Set(visibleNodeIds);
  const obscured = plan.nodeIds.some((id) => !visible.has(id) && !plan.newNodeIds.includes(id));
  const meeting = relation?.meeting ?? scanMeetingNode(result);
  const statuses = [...new Set([...result.path, ...(result.context?.path ?? [])])].map(
    (id) =>
      transactionStatus(
        workspace.transactions[id.split(':')[1]] ??
          workspace.connectionScans?.evidence[id.split(':')[1]],
      ).kind,
  );
  const outsideChain = statuses.includes('conflicted');
  const unconfirmed = statuses.includes('mempool');
  return (
    <article
      className={`connection-scan-result ${connection ? 'is-connection' : finding === 'lookup-failed' || conflict ? 'is-failure' : category === 'endpoint' ? 'is-endpoint' : 'is-boundary'}`}
      aria-label={`${title}: ${nameFor(workspace, result.endpoint)}`}
    >
      <div className="connection-scan-result-heading">
        <WalletHelp
          title={title}
          active={active}
          icon={
            connection ? (
              <Check size={15} aria-hidden="true" />
            ) : category === 'endpoint' ? (
              <Info size={15} aria-hidden="true" />
            ) : (
              <TriangleAlert size={15} aria-hidden="true" />
            )
          }
        >
          {scanResultTooltip(result)}
        </WalletHelp>
        <strong>{title}</strong>
        <button
          type="button"
          className="text-button connection-scan-dismiss"
          onClick={onDismiss}
          title="Dismiss finding and its paths"
          aria-label={`Dismiss ${nameFor(workspace, result.endpoint)}`}
        >
          <X size={15} />
        </button>
      </div>
      <div className="connection-scan-result-nodes">
        {[
          {
            id: relation?.branches?.[0] ?? result.path[0],
            label: relation?.branches ? `First ${relation.branchLabel}` : 'Source',
            Icon: CircleDot,
          },
          {
            id: relation?.branches?.[1] ?? result.endpoint,
            label: relation?.branches ? `Second ${relation.branchLabel}` : 'Target',
            Icon: Crosshair,
          },
        ].map(({ id, label, Icon }, index) => (
          <div className="connection-scan-result-node" key={label}>
            <button
              type="button"
              className="text-button"
              disabled={actionBusy}
              title={
                traceSourceExists(workspace, id)
                  ? `${label}: ${id}`
                  : `Add and select ${label}: ${id}`
              }
              aria-label={`Select scan ${label}: ${nameFor(workspace, id)}`}
              onClick={() => openNode(id)}
            >
              <Icon size={14} />
              <span>{short(id)}</span>
            </button>
            {index === 1 && (
              <small>
                {result.hops} {result.hops === 1 ? 'hop' : 'hops'}
              </small>
            )}
          </div>
        ))}
      </div>
      <div className="connection-scan-result-body">
        {workspace.annotations[result.endpoint]?.label && (
          <p className="small">{workspace.annotations[result.endpoint].label}</p>
        )}
        {category === 'issue' && !hasDirection && (
          <p className="small muted">Start a new scan to refresh this older result.</p>
        )}
        {meeting && (
          <div className="connection-scan-meeting">
            <span className="muted">Meeting point</span>
            <button
              type="button"
              className="text-button"
              disabled={actionBusy}
              title={meeting}
              aria-label={`Select meeting point: ${nameFor(workspace, meeting)}`}
              onClick={() => openNode(meeting)}
            >
              {nameFor(workspace, meeting)}
            </button>
          </div>
        )}
        {(outsideChain || unconfirmed) && (
          <p className="small connection-scan-evidence-status">
            {outsideChain
              ? 'Path includes an observation outside the active chain.'
              : 'Path includes an unconfirmed transaction.'}
          </p>
        )}
        {result.checkedAt && (
          <p
            className="small muted"
            title={result.bestBlock ? `Observed at block ${result.bestBlock}` : undefined}
          >
            Checked{' '}
            <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString()}</time>
          </p>
        )}
        {plan.missingTxids.length > 0 && (
          <p className="small connection-scan-error">Add loads the missing transaction evidence.</p>
        )}
        {plan.blockedByConflict && (
          <p className="small connection-scan-error">
            Refresh the conflicting evidence before adding.
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
        <section className="connection-scan-path-section" aria-label="Path">
          <div className="connection-scan-path-heading">
            <strong>Path</strong>{' '}
            <span>
              {prefixLength + (creatorId ? 1 : 0)}{' '}
              {prefixLength + (creatorId ? 1 : 0) === 1 ? 'node' : 'nodes'}
              {alternatives.length > 1 ? ` · ${alternatives.length} alternatives` : ''}
            </span>
          </div>
          {alternatives.length > 1 && (
            <label>
              Alternative path
              <select value={result.id} onChange={(event) => onPathChange(event.target.value)}>
                {alternatives.map((path, index) => (
                  <option key={path.id} value={path.id}>
                    Path {index + 1}: {path.hops} hops
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
                <button
                  type="button"
                  className="text-button"
                  disabled={actionBusy}
                  aria-label={`Select path node: ${nameFor(workspace, id)}`}
                  title={id}
                  onClick={() => openNode(id)}
                >
                  <ScanPathNodeLabel workspace={workspace} id={id} />
                </button>
                {plan.newNodeIds.includes(id) && <small>New</small>}
              </li>
            ))}
          </ol>
          {creatorId && (
            <div className="connection-scan-path-creator">
              <span
                className="muted"
                title="Creating transaction"
                aria-label="Creating transaction"
              >
                {activeAction === `node:${creatorId}` ? (
                  <LoaderCircle size={14} />
                ) : (
                  <ArrowLeftFromLine size={14} aria-hidden="true" />
                )}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={actionBusy}
                aria-label={`Select creating transaction: ${nameFor(workspace, creatorId)}`}
                title={creatorId}
                onClick={() => openNode(creatorId)}
              >
                <ScanPathNodeLabel workspace={workspace} id={creatorId} />
              </button>
              {plan.newNodeIds.includes(creatorId) && <small>New</small>}
            </div>
          )}
        </section>
      </div>
      <footer className="connection-scan-result-actions">
        {(category === 'issue' || finding === 'unspent') && (
          <button
            type="button"
            disabled={retryDisabled || !hasDirection}
            onClick={() => onRetry(result)}
            className="connection-scan-recheck"
            aria-label={retrying === result.id ? 'Rechecking endpoint' : 'Recheck endpoint'}
            title={
              hasDirection
                ? 'Recheck this endpoint without replacing other findings'
                : 'Start a new scan to recheck this older result'
            }
          >
            {retrying === result.id ? <LoaderCircle size={14} /> : <RotateCw size={14} />}
          </button>
        )}
        <button
          type="button"
          disabled={actionBusy || plan.blockedByConflict}
          title={`${addLabel}: ${plan.newNodeIds.length} new nodes`}
          aria-label={`${addLabel}: ${plan.newNodeIds.length} new nodes`}
          onClick={() => {
            setError('');
            void onAdd(result, prefixLength).catch((cause) => {
              if (cause instanceof DOMException && cause.name === 'AbortError') return;
              setError(cause instanceof Error ? cause.message : 'Path could not be added.');
            });
          }}
        >
          {activeAction === `path:${result.id}` ? <LoaderCircle size={13} /> : <Plus size={13} />}{' '}
          {isPrefix ? 'Add prefix' : 'Add'} (+
          {plan.newNodeIds.length})
        </button>
      </footer>
    </article>
  );
}
