import { useState, type FormEvent, type RefObject } from 'react';
import { Search, Plus } from 'lucide-react';
import { addressToScriptHash, type Network } from '../../../../../Core/Bitcoin';

export interface GraphLookupFormProps {
  /** Owned by the parent so existing keyboard shortcuts can still focus the field. */
  inputRef: RefObject<HTMLInputElement | null>;
  network: Network;
  canLoadChainData: boolean;
  busy: boolean;
  /** Bumped by the parent to clear the field after a successful lookup or a workspace switch. */
  resetToken: number;
  queryError: string;
  onQueryError: (message: string) => void;
  /** Resolves text that is already present in the workspace, so offline lookups stay enabled. */
  resolveLoaded: (text: string) => string | undefined;
  onSubmit: (text: string) => void | Promise<void>;
}

/**
 * Owns the lookup text so that typing re-renders only this form.
 *
 * The field used to live directly in `App`, whose render output is the entire
 * workbench. Every keystroke re-rendered the graph, inspector, workbenches and
 * every dialog.
 */
export function GraphLookupForm({
  inputRef,
  network,
  canLoadChainData,
  busy,
  resetToken,
  queryError,
  onQueryError,
  resolveLoaded,
  onSubmit,
}: GraphLookupFormProps) {
  const [query, setQuery] = useState('');
  // Clearing on a parent signal, adjusted during render rather than in an
  // effect, so there is no extra render pass or intermediate paint.
  const [seenReset, setSeenReset] = useState(resetToken);
  if (seenReset !== resetToken) {
    setSeenReset(resetToken);
    setQuery('');
  }

  const trimmed = query.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    if (!/^[0-9a-f]{64}(:\d+)?$/i.test(trimmed)) {
      try {
        addressToScriptHash(trimmed, network);
      } catch {
        onQueryError(
          `Enter a 64-character transaction ID, txid:vout, or a valid ${network} Bitcoin address.`,
        );
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
    }
    onQueryError('');
    await onSubmit(trimmed);
  };

  return (
    <form className="search-form" onSubmit={submit}>
      <Search size={17} />
      <input
        ref={inputRef}
        aria-label="Transaction, output, or address"
        placeholder="Transaction ID, txid:vout, or Bitcoin address"
        value={query}
        aria-invalid={!!queryError}
        aria-describedby={queryError ? 'lookup-error' : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          if (queryError) onQueryError('');
        }}
        spellCheck={false}
      />
      <button
        type="submit"
        className="search-go"
        aria-label="Add to graph"
        disabled={(!canLoadChainData && !resolveLoaded(trimmed)) || busy || !trimmed}
      >
        <span>Add to graph</span> <Plus size={14} />
      </button>
    </form>
  );
}
