import { Activity } from 'lucide-react';
import { analysisTools } from '../domain/analysis';
import { short, txNodeId, type AnalysisFinding } from '../domain/types';
interface Props {
  findings: AnalysisFinding[];
  hasNodes: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onRun: (id: string) => void;
  onClear: () => void;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
}
export function AnalysisPanel({
  findings,
  hasNodes,
  busy,
  onSelect,
  onRun,
  onClear,
  onFocus,
  onToggle,
}: Props) {
  return (
    <>
      <div className="panel-section">
        <span className="eyebrow">TOOLS, NOT VERDICTS</span>
        <h2>Look for patterns</h2>
        <p className="muted small">
          Tools analyze loaded history. Findings are reversible hypotheses, separate from your
          labels.
        </p>
        {analysisTools.map((tool) => (
          <div className="analysis-tool" key={tool.id}>
            <h3>{tool.name}</h3>
            <p>{tool.description}</p>
            <button disabled={!hasNodes || busy} onClick={() => onRun(tool.id)}>
              <Activity size={14} />
              Run analysis
            </button>
          </div>
        ))}
      </div>
      {findings.length > 0 && (
        <div className="panel-section">
          <div className="section-title">
            <h3>Findings</h3>
            <button className="text-button" onClick={onClear}>
              Clear all
            </button>
          </div>
          {findings.map((f) => (
            <div className={`finding ${f.excluded ? 'excluded' : ''}`} key={f.id}>
              <strong>{f.title}</strong>
              <p>{f.description}</p>
              <small>
                {f.nodeIds.length} nodes · {f.txids.length} transactions
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
                  {f.txids.length > 5 && <small>Showing 5 of {f.txids.length}</small>}
                </div>
              )}
              <div className="button-row">
                <button onClick={() => onFocus(f.nodeIds[0])}>Focus</button>
                <button onClick={() => onToggle(f.id)}>{f.excluded ? 'Restore' : 'Exclude'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
