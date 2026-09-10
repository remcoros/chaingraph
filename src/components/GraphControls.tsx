import { SmallAmountControl } from './SmallAmountControl';
import { Layers, Maximize2, Minimize2, Smile, Sparkles, Tags, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Workspace } from '../domain/types';
export function GraphControls({
  view,
  onChange,
  focusGraph,
  onToggleFocus,
  smallAmountHiddenCount,
  motionToggle,
}: {
  view: Workspace['view'];
  motionToggle?: ReactNode;
  onChange: (update: (view: Workspace['view']) => Workspace['view']) => void;
  smallAmountHiddenCount?: number;
  focusGraph?: boolean;
  onToggleFocus?: () => void;
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
      {onToggleFocus && (
        <button
          className={`icon-button graph-focus-toggle ${focusGraph ? 'active' : ''}`}
          aria-label={focusGraph ? 'Show panels' : 'Hide panels'}
          title={
            focusGraph ? 'Show the side panels' : 'Hide side panels to give the graph more room'
          }
          aria-pressed={Boolean(focusGraph)}
          onClick={onToggleFocus}
        >
          {focusGraph ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          <span>{focusGraph ? 'Show panels' : 'Hide panels'}</span>
        </button>
      )}
      <span className="size-control">
        <span>Size by</span>
        <select
          aria-label="Size nodes by"
          title="Value uses a gentle logarithmic scale. Sizes stay stable when filtering; perspective also affects apparent size."
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
      </span>
      <SmallAmountControl
        context="graph"
        threshold={view.smallAmountThreshold}
        hiddenCount={smallAmountHiddenCount}
        onChange={(smallAmountThreshold) =>
          onChange((current) => ({ ...current, smallAmountThreshold }))
        }
      />
      <span className="highlight-control">
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
      </span>
      <div className="graph-annotation-toggles" role="group" aria-label="Graph display">
        {motionToggle}
        {(
          [
            ['showLabels', 'Show labels', Type],
            ['showTags', 'Show tags', Tags],
            ['showIcons', 'Show icons', Smile],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            className={`icon-button ${view[key] !== false ? 'active' : ''}`}
            aria-label={label}
            title={label}
            aria-pressed={view[key] !== false}
            onClick={() => onChange((current) => ({ ...current, [key]: current[key] === false }))}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
      <button
        className={`icon-button ${view.glow ? 'active' : ''}`}
        aria-pressed={view.glow}
        title="Toggle highlight glow"
        aria-label="Toggle highlight glow"
        onClick={() => onChange((current) => ({ ...current, glow: !current.glow }))}
      >
        <Sparkles size={16} />
      </button>
      <button
        className={`icon-button ${view.showAddresses ? 'active' : ''}`}
        aria-pressed={view.showAddresses}
        title="Show address nodes added to this graph"
        aria-label="Show added address nodes"
        onClick={() =>
          onChange((current) => ({ ...current, showAddresses: !current.showAddresses }))
        }
      >
        <Layers size={16} />
      </button>
    </div>
  );
}
