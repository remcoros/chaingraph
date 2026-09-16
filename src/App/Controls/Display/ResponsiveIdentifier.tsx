import { short } from './referenceFormat';
import './responsive-identifier.css';

function flexibleIdentifier(value: string) {
  const reference = value.replace(/^(?:tx|out|addr):/, '');
  const outpoint = /^([0-9a-f]{64}):(\d+)$/i.exec(reference);
  const identifier = outpoint?.[1] ?? reference;
  return {
    leading: identifier.slice(0, -8),
    trailing: identifier.slice(-8),
    outputIndex: outpoint?.[2],
  };
}

export function ResponsiveIdentifier({
  value,
  preferFull = false,
}: {
  value: string;
  preferFull?: boolean;
}) {
  const flexible = flexibleIdentifier(value);
  return (
    <span
      className={`responsive-identifier ${preferFull ? 'responsive-identifier-prefer-full' : ''}`}
    >
      <span className="responsive-identifier-short">{short(value)}</span>
      {preferFull && (
        <span className="responsive-identifier-full">
          <span className="responsive-identifier-leading">{flexible.leading}</span>
          {flexible.leading && <span className="responsive-identifier-separator">...</span>}
          <span className="responsive-identifier-trailing">{flexible.trailing}</span>
          {flexible.outputIndex !== undefined && (
            <span className="responsive-identifier-output-index">:{flexible.outputIndex}</span>
          )}
        </span>
      )}
    </span>
  );
}
