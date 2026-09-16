import { useMemo } from 'react';
import { decodeOpReturn } from './opReturn';
import { CopyButton } from '../CopyButton';
import './op-return-data.css';

/** Use outside a row button: this provides its own keyboard-accessible disclosure. */
export function OpReturnData({ hex }: { hex?: string }) {
  const data = useMemo(() => decodeOpReturn(hex), [hex]);
  if (!data) return null;
  const preview = data.preview.replace(/^OP_RETURN(?:\s+|$)/, '') || '(empty data)';
  return (
    <details className="op-return-data">
      <summary title={data.display || 'OP_RETURN with no data'}>{preview}</summary>
      <div className="op-return-body">
        <div className="op-return-heading">
          <small className="muted">
            {data.format === 'text' ? 'UTF-8 text' : data.format === 'hex' ? 'Hex data' : 'Data'}
            {data.format !== 'unavailable' && ` · ${data.byteLength.toLocaleString()} bytes`}
            {data.pushes > 1 && ` · ${data.pushes} pushes, separated by |`}
          </small>
          {data.display && data.format !== 'unavailable' && (
            <CopyButton value={data.display} label="Copy OP_RETURN data" />
          )}
        </div>
        <pre tabIndex={0}>{data.display || '(empty data)'}</pre>
        {data.warning && <p className="small warning">{data.warning}</p>}
      </div>
    </details>
  );
}
