import { useMemo, useState, useRef, useLayoutEffect, type ReactNode } from 'react';
import { Pencil, ArrowRight } from 'lucide-react';
import {
  type GraphNode,
  type Transaction,
  type Workspace,
  outputNodeId,
  txNodeId,
  short,
  sats,
  formatSats,
} from '../domain/types';
import { relatedTransactions } from '../domain/transactionInspection';
import { outputAddress } from '../domain/workspace';
import { CopyButton } from './CopyButton';
import './transaction-view.css';

interface Props {
  workspace: Workspace;
  selected?: GraphNode;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onTrace: (direction: 'funding' | 'spending', id: string) => void;
  disabledReason?: string;
  renderMetadata?: (nodeId: string) => ReactNode;
}

function TransactionRows({
  tx,
  workspace,
  selected,
  onSelect,
  onEdit,
  renderMetadata,
}: Props & { tx: Transaction }) {
  const selectedRow = useRef<HTMLDivElement>(null);
  const [expandedInputs, setExpandedInputs] = useState(false);
  const [expandedOutputs, setExpandedOutputs] = useState(false);
  useLayoutEffect(() => {
    const row = selectedRow.current;
    const panel = row?.closest<HTMLDetailsElement>('.transaction-view');
    if (!row || !panel) return;
    let followSelection = true;
    let frame = 0;
    const visibleBounds = () => {
      if (!panel.open || !panel.getClientRects().length) return;
      const bounds = panel.getBoundingClientRect();
      const heading = panel.querySelector(':scope > summary')?.getBoundingClientRect();
      return {
        top: (heading?.bottom ?? bounds.top) + 4,
        bottom: bounds.bottom - 8,
        row: row.getBoundingClientRect(),
      };
    };
    const keepVisible = () => {
      const bounds = visibleBounds();
      if (!bounds || !followSelection) return;
      const delta =
        bounds.row.height > bounds.bottom - bounds.top || bounds.row.top < bounds.top
          ? bounds.row.top - bounds.top
          : Math.max(0, bounds.row.bottom - bounds.bottom);
      // Scroll this panel only. scrollIntoView can also move outer page containers.
      panel.scrollTop += delta;
    };
    const rememberScroll = () => {
      const bounds = visibleBounds();
      if (!bounds) return;
      // Browsing away from the selection is intentional. Geometry changes must
      // not pull the user back. Scrolling the selection into view resumes following.
      followSelection =
        bounds.row.top >= bounds.top - 1 &&
        (bounds.row.bottom <= bounds.bottom + 1 ||
          (bounds.row.height > bounds.bottom - bounds.top && bounds.row.top <= bounds.top + 1));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(keepVisible);
    };
    keepVisible();
    panel.addEventListener('scroll', rememberScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(row);
    observer.observe(panel);
    const body = panel.querySelector('.transaction-view-body');
    if (body) observer.observe(body);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      panel.removeEventListener('scroll', rememberScroll);
    };
  }, [selected?.id, expandedInputs, expandedOutputs]);
  const inputRows = tx.vin.map((input, index) => {
    const id = input.txid !== undefined ? outputNodeId(input.txid, input.vout!) : undefined;
    const previous = input.txid ? workspace.transactions[input.txid]?.vout[input.vout!] : undefined;
    return {
      id,
      index,
      address: previous ? outputAddress(previous) : undefined,
      value: previous ? sats(previous.value) : undefined,
      coinbase: input.coinbase !== undefined,
      missing: !previous,
    };
  });
  const outputRows = tx.vout.map((output) => ({
    id: outputNodeId(tx.txid, output.n),
    index: output.n,
    address: outputAddress(output),
    value: sats(output.value),
    coinbase: false,
    missing: false,
  }));
  const columns = [
    { name: 'Inputs', rows: inputRows, expanded: expandedInputs, toggle: setExpandedInputs },
    { name: 'Outputs', rows: outputRows, expanded: expandedOutputs, toggle: setExpandedOutputs },
  ];
  return (
    <div className="transaction-columns">
      {columns.map(({ name, rows, expanded, toggle }) => {
        const matches = (row: (typeof rows)[number]) =>
          row.id === selected?.id ||
          (selected?.kind === 'address' && !!row.address && row.address === selected.address);
        // Keep a selected row visible even when it lies beyond the initial collapsed window.
        const shown = expanded ? rows : rows.filter((row, index) => index < 4 || matches(row));
        return (
          <section key={name} aria-label={`${name} of displayed transaction`}>
            <h4>
              {rows.length} {name.toLowerCase()}
            </h4>
            <div className="transaction-rows">
              {shown.map((row) => (
                <div
                  key={row.index}
                  className={`transaction-row ${matches(row) ? 'is-selected' : ''}`}
                  data-selected={matches(row)}
                  ref={matches(row) ? selectedRow : undefined}
                >
                  <button
                    type="button"
                    className="transaction-row-select"
                    disabled={!row.id}
                    aria-label={`${name === 'Inputs' ? 'Input' : 'Output'} ${row.index}${row.id ? `: ${row.id.slice(4)}` : ': Coinbase'}`}
                    aria-pressed={matches(row)}
                    title={row.id?.slice(4)}
                    onClick={() => row.id && onSelect(row.id)}
                  >
                    <span className="transaction-row-index">#{row.index}</span>
                    <span className="transaction-row-main">
                      <strong>
                        {row.coinbase
                          ? 'Coinbase'
                          : workspace.annotations[row.id!]?.label ||
                            (row.address
                              ? short(row.address, 8)
                              : row.missing
                                ? 'Previous output not loaded'
                                : 'Non-address output')}
                      </strong>
                      <span>{row.coinbase ? 'Newly created coins' : formatSats(row.value)}</span>
                      {row.id && <small className="mono">{short(row.id.slice(4), 6)}</small>}
                      {row.id && renderMetadata?.(row.id)}
                    </span>
                  </button>
                  {row.id && (
                    <button
                      type="button"
                      className="icon-button transaction-row-edit"
                      aria-label={`Edit ${name === 'Inputs' ? 'input' : 'output'} ${row.index} annotation`}
                      onClick={() => onEdit(row.id!)}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {rows.length > 4 && (
              <button
                type="button"
                className="text-button transaction-expand"
                aria-expanded={expanded}
                onClick={() => toggle(!expanded)}
              >
                {expanded
                  ? `Collapse ${name.toLowerCase()}`
                  : `Show all ${rows.length} ${name.toLowerCase()}`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function TransactionView(props: Props) {
  const { workspace, selected, onSelect, onTrace, disabledReason } = props;
  const related = useMemo(
    () => (selected ? relatedTransactions(workspace.transactions, selected) : []),
    [workspace.transactions, selected?.id],
  );
  const [choice, setChoice] = useState('');
  const current = related.find(({ tx }) => tx.txid === choice) ?? related[0];
  if (!selected || (selected.kind === 'address' && !related.length)) return null;
  const missingCreating =
    selected.kind === 'output' && !workspace.transactions[selected.txid ?? ''];
  return (
    <details className="transaction-view" open>
      <summary>
        <span>Transaction inputs &amp; outputs</span>
        <small>
          {current ? `${current.tx.vin.length} in / ${current.tx.vout.length} out` : 'Not loaded'}
        </small>
      </summary>
      <div className="transaction-view-body">
        {related.length > 1 && (
          <label className="transaction-choice">
            Transaction
            <select
              aria-label="Displayed transaction"
              value={current?.tx.txid}
              onChange={(e) => setChoice(e.target.value)}
            >
              {related.map(({ tx, role }) => (
                <option key={tx.txid} value={tx.txid}>
                  {role}:{' '}
                  {workspace.annotations[txNodeId(tx.txid)]?.label
                    ? `${workspace.annotations[txNodeId(tx.txid)].label} · `
                    : ''}
                  {short(tx.txid, 8)}
                </option>
              ))}
            </select>
          </label>
        )}
        {missingCreating && (
          <p className="small">
            Creating transaction not loaded.{' '}
            <button
              type="button"
              className="text-button"
              disabled={!!disabledReason}
              title={disabledReason}
              onClick={() => onTrace('funding', selected.id)}
            >
              Load creating transaction
            </button>
          </p>
        )}
        {current && (
          <>
            <div className="transaction-view-identity">
              {(workspace.annotations[txNodeId(current.tx.txid)]?.label ||
                props.renderMetadata) && (
                <div className="transaction-view-metadata">
                  {workspace.annotations[txNodeId(current.tx.txid)]?.label && (
                    <strong>{workspace.annotations[txNodeId(current.tx.txid)].label}</strong>
                  )}
                  {props.renderMetadata?.(txNodeId(current.tx.txid))}
                </div>
              )}
              <button
                type="button"
                className="text-button mono"
                title={current.tx.txid}
                onClick={() => onSelect(txNodeId(current.tx.txid))}
              >
                {current.role} transaction {short(current.tx.txid, 7)} <ArrowRight size={12} />
              </button>
              <CopyButton value={current.tx.txid} label="Copy displayed transaction ID" />
            </div>
            <TransactionRows
              {...props}
              onSelect={(id) => {
                setChoice(current.tx.txid);
                onSelect(id);
              }}
              tx={current.tx}
              key={current.tx.txid}
            />
          </>
        )}
        <div className="transaction-view-actions">
          {current?.tx.vin.some((i) => i.txid && !workspace.transactions[i.txid]) && (
            <button
              type="button"
              disabled={!!disabledReason}
              title={disabledReason}
              onClick={() => onTrace('funding', txNodeId(current.tx.txid))}
            >
              Load previous outputs (1 level)
            </button>
          )}
          {selected.kind === 'output' && !missingCreating && (
            <button
              type="button"
              disabled={!!disabledReason}
              title={disabledReason}
              onClick={() => onTrace('spending', selected.id)}
            >
              Check this output for spends
            </button>
          )}
        </div>
        {selected.kind === 'output' && (
          <p className="small muted transaction-coverage">
            {related.filter((r) => r.role === 'Spending').length} spending transactions loaded.
            Absence here does not establish that an output is unspent.
          </p>
        )}
      </div>
    </details>
  );
}
