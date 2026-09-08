import { Expand, Layers, Sparkles } from 'lucide-react';
import type { Workspace } from '../domain/types';
export function GraphControls({
  view,
  onChange,
  onFit,
}: {
  view: Workspace['view'];
  onChange: (update: (view: Workspace['view']) => Workspace['view']) => void;
  onFit: () => void;
}) {
  return (
    <div className="graph-controls">
      <div className="view-toggle">
        <button
          className={view.dimensions === 3 ? 'active' : ''}
          onClick={() => onChange((current) => ({ ...current, dimensions: 3 }))}
        >
          3D
        </button>
        <button
          className={view.dimensions === 2 ? 'active' : ''}
          onClick={() => onChange((current) => ({ ...current, dimensions: 2 }))}
        >
          Flat
        </button>
      </div>
      <label className="size-control">
        <span>Size by</span>
        <select
          aria-label="Size nodes by"
          value={view.sizeBy}
          onChange={(e) =>
            onChange((current) => ({
              ...current,
              sizeBy: e.target.value as Workspace['view']['sizeBy'],
            }))
          }
        >
          <option value="uniform">Uniform</option>
          <option value="value">Value</option>
          <option value="degree">Connections</option>
        </select>
      </label>
      <label className="highlight-control">
        <select
          aria-label="Highlight entities"
          value={view.highlightMode ?? 'all'}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              highlightMode: event.target.value as Workspace['view']['highlightMode'],
            }))
          }
        >
          <option value="all">Wallets + tags</option>
          <option value="wallets">Wallet matches</option>
          <option value="tags">Manual tags</option>
          <option value="none">Types + findings</option>
        </select>
      </label>
      <button
        className={`icon-button ${view.glow ? 'active' : ''}`}
        title="Toggle highlight glow"
        aria-label="Toggle highlight glow"
        onClick={() => onChange((current) => ({ ...current, glow: !current.glow }))}
      >
        <Sparkles size={16} />
      </button>
      <button
        className={`icon-button ${view.showAddresses ? 'active' : ''}`}
        title="Show address nodes"
        aria-label="Show address nodes"
        onClick={() =>
          onChange((current) => ({ ...current, showAddresses: !current.showAddresses }))
        }
      >
        <Layers size={16} />
      </button>
      <button
        className="icon-button"
        title="Fit graph"
        aria-label="Fit graph"
        onClick={() => onFit()}
      >
        <Expand size={16} />
      </button>
    </div>
  );
}
