import { TransactionBlockTime } from './TransactionBlockTime';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Focus,
  Network,
  X,
  ChevronsUp,
  ChevronUp,
  Minus,
  Lightbulb,
  TriangleAlert,
  Info,
} from 'lucide-react';
import { analysisTools } from '../domain/analysis';
import {
  analysisScopeChoice,
  mergeScanFindings,
  scanAnalysis,
  scanDefaults,
  type AnalysisScan,
} from '../domain/analysisScan';
import {
  short,
  addressNodeId,
  formatSats,
  sats,
  txNodeId,
  type AnalysisFinding,
  type GraphNode,
  type Wallet,
  type Workspace,
} from '../domain/types';
import { walletEvidenceChanged } from '../domain/walletActivity';
import { outputAddress } from '../domain/workspace';
import {
  indexPreviousOutputs,
  resolvePreviousOutput,
  type PreviousOutputIndex,
} from '../domain/prevouts';
import { WalletCategoryFilter } from './WalletCategoryFilter';
import { WalletHelp } from './WalletHelp';
import {
  findingReview,
  findingToolId,
  filterAnalysisFindings,
  reviewPriorities,
  type ReviewPriority,
} from '../domain/analysisReview';
import { analysisDataGaps, recoverAnalysisData, recoveryLimits } from '../domain/analysisRecovery';
import { fetchTransaction } from '../lib/api';
import './analysis-workbench.css';

const allTypes = () => analysisTools.map((tool) => tool.id);
const priorityIcons = { high: ChevronsUp, medium: ChevronUp, low: Minus };
function PriorityIcon({ priority }: { priority: ReviewPriority }) {
  const Icon = priorityIcons[priority];
  return (
    <Icon
      size={14}
      aria-label={`${priority} review priority`}
      className={`scan-priority-icon ${priority}`}
    />
  );
}

function FindingGuidance({ guidance }: { guidance: NonNullable<AnalysisFinding['guidance']> }) {
  const Icon =
    guidance.kind === 'tip' ? Lightbulb : guidance.kind === 'privacy' ? TriangleAlert : Info;
  const label =
    guidance.kind === 'tip' ? 'Tip' : guidance.kind === 'privacy' ? 'Privacy note' : 'Next step';
  return (
    <aside className={`scan-guidance ${guidance.kind}`} aria-label={label}>
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>{guidance.text}</p>
      </div>
    </aside>
  );
}

export interface AnalysisWorkbenchSession {
  scopeMode?: string;
  options: ReturnType<typeof scanDefaults>;
  scan?: AnalysisScan;
  selectedId?: string;
  kind: string;
  types?: string[];
  priorities?: ReviewPriority[];
  notice?: string;
  limit: number;
  autoLoad?: boolean;
}

export interface AnalysisWorkbenchProps {
  active: boolean;
  cache?: Map<string, AnalysisWorkbenchSession>;
  workspace: Workspace;
  selected?: GraphNode;
  wallet?: Wallet;
  onFindings: (findings: AnalysisFinding[]) => void;
  onRecovered: (before: Workspace, next: Workspace) => void;
  onGraph: (ids: string[], isolate?: boolean) => void;
}

