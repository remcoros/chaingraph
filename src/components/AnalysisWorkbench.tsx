import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Focus, Network, X } from 'lucide-react';
import { analysisTools } from '../domain/analysis';
import {
  analysisScanScope,
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
import './analysis-workbench.css';

export interface AnalysisWorkbenchSession {
  scopeMode: string;
  options: ReturnType<typeof scanDefaults>;
  scan?: AnalysisScan;
  selectedId?: string;
  kind: string;
  limit: number;
}

export interface AnalysisWorkbenchProps {
  active: boolean;
  cache?: Map<string, AnalysisWorkbenchSession>;
  workspace: Workspace;
  selected?: GraphNode;
  wallet?: Wallet;
  onFindings: (findings: AnalysisFinding[]) => void;
  onGraph: (ids: string[], isolate?: boolean) => void;
}

function EvidenceReference({
  id,
  workspace,
  onGraph,
}: {
  id: string;
  workspace: Workspace;
  onGraph: AnalysisWorkbenchProps['onGraph'];
}) {
  const [prefix, txid, index] = id.split(':');
  const kind = prefix === 'out' ? 'Output' : prefix === 'tx' ? 'Transaction' : 'Address';
  const reference = id.slice(id.indexOf(':') + 1);
  const output =
    prefix === 'out'
      ? workspace.transactions[txid]?.vout.find((item) => item.n === Number(index))
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
            {prefix === 'out' ? `${short(txid, 12)}:${index}` : short(reference, 12)}
          </span>
        </button>
        {prefix === 'out' && (
          <span className="scan-evidence-value">
            {formatSats(output ? sats(output.value) : undefined)}
          </span>
        )}
      </div>
      {label && <span className="scan-evidence-label">{label}</span>}
      {address && (
        <button
          className="text-button scan-evidence-address"
          title={address}
          aria-label={`Show address ${address} on graph`}
          onClick={() => onGraph([addressNodeId(address)])}
        >
          <span>Address</span>
          <span className="mono">{short(address, 12)}</span>
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
  onGraph,
  active,
  cache,
}: AnalysisWorkbenchProps) {
  const saved = cache?.get(workspace.id);
  const [scopeMode, setScopeMode] = useState(saved?.scopeMode ?? 'context');
  const [options, setOptions] = useState(saved?.options ?? scanDefaults);
  const [scan, setScan] = useState<AnalysisScan | undefined>(saved?.scan);
  const [selectedId, setSelectedId] = useState<string | undefined>(saved?.selectedId);
  const [kind, setKind] = useState(saved?.kind ?? 'all');
  const [limit, setLimit] = useState(saved?.limit ?? 40);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | undefined>(undefined);
  const latest = useRef(workspace);
  latest.current = workspace;
  useEffect(() => () => pending.current?.abort(), []);
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
      setNotice('Scan cancelled. Existing findings are retained. Scan again when ready.');
    }
  }, [active, workspace.id, workspace.network, workspace.transactions, workspace.wallets]);
  useEffect(() => {
    if (active) cache?.set(workspace.id, { scopeMode, options, scan, selectedId, kind, limit });
  }, [active, cache, workspace.id, scopeMode, options, scan, selectedId, kind, limit]);
  const scope = useMemo(
    () =>
      analysisScanScope(
        workspace,
        scopeMode === 'context' ? selected : undefined,
        scopeMode === 'context' ? wallet : undefined,
      ),
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
  const changed =
    scan &&
    (scan.scope.kind !== scope.kind ||
      scan.scope.label !== scope.label ||
      JSON.stringify(scan.scope.txids) !== JSON.stringify(scope.txids) ||
      JSON.stringify(scan.options) !== JSON.stringify(options));
  const currentIds = scan ? new Set(scan.findings.map((finding) => finding.id)) : undefined;
  const findings = workspace.findings.filter(
    (finding) =>
      (!currentIds || currentIds.has(finding.id)) && (kind === 'all' || finding.kind === kind),
  );
  const detail = findings.find((finding) => finding.id === selectedId) ?? findings[0];
  const tool =
    detail && analysisTools.find((candidate) => detail.algorithm.startsWith(`${candidate.id}-`));
  const report = tool && scan?.reports.find((item) => item.toolId === tool.id)?.report;
  async function run() {
    if (!active) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNotice('');
    try {
      const next = await scanAnalysis(workspace, scope, options, controller.signal);
      if (
        controller.signal.aborted ||
        latest.current.id !== workspace.id ||
        latest.current.network !== workspace.network ||
        latest.current.transactions !== workspace.transactions ||
        walletEvidenceChanged(workspace.wallets, latest.current.wallets)
      )
        return;
      onFindings(mergeScanFindings(latest.current.findings, next));
      setScan(next);
      setSelectedId(next.findings[0]?.id);
      setKind('all');
      setLimit(40);
    } catch {
      if (!controller.signal.aborted)
        setNotice('Scan could not finish. Existing findings are retained. Try again.');
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setBusy(false);
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
          <button className="primary" disabled={busy || !active} onClick={() => void run()}>
            <Activity size={15} />
            {busy ? 'Scanning…' : 'Scan'}
          </button>
          {busy && (
            <button
              onClick={() => {
                pending.current?.abort();
                pending.current = undefined;
                setBusy(false);
                setNotice('Scan cancelled. Existing findings are retained.');
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
            value={scopeMode}
            onChange={(event) => setScopeMode(event.target.value)}
          >
            <option value="context">Current selection</option>
            <option value="workspace">Loaded workspace</option>
          </select>
        </label>
        <div>
          <strong>{scope.label}</strong>
          {scopeMode === 'context' && scope.kind === 'workspace' && (
            <p>No current selection. The scan uses the loaded workspace.</p>
          )}
          <p>{scope.explanation}</p>
          <p className="muted">
            Loaded data only · {scope.txids.length} transaction{scope.txids.length === 1 ? '' : 's'}
            . No network requests.
          </p>
        </div>
      </div>
      <details className="scan-settings">
        <summary>Optional settings</summary>
        <p className="muted">
          Defaults run every applicable analysis. Parameters change matching criteria, not loaded
          coverage.
        </p>
        <div className="scan-settings-grid">
          {analysisTools.map((item) => (
            <fieldset key={item.id}>
              <legend>{item.name}</legend>
              {item.parameters.map((parameter) => (
                <label
                  key={parameter.id}
                  className={parameter.type === 'boolean' ? 'scan-checkbox' : ''}
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
                      {parameter.label}
                    </>
                  ) : (
                    <>
                      {parameter.label}
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
        <button onClick={() => setOptions(scanDefaults())}>Restore defaults</button>
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
      <div className="scan-results-heading">
        <h2>Findings</h2>
        <label>
          Evidence
          <select
            aria-label="Finding evidence"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
              setLimit(40);
            }}
          >
            <option value="all">All types</option>
            <option value="observation">Observations</option>
            <option value="hypothesis">Hypotheses</option>
            <option value="incomplete">Incomplete data</option>
          </select>
        </label>
        {findings.length > 0 && <span className="muted">{findings.length} results</span>}
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
            Clear all
          </button>
        )}
      </div>
      {!findings.length ? (
        <p className="scan-empty">
          {kind !== 'all'
            ? 'No findings match this evidence filter.'
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
            <article className="scan-detail" aria-label="Selected finding">
              <span className="scan-result-kind">
                {detail.kind ?? 'hypothesis'}
                {detail.excluded ? ' · Excluded finding' : ''}
              </span>
              <h2>{detail.title}</h2>
              <p>{detail.description}</p>
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
              <h3>Evidence</h3>
              <p className="muted">
                Open an affected entity or supporting transaction to inspect it on the graph.
              </p>
              {detail.nodeIds.length > 0 && (
                <>
                  <h4>Affected entities</h4>
                  <ul className="scan-evidence" aria-label="Affected entities">
                    {[...new Set(detail.nodeIds)].map((id) => (
                      <EvidenceReference key={id} id={id} workspace={workspace} onGraph={onGraph} />
                    ))}
                  </ul>
                </>
              )}
              {detail.txids.length > 0 && (
                <>
                  <h4>Supporting transactions</h4>
                  <ul className="scan-evidence" aria-label="Supporting transactions">
                    {[...new Set(detail.txids)].map((txid) => (
                      <EvidenceReference
                        key={txid}
                        id={txNodeId(txid)}
                        workspace={workspace}
                        onGraph={onGraph}
                      />
                    ))}
                  </ul>
                </>
              )}
              {report && (
                <details>
                  <summary>Method coverage</summary>
                  <dl>
                    {report.stats.map((stat) => (
                      <div key={stat.label}>
                        <dt>{stat.label}</dt>
                        <dd>{stat.value}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              <h3>Interpretation and limits</h3>
              <p>
                These checks use the loaded snapshot. Missing parents, undiscovered addresses and
                unloaded spenders limit coverage. A hypothesis does not prove common ownership.
                Collaborative transactions, including CoinJoin and PayJoin, can invalidate ownership
                assumptions. Bitcoin does not record which input funded a particular output.
              </p>
              {tool && (
                <a href={tool.source.url} target="_blank" rel="noreferrer">
                  Method reference: {tool.source.title}
                </a>
              )}
            </article>
          )}
        </div>
      )}
    </section>
  );
}
