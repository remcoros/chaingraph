export function GraphLegend({
  dimensions,
  showAddresses,
  demo,
}: {
  dimensions: 2 | 3;
  showAddresses: boolean;
  demo: boolean;
}) {
  return (
    <>
      {demo && (
        <div className="demo-badge">
          LEGACY <span>Synthetic data · live lookups disabled</span>
        </div>
      )}
      <div className="graph-legend">
        <span>
          <i className="entity-dot transaction" />
          Transaction
        </span>
        <span>
          <i className="entity-dot output" />
          Output
        </span>
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