function EvidenceReference({
  id,
  workspace,
  onGraph,
  prevouts,
}: {
  id: string;
  workspace: Workspace;
  onGraph: AnalysisWorkbenchProps['onGraph'];
  prevouts: PreviousOutputIndex;
}) {
  const [prefix, txid, index] = id.split(':');
  const kind = prefix === 'out' ? 'Output' : prefix === 'tx' ? 'Transaction' : 'Address';
  const reference = id.slice(id.indexOf(':') + 1);
  const resolution =
    prefix === 'out'
      ? resolvePreviousOutput(workspace, { txid, vout: Number(index) }, prevouts)
      : undefined;
  const output =
    resolution?.status === 'loaded' || resolution?.status === 'attached'
      ? resolution.output
      : undefined;
  const address = output && outputAddress(output);
  const label = workspace.annotations[id]?.label;
  return (
    <li>
      <div className="scan-evidence-reference">
        <button
          className="text-button"
          title={reference}
          aria-label={`Show ${kind.toLowerCase()} ${reference} on graph`}
          onClick={() => onGraph([id])}
        >
          <span>{kind}</span>
          <span className="mono">
            {prefix === 'out' ? `${short(txid)}:${index}` : short(reference)}
          </span>
        </button>
        {prefix === 'out' && (
          <span className="scan-evidence-value">
            {formatSats(output ? sats(output.value) : undefined)}
          </span>
        )}
      </div>
      {prefix === 'tx' && <TransactionBlockTime transaction={workspace.transactions[txid]} />}
      {label && <span className="scan-evidence-label">{label}</span>}
      {address && (
        <button
          className="text-button scan-evidence-address"
          title={address}
          aria-label={`Show address ${address} on graph`}
          onClick={() => onGraph([addressNodeId(address)])}
        >
          <span>Address</span>
          <span className="mono">{short(address)}</span>
        </button>
      )}
    </li>
  );
}

