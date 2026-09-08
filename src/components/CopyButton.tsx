import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'ready' | 'copied' | 'failed'>('ready');
  useEffect(() => {
    if (state === 'ready') return;
    const timer = setTimeout(() => setState('ready'), 3000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <span className="copy-control">
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        title={state === 'copied' ? 'Copied' : label}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setState('copied'))
            .catch(() => setState('failed'));
          if (!navigator.clipboard) setState('failed');
        }}
      >
        {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <span className="copy-feedback" role="status">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select the text to copy' : ''}
      </span>
    </span>
  );
}
