import { useState } from 'react';
import { ArrowRight, GitBranch } from 'lucide-react';
import type { Workspace } from '../domain/types';
import { formatSats, short } from '../domain/types';
import type { WalletReviewContext, WalletReviewFlowEntry } from '../domain/walletReviewContext';
import './wallet-review-flow.css';

/** A transaction's actual edges, never a claim about which input paid an output. */
export function WalletReviewFlow({
  context,
  workspace,
  walletName,
  onInspect,
}: {
  context: WalletReviewContext;
  workspace: Workspace;
  walletName: string;
  onInspect: (id: string) => void;
}) {
  if (context.status !== 'loaded')
    return (
      <div className="wallet-flow-unavailable">
        <p>The transaction is not loaded. Open it to see its inputs and outputs.</p>
        {context.transactionNodeId && (
          <button onClick={() => onInspect(context.transactionNodeId!)}>
            Load transaction details
          </button>
        )}
      </div>
    );
  return (
    <figure className="wallet-review-flow" aria-label="Wallet transaction flow">
      <figcaption>
        <span>
          <GitBranch size={13} /> Transaction flow
        </span>
        <span className="wallet-flow-legend">
          <i /> {walletName}
        </span>
      </figcaption>
      <div className="wallet-flow-columns">
        <FlowColumn
          title="Inputs"
          entries={context.inputs}
          workspace={workspace}
          onInspect={onInspect}
        />
        <div className="wallet-flow-transaction">
          <ArrowRight className="wallet-flow-arrow" size={17} aria-hidden="true" />
          <button
            onClick={() => onInspect(context.transactionNodeId!)}
            title={context.transactionId}
            aria-label={`Inspect transaction ${context.transactionId}`}
          >
            <span>Transaction</span>
            <code>{short(context.transactionId ?? '', 4)}</code>
          </button>
          <ArrowRight className="wallet-flow-arrow" size={17} aria-hidden="true" />
        </div>
        <FlowColumn
          title="Outputs"
          entries={context.outputs}
          workspace={workspace}
          onInspect={onInspect}
        />
      </div>
      {context.currentOutputs.length > 0 && (
        <div className="wallet-flow-descendants">
          <span>This receipt was spent in transactions creating these wallet outputs:</span>
          {context.currentOutputs.slice(0, 3).map((entry) => (
            <button key={entry.id} onClick={() => onInspect(entry.id)} title={entry.id}>
              <ArrowRight size={12} />{' '}
              {entry.valueSats === undefined ? short(entry.id, 6) : formatSats(entry.valueSats)}
            </button>
          ))}
          {context.currentOutputs.length > 3 && (
            <span>+{context.currentOutputs.length - 3} more</span>
          )}
        </div>
      )}
      <p className="wallet-flow-footnote">
        Select a node to inspect it.{' '}
        {context.missingPrevouts > 0
          ? `${context.missingPrevouts} previous outputs not loaded. `
          : ''}
        Only discovered wallet addresses are matched. Arrows show transaction links, not exact coin
        allocation.
      </p>
    </figure>
  );
}

function FlowColumn({
  title,
  entries,
  workspace,
  onInspect,
}: {
  title: string;
  entries: WalletReviewFlowEntry[];
  workspace: Workspace;
  onInspect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Keep the selected output visible even in a large transaction, preserving order.
  const chosen = entries.find((entry) => entry.selected);
  const summary = entries.slice(0, 2);
  if (chosen && !summary.includes(chosen)) summary[summary.length - 1] = chosen;
  const visible = expanded ? entries : summary;
  return (
    <div className="wallet-flow-column">
      <div className="wallet-flow-column-heading">
        <span>
          {title} <b>{entries.length}</b>
        </span>
        {entries.length > 2 && (
          <button
            className="text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Collapse' : `All ${entries.length}`}
          </button>
        )}
      </div>
      <div className="wallet-flow-entries">
        {visible.map((entry) => {
          const annotation = workspace.annotations[entry.id];
          const role = entry.coinbase
            ? 'Coinbase'
            : entry.ownership === 'wallet'
              ? 'Your wallet'
              : entry.ownership === 'external'
                ? 'No wallet match'
                : 'Unknown';
          return (
            <button
              className={`wallet-flow-node ownership-${entry.ownership} ${entry.selected ? 'is-selected' : ''}`}
              key={entry.id}
              disabled={entry.coinbase}
              onClick={() => onInspect(entry.id)}
              aria-label={`Inspect ${title === 'Inputs' ? 'input' : 'output'} ${entry.id.replace(/^out:/, '')}`}
              title={`${role} · ${entry.id}${entry.address ? ` · ${entry.address}` : ''}`}
            >
              <span className="wallet-flow-role">
                {role}
                {entry.selected ? ' · Selected' : ''}
              </span>
              <strong>
                {annotation?.icon && <span aria-hidden="true">{annotation.icon} </span>}
                {annotation?.label ||
                  (entry.address
                    ? short(entry.address, 6)
                    : entry.coinbase
                      ? 'Newly mined coins'
                      : short(entry.id.replace(/^out:/, ''), 6))}
              </strong>
              <span>
                {entry.valueSats === undefined ? 'Value not loaded' : formatSats(entry.valueSats)}
              </span>
            </button>
          );
        })}
        {entries.length === 0 && <span className="small muted">No {title.toLowerCase()}</span>}
      </div>
    </div>
  );
}