export function AnalysisWorkbench({
  workspace,
  selected,
  wallet,
  onFindings,
  onRecovered,
  onGraph,
  active,
  cache,
}: AnalysisWorkbenchProps) {
  const saved = cache?.get(workspace.id);
  const [scopeMode, setScopeMode] = useState(saved?.scopeMode);
  const [options, setOptions] = useState(saved?.options ?? scanDefaults);
  const [scan, setScan] = useState<AnalysisScan | undefined>(saved?.scan);
  const [selectedId, setSelectedId] = useState<string | undefined>(saved?.selectedId);
  const [kind, setKind] = useState(saved?.kind ?? 'all');
  const [types, setTypes] = useState(saved?.types ?? [...allTypes(), 'unregistered']);
  const [priorities, setPriorities] = useState<ReviewPriority[]>(
    saved?.priorities ?? [...reviewPriorities],
  );
  const [autoLoad, setAutoLoad] = useState(saved?.autoLoad ?? true);
  const [recovering, setRecovering] = useState(false);
  const [limit, setLimit] = useState(saved?.limit ?? 40);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(saved?.notice ?? '');
  const prevouts = useMemo(() => indexPreviousOutputs(workspace), [workspace.transactions]);
  const pending = useRef<AbortController | undefined>(undefined);
  const latest = useRef(workspace);
  latest.current = workspace;
  useEffect(
    () => () => {
      if (!pending.current) return;
      pending.current.abort();
      const previous = cache?.get(workspace.id);
      if (previous)
        cache?.set(workspace.id, {
          ...previous,
          notice: 'Operation cancelled. This attempt was not saved.',
        });
    },
    [cache, workspace.id],
  );
  const evidence = useRef(workspace);
  useEffect(() => {
    const dataChanged =
      evidence.current.id !== workspace.id ||
      evidence.current.network !== workspace.network ||
      evidence.current.transactions !== workspace.transactions ||
      walletEvidenceChanged(evidence.current.wallets, workspace.wallets);
    evidence.current = workspace;
    if (pending.current && (!active || dataChanged)) {
      pending.current.abort();
      pending.current = undefined;
      setBusy(false);
      setRecovering(false);
      setNotice('Operation cancelled. Existing findings are retained. Retry when ready.');
    }
  }, [active, workspace.id, workspace.network, workspace.transactions, workspace.wallets]);
  useEffect(() => {
    if (active)
      cache?.set(workspace.id, {
        scopeMode,
        autoLoad,
        options,
        scan,
        selectedId,
        kind,
        types,
        priorities,
        notice,
        limit,
      });
  }, [
    active,
    cache,
    workspace.id,
    scopeMode,
    autoLoad,
    options,
    scan,
    selectedId,
    kind,
    types,
    priorities,
    notice,
    limit,
  ]);
  const { mode, selectionLabel, hasSelection, scope } = useMemo(
    () => analysisScopeChoice(workspace, scopeMode, selected, wallet),
    [
      workspace.id,
      workspace.network,
      workspace.transactions,
      selected?.id,
      selected?.kind,
      selected?.txid,
      selected?.vout,
      selected?.address,
      wallet?.id,
      wallet?.name,
      wallet?.addresses,
      scopeMode,
    ],
  );
  const selectionUnavailable = mode === 'context' && !hasSelection;
  const changed =
    scan &&
    ((scan.evidenceTransactions !== undefined &&
      scan.evidenceTransactions !== workspace.transactions) ||
      scan.scope.kind !== scope.kind ||
      scan.scope.label !== scope.label ||
      JSON.stringify(scan.scope.txids) !== JSON.stringify(scope.txids) ||
      JSON.stringify(scan.options) !== JSON.stringify(options) ||
      scan.findings.some(
        (finding) => workspace.findings.find((current) => current.id === finding.id)?.stale,
      ));
  const currentIds = scan ? new Set(scan.findings.map((finding) => finding.id)) : undefined;
  const currentFindings = workspace.findings.filter(
    (finding) => !currentIds || currentIds.has(finding.id),
  );
  const filtered = filterAnalysisFindings(currentFindings, { types, priorities, kind });
  const findings = filtered.findings;
  const hasLegacy = currentFindings.some((finding) => !findingToolId(finding));
  const categories = analysisTools.map((tool) => {
    const report = scan?.reports.find((report) => report.toolId === tool.id);
    const stale =
      changed ||
      currentFindings.some((finding) => findingToolId(finding) === tool.id && finding.stale);
    const status = report
      ? stale
        ? 'Needs rerun'
        : report.status === 'complete'
          ? 'Scanned'
          : report.status === 'skipped'
            ? 'Not scanned: skipped'
            : 'Not scanned: error'
      : 'Not scanned this session';
    return {
      id: tool.id,
      label: tool.name,
      description: tool.description,
      count: filtered.types.get(tool.id) ?? 0,
      note: status + '. A zero count is not proof of absence.',
    };
  });
  if (hasLegacy)
    categories.push({
      id: 'unregistered',
      label: 'Older unregistered findings',
      description:
        'Stored findings whose check is no longer registered. Rerun to use current checks.',
      count: filtered.types.get('unregistered') ?? 0,
      note: 'Not scanned.',
    });
  const filteredResults =
    kind !== 'all' ||
    priorities.length !== reviewPriorities.length ||
    categories.some((category) => !types.includes(category.id));
  function resetFilters() {
    setTypes([...allTypes(), 'unregistered']);
    setPriorities([...reviewPriorities]);
    setKind('all');
    setLimit(40);
  }
  const detail = findings.find((finding) => finding.id === selectedId) ?? findings[0];
  const tool =
    detail && analysisTools.find((candidate) => detail.algorithm.startsWith(`${candidate.id}-`));
  async function run() {
    if (!active || pending.current || selectionUnavailable) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice('');
    try {
      const gaps = autoLoad
        ? analysisDataGaps(
            workspace,
            scope.txids,
            options['script-types']?.scriptMode !== 'outputs',
          )
        : [];
      setRecovering(gaps.some((gap) => gap.recoverable));
      const enriched = gaps.some((gap) => gap.recoverable)
        ? await recoverAnalysisData(
            workspace,
            scope.txids,
            fetchTransaction,
            controller.signal,
            options['script-types']?.scriptMode !== 'outputs',
            'automatic',
          )
        : undefined;
      setRecovering(false);
      const snapshot = enriched?.workspace ?? workspace;
      const next = await scanAnalysis(snapshot, scope, options, controller.signal);
      if (
        controller.signal.aborted ||
        latest.current.id !== workspace.id ||
        latest.current.network !== workspace.network ||
        latest.current.transactions !== workspace.transactions ||
        walletEvidenceChanged(workspace.wallets, latest.current.wallets)
      )
        return;
      if (snapshot.transactions !== workspace.transactions) {
        onRecovered(workspace, {
          ...snapshot,
          findings: mergeScanFindings(
            latest.current.findings.map((finding) => ({ ...finding, stale: true })),
            next,
          ),
        });
      } else onFindings(mergeScanFindings(latest.current.findings, next));
      if (enriched?.remaining)
        setNotice(
          `${enriched.remaining} input details still unavailable.${enriched.timedOut ? ' Automatic loading timed out.' : ''}${enriched.conflicts ? ' Conflicting evidence retained.' : ''}`,
        );
      setScan(next);
      setSelectedId(next.findings[0]?.id);
      setLimit(40);
    } catch {
      if (!controller.signal.aborted)
        setNotice('Scan could not finish. Existing findings are retained. Try again.');
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setBusy(false);
        setRecovering(false);
      }
    }
  }
  const recoveryScope = scan?.scope ?? scope;
  const recoverScripts = (scan?.options ?? options)['script-types']?.scriptMode !== 'outputs';
  const scopeGaps = useMemo(
    () => analysisDataGaps(workspace, recoveryScope.txids, recoverScripts),
    [workspace.transactions, recoveryScope, recoverScripts],
  );
  const detailTxids =
    detail?.scopeTxids ?? detail?.txids.filter((id) => workspace.transactions[id]) ?? [];
  const detailGaps = detail ? scopeGaps.filter((gap) => detailTxids.includes(gap.txid)) : [];
  async function recover(txids: string[]) {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setRecovering(true);
    setNotice('Loading missing input data…');
    const timeout = setTimeout(() => controller.abort(), recoveryLimits.timeoutMs);
    try {
      const result = await recoverAnalysisData(
        workspace,
        txids,
        fetchTransaction,
        controller.signal,
        recoverScripts,
      );
      // Rerun all checks in the last scan scope with its recorded options. Result filters never choose checks.
      const next = await scanAnalysis(
        result.workspace,
        recoveryScope,
        scan?.options ?? options,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        latest.current.id !== workspace.id ||
        latest.current.network !== workspace.network ||
        latest.current.transactions !== workspace.transactions ||
        walletEvidenceChanged(workspace.wallets, latest.current.wallets)
      )
        return;
      const merged = mergeScanFindings(
        result.workspace.transactions === workspace.transactions
          ? latest.current.findings
          : latest.current.findings.map((finding) => ({ ...finding, stale: true })),
        next,
      );
      onRecovered(workspace, { ...result.workspace, findings: merged });
      setScan(next);
      setNotice(
        `${result.resolved} input details resolved. ${result.remaining ? `${result.remaining} still unavailable. ${result.budgetReached ? 'Request limit reached. Retry for more.' : 'Retry when node data is available.'}` : 'Findings current.'} ${result.conflicts ? 'Conflicting observations were rejected; existing evidence retained. ' : ''}Reran the last scope with its scan settings.`,
      );
    } catch {
      if (pending.current === controller)
        setNotice(
          controller.signal.aborted
            ? 'Loading cancelled or timed out. This attempt was not saved. Retry when ready.'
            : 'Data unavailable. Existing findings are retained. Retry when ready.',
        );
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) {
        pending.current = undefined;
        setBusy(false);
        setRecovering(false);
      }
    }
  }
  return (
    <section className="analysis-workbench" aria-label="Analysis workbench">
      <header className="scan-header">
        <div>
          <h1>Analysis</h1>
          <p className="muted">Patterns in loaded data, with evidence and limits.</p>
        </div>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy || !active || selectionUnavailable}
            onClick={() => void run()}
          >
            <Activity size={15} />
            {recovering ? 'Loading…' : busy ? 'Scanning…' : 'Scan'}
          </button>
          {workspace.findings.length > 0 && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                onFindings([]);
                setScan(undefined);
                setSelectedId(undefined);
                setKind('all');
              }}
            >
              Clear findings
            </button>
          )}
          {busy && (
            <button
              onClick={() => {
                pending.current?.abort();
                pending.current = undefined;
                setBusy(false);
                setRecovering(false);
                setNotice(
                  'Operation cancelled. This attempt was not saved. Existing findings are retained.',
                );
              }}
            >
              <X size={14} />
              Cancel
            </button>
          )}
        </div>
      </header>
      <div className="scan-scope">
        <label>
          Scan scope
          <select
            aria-label="Scan scope"
            value={mode}
            onChange={(event) => setScopeMode(event.target.value)}
          >
            <option value="context" disabled={!hasSelection}>
              {selectionLabel}
            </option>
            <option value="workspace">Loaded workspace</option>
          </select>
        </label>
        <div>
          <strong>{scope.label}</strong>
          <p>{scope.explanation}</p>
          <p className="muted">
            {scope.txids.length} loaded transaction{scope.txids.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <details className="analysis-settings">
        <summary>Optional settings</summary>
        <label className="scan-checkbox scan-auto-load">
          <input
            type="checkbox"
            checked={autoLoad}
            onChange={(event) => setAutoLoad(event.target.checked)}
          />
          <span>Load missing input data before scanning</span>
          <WalletHelp title="Automatic input loading" active={active}>
            Refreshes affected transactions, then unresolved parents, reusing loaded and attached
            data first. Up to eight transaction lookups, three at a time, for five seconds. Partial
            results remain available; no parent branches are added. Turn off to scan offline.
          </WalletHelp>
        </label>
        <div className="scan-settings-grid">
          {analysisTools.map((item) => (
            <fieldset key={item.id}>
              <legend>
                <span className="scan-settings-title">
                  {item.name}
                  {item.id === 'wallet-intersections' && (
                    <WalletHelp title="Imported-wallet intersection options" active={active}>
                      <p>
                        <strong>Any inputs or outputs:</strong> Find transactions whose inputs or
                        outputs match at least two imported wallets.
                      </p>
                      <p>
                        <strong>Inputs from multiple wallets:</strong> Match at least two imported
                        wallets using input evidence only.
                      </p>
                      <p>
                        Both use already derived addresses and scripts. Overlapping imports can
                        match the same address; matches do not prove separate participants or common
                        ownership.
                      </p>
                    </WalletHelp>
                  )}
                </span>
              </legend>
              {item.parameters.map((parameter) => (
                <label
                  key={parameter.id}
                  className={
                    parameter.type === 'boolean' ? 'scan-checkbox' : `scan-${parameter.type}`
                  }
                >
                  {parameter.type === 'boolean' ? (
                    <>
                      <input
                        type="checkbox"
                        checked={Boolean(options[item.id][parameter.id])}
                        onChange={(event) =>
                          setOptions((current) => ({
                            ...current,
                            [item.id]: {
                              ...current[item.id],
                              [parameter.id]: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>{parameter.label}</span>
                    </>
                  ) : (
                    <>
                      <span>{parameter.label}</span>
                      {parameter.type === 'select' ? (
                        <select
                          value={String(options[item.id][parameter.id])}
                          onChange={(event) =>
                            setOptions((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                [parameter.id]: event.target.value,
                              },
                            }))
                          }
                        >
                          {parameter.choices?.map((choice) => (
                            <option key={choice.value} value={choice.value}>
                              {choice.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="number"
                          value={
                            Number.isNaN(options[item.id][parameter.id])
                              ? ''
                              : Number(options[item.id][parameter.id])
                          }
                          min={parameter.min}
                          max={parameter.max}
                          step={parameter.step ?? 1}
                          onChange={(event) =>
                            setOptions((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                [parameter.id]:
                                  event.target.value === '' ? NaN : Number(event.target.value),
                              },
                            }))
                          }
                        />
                      )}
                    </>
                  )}
                  {parameter.help && <small className="muted">{parameter.help}</small>}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <button
          onClick={() => {
            setOptions(scanDefaults());
            setAutoLoad(true);
          }}
        >
          Restore defaults
        </button>
      </details>
      <div aria-live="polite">
        {notice && <p className="scan-notice">{notice}</p>}
        {scan && (
          <p className="scan-run-note">
            Last scan: {scan.scope.label} · {scan.scope.txids.length} transactions ·{' '}
            <time dateTime={scan.runAt}>{new Date(scan.runAt).toLocaleTimeString()}</time>
            {changed && <span> · Scope or settings changed. Scan again to update.</span>}
          </p>
        )}
      </div>
      {scan && (
        <details className="scan-coverage" key={scan.runAt} open={!scan.findings.length}>
          <summary>
            Scan coverage
            {scan.reports.some((item) => item.status === 'skipped') &&
              ` · ${scan.reports.filter((item) => item.status === 'skipped').length} skipped`}
            {scan.reports.some((item) => item.status === 'error') &&
              ` · ${scan.reports.filter((item) => item.status === 'error').length} error`}
          </summary>
          <ul>
            {scan.reports.map((item) => (
              <li key={item.toolId}>
                <strong>
                  {analysisTools.find((candidate) => candidate.id === item.toolId)?.name}
                </strong>
                <span className={`scan-status ${item.status}`}>
                  {item.status === 'complete'
                    ? 'Ran'
                    : item.status === 'skipped'
                      ? 'Skipped'
                      : 'Error'}
                </span>
                <p>{item.message}</p>
                {item.report && (
                  <details>
                    <summary>Coverage and skipped records</summary>
                    <dl>
                      {item.report.stats.map((stat) => (
                        <div key={stat.label}>
                          <dt>{stat.label}</dt>
                          <dd>{stat.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {scopeGaps.length > 0 && (
        <div className="scan-recovery-scope">
          <span>
            {scopeGaps.length} input details unavailable in {scan ? 'last scan' : 'current'} scope
          </span>
          <button
            disabled={busy || !active || !scopeGaps.some((gap) => gap.recoverable)}
            onClick={() => void recover(recoveryScope.txids)}
          >
            Load scope data and rerun
          </button>
          <WalletHelp title="Missing input data" active={active}>
            Reuses loaded and attached outputs. Refreshes affected spends, then unresolved parents
            only. Up to 20 transaction lookups, three at once, with a 30-second timeout. Parent
            outputs are attached without adding graph branches. Reruns all checks with the last scan
            scope and settings. Nodes may lack pruned or unconfirmed parent data. Unavailable data
            stays unknown; cancellation discards this attempt.
          </WalletHelp>
        </div>
      )}
      <div className="scan-results-heading">
        <WalletCategoryFilter
          active={active}
          title="Analysis finding types"
          categories={categories}
          selected={types.filter((id) => categories.some((category) => category.id === id))}
          onChange={(ids) => {
            setTypes(ids);
            setLimit(40);
          }}
          countHelp="Filters results only; Scan still runs every check. Types match with OR. Counts match the evidence and priority filters, ignoring type selection. Help shows scan status."
        />
        <div className="scan-priorities" aria-label="Review priority filters">
          {reviewPriorities.map((priority) => (
            <button
              key={priority}
              aria-pressed={priorities.includes(priority)}
              onClick={() => {
                setPriorities((current) =>
                  current.includes(priority)
                    ? current.filter((item) => item !== priority)
                    : [...current, priority],
                );
                setLimit(40);
              }}
            >
              <PriorityIcon priority={priority} />
              {priority[0].toUpperCase() + priority.slice(1)}{' '}
              <span className="wallet-count">{filtered.priorities[priority]}</span>
            </button>
          ))}
        </div>
        <select
          aria-label="Finding evidence"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setLimit(40);
          }}
        >
          <option value="all">All evidence</option>
          <option value="observation">Observations</option>
          <option value="hypothesis">Hypotheses</option>
          <option value="incomplete">Incomplete data</option>
        </select>
        {(scan || workspace.findings.length > 0) && (
          <span className="muted">
            {findings.length} result{findings.length === 1 ? '' : 's'}
          </span>
        )}
        {filteredResults && (
          <button className="text-button" onClick={resetFilters}>
            Reset filters
          </button>
        )}
      </div>
      {!findings.length ? (
        <p className="scan-empty">
          {filteredResults
            ? 'No findings match these filters. Reset filters to show available results.'
            : scan
              ? 'No findings in this scan. Review Scan coverage for skipped records, missing data and tools with no matches.'
              : 'Scan the current selection or loaded workspace to inspect its patterns and limits.'}
        </p>
      ) : (
        <div className="scan-results">
          <div className="scan-result-list" aria-label="Analysis findings">
            {findings.slice(0, limit).map((finding) => (
              <button
                key={finding.id}
                className={detail?.id === finding.id ? 'active' : ''}
                aria-pressed={detail?.id === finding.id}
                onClick={() => setSelectedId(finding.id)}
              >
                <span className="scan-result-kind">
                  <PriorityIcon priority={findingReview(finding).priority} />
                  {finding.kind ?? 'hypothesis'}
                  {finding.excluded ? ' · Excluded' : ''}
                  {finding.stale ? ' · Needs rerun' : ''}
                </span>
                <strong>{finding.title}</strong>
                <span className="muted">
                  {finding.txids.length} supporting transaction
                  {finding.txids.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
            {findings.length > limit && (
              <button onClick={() => setLimit((current) => current + 40)}>
                Show more findings ({findings.length - limit} remaining)
              </button>
            )}
          </div>
          {detail && (
            <article key={detail.id} className="scan-detail" aria-label="Selected finding">
              <span className="scan-result-kind">
                <PriorityIcon priority={findingReview(detail).priority} />
                {findingReview(detail).priority} priority · {detail.kind ?? 'hypothesis'}
                {detail.excluded ? ' · Excluded finding' : ''}
                <WalletHelp title="Why this priority" active={active}>
                  {findingReview(detail).reason}
                </WalletHelp>
              </span>
              <h2>{detail.title}</h2>
              <p>{detail.description}</p>
              {detail.guidance && <FindingGuidance guidance={detail.guidance} />}
              {detailGaps.length > 0 && (
                <div className="scan-recovery-detail">
                  <button
                    disabled={busy || !active || !detailGaps.some((gap) => gap.recoverable)}
                    onClick={() => void recover(detailTxids)}
                  >
                    {recovering ? 'Loading…' : 'Load missing data and rerun'}
                  </button>
                  <span className="muted">
                    {detailGaps.some((gap) => gap.conflict)
                      ? 'Conflicting observations need review; they will not be replaced.'
                      : `For ${new Set(detailGaps.map((gap) => gap.txid)).size} affected transaction(s).`}
                  </span>
                </div>
              )}
              {detail.stale && (
                <p className="scan-notice">
                  Loaded data changed after this finding. Scan again to refresh its evidence.
                </p>
              )}
              <div className="button-row">
                <button disabled={!detail.nodeIds.length} onClick={() => onGraph(detail.nodeIds)}>
                  <Network size={14} />
                  Show on graph
                </button>
                <button
                  disabled={!detail.nodeIds.length}
                  onClick={() => onGraph(detail.nodeIds, true)}
                >
                  <Focus size={14} />
                  Isolate
                </button>
                <button
                  onClick={() =>
                    onFindings(
                      workspace.findings.map((finding) =>
                        finding.id === detail.id
                          ? { ...finding, excluded: !finding.excluded }
                          : finding,
                      ),
                    )
                  }
                >
                  {detail.excluded ? 'Restore finding' : 'Exclude finding'}
                </button>
              </div>
              {(detail.nodeIds.length > 0 || detail.txids.length > 0) && (
                <>
                  <h3>Related transactions and outputs</h3>
                  <ul className="scan-evidence" aria-label="Related transactions and outputs">
                    {[...new Set([...detail.nodeIds, ...detail.txids.map(txNodeId)])].map((id) => (
                      <EvidenceReference
                        key={id}
                        id={id}
                        workspace={workspace}
                        onGraph={onGraph}
                        prevouts={prevouts}
                      />
                    ))}
                  </ul>
                </>
              )}
              {detail.details && (
                <details>
                  <summary>Details</summary>
                  <p>{detail.details}</p>
                </details>
              )}
              <details>
                <summary>Interpretation and limits</summary>
                <p>
                  Checks use the available workspace data. Missing input details, unscanned wallet
                  addresses and unloaded transactions limit coverage. Co-spending does not prove
                  shared ownership: CoinJoin and PayJoin can invalidate that assumption. Bitcoin
                  does not record which input funded a particular output.
                </p>
                {tool && (
                  <a href={tool.source.url} target="_blank" rel="noreferrer">
                    Method reference: {tool.source.title}
                  </a>
                )}
              </details>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
