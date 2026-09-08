import { useEffect, useRef } from 'react';
import type { AnalysisUiRunReport, AnalysisUiState } from '../lib/useAnalysisUiState';
import { Activity, Search } from 'lucide-react';
import {
  analysisTools,
  type AnalysisOptions,
  type AnalysisRunReport,
  type AnalysisScope,
} from '../domain/analysis';
import { short, txNodeId, type AnalysisFinding } from '../domain/types';
import './analysis.css';
interface Props {
  findings: AnalysisFinding[];
  hasNodes: boolean;
  busy: boolean;
  selectedTxids?: string[];
  graphTxids?: string[];
  runReports?: Record<string, AnalysisUiRunReport>;
  uiState: AnalysisUiState;
  onUiStateChange: (update: (state: AnalysisUiState) => AnalysisUiState) => void;
  onSelect: (id: string) => void;
  onRun: (id: string, options?: AnalysisOptions, scope?: AnalysisScope) => void;
  onClear: () => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onIsolate?: (nodeIds: string[]) => void;
}
const groups = ['Privacy patterns', 'Value and structure', 'Imported wallets'] as const;
function resultKind(finding: AnalysisFinding) {
  return finding.kind ?? (finding.algorithm.startsWith('cioh') ? 'hypothesis' : 'observation');
}
export function AnalysisPanel({
  findings,
  hasNodes,
  busy,
  selectedTxids = [],
  graphTxids = [],
  runReports = {},
  uiState,
  onUiStateChange,
  onSelect,
  onRun,
  onClear,
  onFocus,
  onToggle,
  onIsolate,
}: Props) {
  const {
    query,
    scope,
    options,
    resultQuery,
    resultKind: kind,
    resultState: state,
    resultTool,
    limit,
  } = uiState;
  function setField<K extends keyof AnalysisUiState>(key: K, value: AnalysisUiState[K]) {
    onUiStateChange((current) => ({ ...current, [key]: value }));
  }
  const setQuery = (value: string) => setField('query', value);
  const setScope = (value: AnalysisScope) => setField('scope', value);
  const setResultQuery = (value: string) => setField('resultQuery', value);
  const setKind = (value: string) => setField('resultKind', value);
  const setState = (value: string) => setField('resultState', value);
  const setResultTool = (value: string) => setField('resultTool', value);
  const setLimit = (value: number) => setField('limit', value);
  const toolsSection = useRef<HTMLDivElement>(null);
  const findingsSection = useRef<HTMLDivElement>(null);
  const pendingRun = useRef<{ id: string; previous?: AnalysisRunReport } | undefined>(undefined);
  useEffect(() => {
    const pending = pendingRun.current;
    if (!pending || !runReports[pending.id] || runReports[pending.id] === pending.previous) return;
    pendingRun.current = undefined;
    if (runReports[pending.id].findings.length) {
      setResultQuery('');
      setKind('all');
      setState('all');
      setResultTool('all');
      setLimit(30);
      findingsSection.current?.scrollIntoView({ block: 'start' });
    }
  }, [runReports]);
  const missingSelection = scope === 'selection' && !selectedTxids.length;
  const currentScopeIds = new Set(scope === 'selection' ? selectedTxids : graphTxids);
  const visibleTools = analysisTools.filter((tool) =>
    `${tool.name} ${tool.description} ${tool.group}`.toLowerCase().includes(query.toLowerCase()),
  );
  const results = findings.filter(
    (f) =>
      (kind === 'all' || resultKind(f) === kind) &&
      (state === 'all' ||
        (state === 'active' && !f.excluded && !f.stale) ||
        (state === 'excluded' && f.excluded) ||
        (state === 'stale' && f.stale)) &&
      (resultTool === 'all' || f.algorithm.startsWith(`${resultTool}-`)) &&
      `${f.title} ${f.description}`.toLowerCase().includes(resultQuery.toLowerCase()),
  );
  function setOption(toolId: string, key: string, value: number | string | boolean) {
    onUiStateChange((current) => ({
      ...current,
      options: { ...current.options, [toolId]: { ...current.options[toolId], [key]: value } },
    }));
  }
  return (
    <div className="analysis-panel">
      <nav className="analysis-jump-nav" aria-label="Analysis sections">
        <button onClick={() => toolsSection.current?.scrollIntoView({ block: 'start' })}>
          Tools · {analysisTools.length}
        </button>
        <button onClick={() => findingsSection.current?.scrollIntoView({ block: 'start' })}>
          Findings · {findings.length}
        </button>
      </nav>
      <div className="panel-section" ref={toolsSection}>
        <span className="eyebrow">EVIDENCE AND HYPOTHESES</span>
        <h2>Look for patterns</h2>
        <p className="muted small">
          Run checks on loaded transactions. Observations describe records; ownership groups remain
          hypotheses. Findings stay separate from your labels.
        </p>
        <label className="analysis-field">
          Analysis scope
          <select
            value={scope}
            aria-label="Analysis scope"
            onChange={(event) => setScope(event.target.value as AnalysisScope)}
          >
            <option value="graph">Visible graph</option>
            <option value="selection" disabled={!selectedTxids.length}>
              Selected transaction{selectedTxids.length > 1 ? 's' : ''}
              {selectedTxids.length ? ` (${selectedTxids.length})` : ''}
            </option>
          </select>
        </label>
        {missingSelection && (
          <p className="muted small" role="status">
            Select a transaction to run this scope, or choose Visible graph.
          </p>
        )}
        <p className="muted small">
          Loaded parents can provide input evidence even when outside the chosen scope. No
          additional network requests are made.
        </p>
        <label className="analysis-search">
          <Search size={14} />
          <input
            aria-label="Search analysis tools"
            placeholder="Find a tool or pattern"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!visibleTools.length && <p className="muted small">No tools match this search.</p>}
        {groups.map((group) => {
          const tools = visibleTools.filter((tool) => tool.group === group);
          return (
            tools.length > 0 && (
              <section className="analysis-group" key={group}>
                <h3 className="analysis-group-title">{group}</h3>
                {tools.map((tool) => {
                  const report = runReports[tool.id];
                  return (
                    <div className="analysis-tool" key={tool.id}>
                      <div className="analysis-card-heading">
                        <h3>{tool.name}</h3>
                        <span className={`analysis-badge ${tool.kind}`}>{tool.kind}</span>
                      </div>
                      <p>{tool.description}</p>
                      <details
                        className="analysis-parameters"
                        open={uiState.expandedTools[tool.id] ?? false}
                        onToggle={(event) => {
                          const open = event.currentTarget.open;
                          if (open !== (uiState.expandedTools[tool.id] ?? false))
                            onUiStateChange((current) => ({
                              ...current,
                              expandedTools: { ...current.expandedTools, [tool.id]: open },
                            }));
                        }}
                      >
                        <summary>Parameters and method</summary>
                        {tool.parameters.map((parameter) => (
                          <label
                            className={`analysis-field ${parameter.type === 'boolean' ? 'analysis-checkbox' : ''}`}
                            key={parameter.id}
                          >
                            {parameter.type === 'boolean' ? (
                              <>
                                <input
                                  type="checkbox"
                                  checked={Boolean(options[tool.id][parameter.id])}
                                  onChange={(event) =>
                                    setOption(tool.id, parameter.id, event.target.checked)
                                  }
                                />
                                {parameter.label}
                              </>
                            ) : (
                              <>
                                {parameter.label}
                                {parameter.type === 'select' ? (
                                  <select
                                    value={String(options[tool.id][parameter.id])}
                                    onChange={(event) =>
                                      setOption(tool.id, parameter.id, event.target.value)
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
                                    min={parameter.min}
                                    max={parameter.max}
                                    step={parameter.step ?? 1}
                                    value={
                                      Number.isNaN(options[tool.id][parameter.id])
                                        ? ''
                                        : Number(options[tool.id][parameter.id])
                                    }
                                    onChange={(event) =>
                                      setOption(
                                        tool.id,
                                        parameter.id,
                                        event.target.value === ''
                                          ? NaN
                                          : Number(event.target.value),
                                      )
                                    }
                                  />
                                )}
                              </>
                            )}
                            {parameter.help && <small className="muted">{parameter.help}</small>}
                          </label>
                        ))}
                        <a href={tool.source.url} target="_blank" rel="noreferrer">
                          {tool.source.title}
                        </a>
                      </details>
                      <button
                        disabled={busy || (scope === 'selection' ? missingSelection : !hasNodes)}
                        onClick={() => {
                          pendingRun.current = { id: tool.id, previous: runReports[tool.id] };
                          onRun(tool.id, options[tool.id], scope);
                        }}
                      >
                        <Activity size={14} />
                        Run analysis
                      </button>
                      {report && (
                        <div className="analysis-run-report" role="status">
                          <strong>
                            Last run · {report.scopeTxids.length} transaction
                            {report.scopeTxids.length === 1 ? '' : 's'}
                          </strong>
                          <p>
                            {report.findings.length
                              ? report.summary
                              : (report.emptyReason ?? report.summary)}
                          </p>
                          {report.inputScope && (
                            <>
                              <p className="muted small">
                                Run scope:{' '}
                                {report.inputScope === 'selection'
                                  ? 'Selected transaction'
                                  : 'Visible graph'}
                                {report.runAt && (
                                  <>
                                    {' '}
                                    ·{' '}
                                    <time
                                      dateTime={report.runAt}
                                      title={new Date(report.runAt).toLocaleString()}
                                    >
                                      {new Date(report.runAt).toLocaleTimeString()}
                                    </time>
                                  </>
                                )}
                              </p>
                              {(report.inputScope !== scope ||
                                tool.parameters.some(
                                  (parameter) =>
                                    !Object.is(
                                      report.inputOptions?.[parameter.id],
                                      options[tool.id][parameter.id],
                                    ),
                                ) ||
                                report.scopeTxids.length !== currentScopeIds.size ||
                                report.scopeTxids.some((id) => !currentScopeIds.has(id))) && (
                                <p className="small analysis-settings-changed">
                                  Controls changed since this run. Rerun to update.
                                </p>
                              )}
                              <details className="analysis-last-run-settings">
                                <summary>Last-run parameters</summary>
                                <dl>
                                  {tool.parameters.map((parameter) => (
                                    <div key={parameter.id}>
                                      <dt>{parameter.label}</dt>
                                      <dd>
                                        {typeof report.inputOptions?.[parameter.id] === 'boolean'
                                          ? report.inputOptions[parameter.id]
                                            ? 'On'
                                            : 'Off'
                                          : String(
                                              report.inputOptions?.[parameter.id] ??
                                                parameter.defaultValue,
                                            )}
                                      </dd>
                                    </div>
                                  ))}
                                </dl>
                              </details>
                            </>
                          )}
                          <details>
                            <summary>Coverage and skipped records</summary>
                            <dl>
                              {report.stats.map((stat) => (
                                <div key={stat.label}>
                                  <dt>{stat.label}</dt>
                                  <dd>{stat.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )
          );
        })}
      </div>
      <div className="panel-section" ref={findingsSection}>
        <div className="section-title">
          <h3>
            Findings <span className="muted">{findings.length}</span>
          </h3>
          {findings.length > 0 && (
            <button className="text-button" onClick={onClear}>
              Clear all
            </button>
          )}
        </div>
        {!findings.length ? (
          <p className="muted small">
            Run a tool to create inspectable findings. A check with no matches still reports its
            scope and coverage above.
          </p>
        ) : (
          <>
            <input
              className="analysis-result-search"
              aria-label="Search findings"
              placeholder="Search findings"
              value={resultQuery}
              onChange={(event) => {
                setResultQuery(event.target.value);
                setLimit(30);
              }}
            />
            <div className="analysis-result-filters">
              <label className="analysis-field">
                Tool
                <select
                  value={resultTool}
                  aria-label="Tool"
                  onChange={(event) => {
                    setResultTool(event.target.value);
                    setLimit(30);
                  }}
                >
                  <option value="all">All tools</option>
                  {analysisTools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="analysis-field">
                Evidence
                <select
                  value={kind}
                  aria-label="Evidence"
                  onChange={(event) => {
                    setKind(event.target.value);
                    setLimit(30);
                  }}
                >
                  <option value="all">All types</option>
                  <option value="observation">Observations</option>
                  <option value="hypothesis">Hypotheses</option>
                  <option value="incomplete">Incomplete data</option>
                </select>
              </label>
              <label className="analysis-field">
                Status
                <select
                  value={state}
                  aria-label="Status"
                  onChange={(event) => {
                    setState(event.target.value);
                    setLimit(30);
                  }}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="excluded">Excluded</option>
                  <option value="stale">Needs rerun</option>
                </select>
              </label>
            </div>
            <p className="muted small">
              {results.length} matching finding{results.length === 1 ? '' : 's'}
            </p>
            {results.slice(0, limit).map((f) => (
              <div className={`finding ${f.excluded ? 'excluded' : ''}`} key={f.id}>
                <div className="analysis-result-badges">
                  <span className={`analysis-badge ${resultKind(f)}`}>{resultKind(f)}</span>
                  {f.stale && <span className="analysis-badge incomplete">Needs rerun</span>}
                  {f.excluded && <span className="analysis-badge">Excluded</span>}
                </div>
                <strong>{f.title}</strong>
                <p>{f.description}</p>
                {f.stale && (
                  <p className="analysis-stale-note">
                    Workspace data changed after this result. Rerun the tool to refresh its
                    evidence.
                  </p>
                )}
                <small>
                  {f.nodeIds.length} node{f.nodeIds.length === 1 ? '' : 's'} · {f.txids.length}{' '}
                  supporting transaction{f.txids.length === 1 ? '' : 's'}
                </small>
                {f.txids.length > 0 && (
                  <div className="finding-evidence">
                    <small>Supporting transactions</small>
                    {f.txids.slice(0, 5).map((txid) => (
                      <button
                        key={txid}
                        className="text-button mono"
                        title={txid}
                        onClick={() => onSelect(txNodeId(txid))}
                      >
                        {short(txid)}
                      </button>
                    ))}
                    {f.txids.length > 5 && (
                      <details>
                        <summary>{f.txids.length - 5} more transactions</summary>
                        {f.txids.slice(5, 50).map((txid) => (
                          <button
                            key={txid}
                            className="text-button mono"
                            title={txid}
                            onClick={() => onSelect(txNodeId(txid))}
                          >
                            {short(txid)}
                          </button>
                        ))}
                        {f.txids.length > 50 && (
                          <small>Showing the first 50 supporting transactions.</small>
                        )}
                      </details>
                    )}
                  </div>
                )}
                <div className="button-row">
                  <button disabled={!f.nodeIds.length} onClick={() => onFocus(f.nodeIds[0])}>
                    Focus
                  </button>
                  {onIsolate && (
                    <button disabled={!f.nodeIds.length} onClick={() => onIsolate(f.nodeIds)}>
                      Show on graph
                    </button>
                  )}
                  <button onClick={() => onToggle(f.id)}>
                    {f.excluded ? 'Restore' : 'Exclude'}
                  </button>
                </div>
              </div>
            ))}
            {!results.length && <p className="muted small">No findings match these filters.</p>}
            {results.length > limit && (
              <button onClick={() => setLimit(limit + 30)}>Show more findings</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
