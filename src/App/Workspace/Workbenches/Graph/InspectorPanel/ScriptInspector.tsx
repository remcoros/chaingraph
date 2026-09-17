import { TransactionBlockTime } from '../../../../Controls/Display/TransactionBlockTime';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../../GraphState/types';
import type { Transaction } from '../../../../../Core/ChainData';
import type { Workspace } from '../../../../../Core/Workspace/workspace';
import { short } from '../../../../../Core/Formatting';
import { inspectScript } from '../../../../../Core/Bitcoin';
import {
  type RawInspection,
  fetchRawInspection,
} from '../../../../../Core/ChainData/rawTransactionInspection';
import { relatedTransactions } from '../../../Selection/relatedTransactions';
import { CopyButton } from '../../../../Controls/CopyButton';
import { OpReturnData } from '../../../../Controls/Display/OpReturnData';
import { ResponsiveIdentifier } from '../../../../Controls/Display/ResponsiveIdentifier';
import './script-inspector.css';

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

interface ScriptInspectorProps {
  workspace: Workspace;
  selected: GraphNode;
  canLoadChainData: boolean;
  loadedSpends: ReadonlyMap<string, readonly Transaction[]>;
}

export function ScriptInspector(props: ScriptInspectorProps) {
  const { workspace, selected, loadedSpends } = props;
  const [open, setOpen] = useState(false);
  const related = useMemo(
    () => relatedTransactions(workspace.chainData.transactions, selected, loadedSpends),
    [workspace.chainData.transactions, selected, loadedSpends],
  );
  if (!related.length) return null;
  return (
    <details
      className="panel-section script-inspector"
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary>Scripts and raw transaction</summary>
      {open && <ScriptInspectorBody key={selected.id} {...props} related={related} />}
    </details>
  );
}

function ScriptInspectorBody({
  workspace,
  selected,
  canLoadChainData,
  related,
}: ScriptInspectorProps & {
  related: ReturnType<typeof relatedTransactions>;
}) {
  const [choice, setChoice] = useState('');
  const transaction = related.find(({ tx }) => tx.txid === choice)?.tx ?? related[0]?.tx;
  const [raw, setRaw] = useState<RawInspection>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputIndex, setInputIndex] = useState(0);
  const [outputIndex, setOutputIndex] = useState(0);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    request.current?.abort();
    // oxlint-disable-next-line react/set-state-in-effect -- Aborts the previous request and starts another; the reset belongs with that.
    setRaw(undefined);
    setError('');
    setLoading(false);
    const input =
      transaction?.vin.findIndex((i) => i.txid === selected.txid && i.vout === selected.vout) ?? -1;
    setInputIndex(Math.max(0, input));
    setOutputIndex(transaction?.txid === selected.txid ? (selected.vout ?? 0) : 0);
    return () => request.current?.abort();
  }, [workspace.id, workspace.network, transaction, selected.id, selected.txid, selected.vout]);
  async function load() {
    if (!transaction || !canLoadChainData || workspace.demo) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await fetchRawInspection(workspace.network, transaction, controller.signal);
      if (!controller.signal.aborted) setRaw(result);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(failure instanceof Error ? failure.message : 'Raw inspection failed.');
    }
    if (!controller.signal.aborted) setLoading(false);
  }
  if (!related.length) return null;
  const outputHex =
    raw?.outputs[outputIndex]?.script ?? transaction?.vout[outputIndex]?.scriptPubKey.hex;
  const input = raw?.inputs[inputIndex];
  return (
    <div className="script-inspector-body">
      <p className="small mono" title={transaction?.txid}>
        {related.find(({ tx }) => tx.txid === transaction?.txid)?.role} transaction:{' '}
        <ResponsiveIdentifier value={transaction?.txid ?? ''} />
      </p>
      <TransactionBlockTime
        transaction={transaction}
        workspace={workspace}
        showFee={selected.kind === 'transaction'}
      />
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
                {role}: {short(tx.txid)}
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
      <OpReturnData hex={outputHex} />
      {!raw && (
        <>
          <div className="compact-controls">
            <button
              type="button"
              disabled={loading || !canLoadChainData || workspace.demo}
              onClick={() => void load()}
            >
              <Download size={14} />
              {loading ? 'Loading raw transaction…' : 'Load raw transaction'}
            </button>
          </div>
          <p className="small muted">
            {workspace.demo
              ? 'Legacy synthetic data: raw transaction and witness data are unavailable.'
              : !canLoadChainData
                ? 'Connect to this workspace network to load raw data.'
                : 'Loads scriptSig, witness, version, locktime and raw hex.'}
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
          <WitnessStack key={(transaction?.txid ?? '') + ':' + inputIndex} input={input} />
          <details>
            <summary>Raw transaction hex</summary>
            <HexField title="Raw transaction hex" value={raw.hex} />
            <HexField title="Witness transaction ID" value={raw.wtxid} />
          </details>
        </>
      )}
    </div>
  );
}

function WitnessStack({ input }: { input?: RawInspection['inputs'][number] }) {
  const [limit, setLimit] = useState(20);
  return (
    <details>
      <summary>Witness stack ({input?.witness.length ?? 0} items)</summary>
      <p className="small muted">
        Witness items are stack bytes, not necessarily scripts. A matching txid does not
        authenticate witness bytes against a block commitment.
      </p>
      <div className="witness-items">
        {input?.witness.slice(0, limit).map((item, index) => (
          <HexField key={index} title={`Witness item ${index}`} value={item} />
        ))}
        {(input?.witness.length ?? 0) > limit && (
          <button type="button" onClick={() => setLimit((value) => value + 20)}>
            Show next witness items ({limit} of {input?.witness.length} shown)
          </button>
        )}
      </div>
    </details>
  );
}
