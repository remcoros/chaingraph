import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, Workspace } from '../domain/types';
import { short } from '../domain/types';
import {
  inspectScript,
  relatedTransactions,
  type RawInspection,
} from '../domain/transactionInspection';
import { fetchRawInspection } from '../lib/transactionInspection';
import { CopyButton } from './CopyButton';
import './transaction-view.css';

function HexField({
  title,
  value,
  decode = false,
}: {
  title: string;
  value?: string;
  decode?: boolean;
}) {
  const result = useMemo(() => (decode ? inspectScript(value) : { hex: value }), [value, decode]);
  return (
    <div className="script-field">
      <div className="section-title">
        <h4>{title}</h4>
        {value !== undefined && <CopyButton value={value} label={`Copy ${title}`} />}
      </div>
      <pre tabIndex={0}>{result.hex === undefined ? 'Not loaded' : result.hex || '(empty)'}</pre>
      {decode && result.asm !== undefined && (
        <>
          <small className="muted">Opcodes / ASM (normalized)</small>
          <pre tabIndex={0}>{result.asm}</pre>
        </>
      )}
      {result.error && <p className="small warning">{result.error}</p>}
    </div>
  );
}

export function ScriptInspector({
  workspace,
  selected,
  canQuery,
}: {
  workspace: Workspace;
  selected: GraphNode;
  canQuery: boolean;
}) {
  const related = useMemo(
    () => relatedTransactions(workspace.transactions, selected),
    [workspace.transactions, selected.id],
  );
  const [choice, setChoice] = useState('');
  const transaction = related.find(({ tx }) => tx.txid === choice)?.tx ?? related[0]?.tx;
  const [raw, setRaw] = useState<RawInspection>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputIndex, setInputIndex] = useState(0);
  const [outputIndex, setOutputIndex] = useState(0);
  const [witnessLimit, setWitnessLimit] = useState(20);
  useEffect(() => setWitnessLimit(20), [inputIndex, transaction]);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    request.current?.abort();
    setRaw(undefined);
    setError('');
    setLoading(false);
    const input =
      transaction?.vin.findIndex((i) => i.txid === selected.txid && i.vout === selected.vout) ?? -1;
    setInputIndex(Math.max(0, input));
    setOutputIndex(transaction?.txid === selected.txid ? (selected.vout ?? 0) : 0);
    return () => request.current?.abort();
  }, [transaction, selected.id]);
  async function load() {
    if (!transaction || !canQuery || workspace.demo) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await fetchRawInspection(transaction, controller.signal);
      if (!controller.signal.aborted) setRaw(result);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Raw inspection failed.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  if (!related.length) return null;
  const outputHex =
    raw?.outputs[outputIndex]?.script ?? transaction?.vout[outputIndex]?.scriptPubKey.hex;
  const input = raw?.inputs[inputIndex];
  return (
    <details className="panel-section script-inspector">
      <summary>Scripts and raw transaction</summary>
      <div className="script-inspector-body">
        <p className="small mono" title={transaction?.txid}>
          {related.find(({ tx }) => tx.txid === transaction?.txid)?.role} transaction:{' '}
          {short(transaction?.txid ?? '', 8)}
        </p>
        {related.length > 1 && (
          <label>
            Inspect transaction
            <select
              aria-label="Script transaction"
              value={transaction?.txid}
              onChange={(e) => setChoice(e.target.value)}
            >
              {related.map(({ tx, role }) => (
                <option key={tx.txid} value={tx.txid}>
                  {role}: {short(tx.txid, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="small muted">
          Hex is exact data. ASM is a display-only decode, not script execution or validation.
        </p>
        <label>
          Output script
          <select
            aria-label="Inspect output script"
            value={outputIndex}
            onChange={(e) => setOutputIndex(Number(e.target.value))}
          >
            {transaction?.vout.map((output) => (
              <option key={output.n} value={output.n}>
                Output #{output.n} · {output.scriptPubKey.type ?? 'Unknown type'}
              </option>
            ))}
          </select>
        </label>
        <HexField title="scriptPubKey hex" value={outputHex} decode />
        {!raw && (
          <>
            <button
              type="button"
              disabled={loading || !canQuery || workspace.demo}
              onClick={() => void load()}
            >
              {loading ? 'Loading raw transaction…' : 'Load raw transaction'}
            </button>
            <p className="small muted">
              {workspace.demo
                ? 'Synthetic fixture: raw transaction and witness data are unavailable.'
                : !canQuery
                  ? 'Connect to this workspace network to load raw data.'
                  : 'Loads scriptSig, witness, version, locktime and raw hex from your node. Held only while inspecting this selection.'}
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="warning small">
            {error}
          </p>
        )}
        {raw && (
          <>
            <dl className="details">
              <div>
                <dt>Version</dt>
                <dd>{raw.version}</dd>
              </div>
              <div>
                <dt>Locktime</dt>
                <dd>{raw.locktime}</dd>
              </div>
              <div>
                <dt>Size / virtual size</dt>
                <dd>
                  {raw.size} B / {raw.vsize} vB
                </dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{raw.weight} WU</dd>
              </div>
            </dl>
            <label>
              Input script
              <select
                aria-label="Inspect input script"
                value={inputIndex}
                onChange={(e) => setInputIndex(Number(e.target.value))}
              >
                {transaction?.vin.map((i, index) => (
                  <option key={index} value={index}>
                    Input #{index}
                    {i.coinbase !== undefined ? ' · Coinbase' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="small mono">
              Sequence: {input?.sequence} (0x{input?.sequence.toString(16).padStart(8, '0')})
            </p>
            <HexField title="scriptSig hex" value={input?.script} decode />
            <details>
              <summary>Witness stack ({input?.witness.length ?? 0} items)</summary>
              <p className="small muted">
                Witness items are stack bytes, not necessarily scripts. A matching txid does not
                authenticate witness bytes against a block commitment.
              </p>
              <div className="witness-items">
                {input?.witness.slice(0, witnessLimit).map((item, index) => (
                  <HexField key={index} title={`Witness item ${index}`} value={item} />
                ))}
                {(input?.witness.length ?? 0) > witnessLimit && (
                  <button type="button" onClick={() => setWitnessLimit((limit) => limit + 20)}>
                    Show next witness items ({witnessLimit} of {input?.witness.length} shown)
                  </button>
                )}
              </div>
            </details>
            <details>
              <summary>Raw transaction hex</summary>
              <HexField title="Raw transaction hex" value={raw.hex} />
              <HexField title="Witness transaction ID" value={raw.wtxid} />
            </details>
          </>
        )}
      </div>
    </details>
  );
}
