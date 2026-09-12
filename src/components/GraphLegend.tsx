import type { GraphFlowContext } from './graph/flowContext';
import { ResponsiveIdentifier } from './ResponsiveIdentifier';

export function GraphLegend({
  dimensions,
  showAddresses,
  demo,
  flowContext,
}: {
  dimensions: 2 | 3;
  showAddresses: boolean;
  demo: boolean;
  flowContext?: GraphFlowContext;
}) {
  return (
    <>
      {demo && (
        <div className="demo-badge">
          LEGACY <span>Synthetic data · live lookups disabled</span>
        </div>
      )}
      <div className="graph-legend">
        {flowContext && (
          <span
            className="graph-flow-context"
            title={`Flow through ${flowContext.transactionId.slice(3)}`}
          >
            Flow · <ResponsiveIdentifier value={flowContext.transactionId.slice(3)} />
          </span>
        )}
        <span>
          <i className="entity-dot transaction" />
          Transaction
        </span>
        <span>
          <i className="entity-dot output" />
          {flowContext ? 'Other outputs' : 'Output'}
        </span>
        {flowContext && (
          <>
            <span>
              <i className="graph-flow-key input" />
              Inputs
            </span>
            <span>
              <i className="graph-flow-key output" />
              Outputs
            </span>
          </>
        )}
        {showAddresses && (
          <span>
            <i className="entity-dot address" />
            Address
          </span>
        )}
        <span className="graph-help">
          {dimensions === 3 ? 'Drag to orbit · scroll to zoom' : 'Drag to pan · scroll to zoom'}
        </span>
      </div>
    </>
  );
}
