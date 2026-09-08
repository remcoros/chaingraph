import { useEffect, useRef, useState } from 'react';
import { Activity, Search } from 'lucide-react';
import {
  analysisTools,
  defaultsFor,
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
  runReports?: Record<string, AnalysisRunReport>;
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
  runReports = {},
  onSelect,
  onRun,
  onClear,
  onFocus,
  onToggle,
  onIsolate,
}: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<AnalysisScope>('graph');
  const [options, setOptions] = useState<Record<string, AnalysisOptions>>(() =>
    Object.fromEntries(analysisTools.map((tool) => [tool.id, defaultsFor(tool)])),
  );
  const [resultQuery, setResultQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [state, setState] = useState('all');
  const [resultTool, setResultTool] = useState('all');
  const [limit, setLimit] = useState(30);
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
  const actualScope = scope === 'selection' && !selectedTxids.length ? 'graph' : scope;
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
    setOptions((current) => ({ ...current, [toolId]: { ...current[toolId], [key]: value } }));
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
            value={actualScope}
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
                      <details className="analysis-parameters">
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
                        disabled={!hasNodes || busy}
                        onClick={() => {
                          pendingRun.current = { id: tool.id, previous: runReports[tool.id] };
                          onRun(tool.id, options[tool.id], actualScope);
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
              <button onClick={() => setLimit((current) => current + 30)}>
                Show more findings
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
