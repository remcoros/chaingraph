import { useCallback, useMemo, useRef, useState } from 'react';
import {
  addressReference,
  outpointReference,
  transactionReference,
} from '../../../../../Core/Workspace/entityReferences';
import { outputAddress } from '../../../../../Core/Bitcoin';
import type { AppState } from '../../../../useAppState';

export interface GraphLookupState {
  /** The lookup field, so shortcuts and the toolbar can reach the same input. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /**
   * Bumped to clear the field. The text itself stays in the form, so typing does
   * not re-render the workbench.
   */
  resetToken: number;
  error: string;
  setError: (message: string) => void;
  clear: () => void;
  focus: () => void;
  /** The node id for this text when it is already loaded, otherwise undefined. */
  resolveLoaded: (text: string) => string | undefined;
}

export function useGraphLookupState(
  activeWorkspace: AppState['activeWorkspace'],
): GraphLookupState {
  const inputRef = useRef<HTMLInputElement>(null);
  // Stable so global shortcut listeners register once.
  const focus = useCallback(() => inputRef.current?.focus(), []);
  const [resetToken, setResetToken] = useState(0);
  const [error, setError] = useState('');
  const transactions = activeWorkspace?.chainData.transactions;
  const watchedAddresses = activeWorkspace?.chainData.watchedAddresses;
  const inputContext = activeWorkspace?.view.inputContext;
  const loadedIds = useMemo(() => {
    const ids = new Set((watchedAddresses ?? []).map(addressReference));
    for (const transaction of Object.values(transactions ?? {})) {
      ids.add(transactionReference(transaction.txid));
      for (const output of transaction.vout) {
        ids.add(outpointReference(transaction.txid, output.n));
        const address = outputAddress(output);
        if (address) ids.add(addressReference(address));
      }
      for (const input of transaction.vin) {
        if (!input.txid || input.vout === undefined) continue;
        if (!inputContext?.[transaction.txid]) ids.add(outpointReference(input.txid, input.vout));
        const address = input.prevout && outputAddress({ ...input.prevout, n: input.vout });
        if (address) ids.add(addressReference(address));
      }
    }
    return ids;
  }, [transactions, watchedAddresses, inputContext]);
  return {
    inputRef,
    resetToken,
    error,
    setError,
    clear: () => setResetToken((token) => token + 1),
    focus,
    resolveLoaded: (text) => {
      const match = /^([0-9a-f]{64})(?::(\d+))?$/i.exec(text);
      const id = match
        ? match[2] === undefined
          ? transactionReference(match[1].toLowerCase())
          : outpointReference(match[1].toLowerCase(), Number(match[2]))
        : addressReference(/^(bc1|tb1)/i.test(text) ? text.toLowerCase() : text);
      return loadedIds.has(id) ? id : undefined;
    },
  };
}
