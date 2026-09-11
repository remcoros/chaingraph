import { useEffect, useRef, useState } from 'react';
import type { Network, TxOutput } from '../domain/types';
import { fetchCurrentUtxo, type UtxoObservation } from './utxoStatus';

interface CheckState {
  key: string;
  loading?: boolean;
  observation?: UtxoObservation;
  error?: string;
}

/** Ephemeral selection-owned request; late results cannot annotate another workspace/output. */
export function useUtxoStatus(
  workspaceId: string,
  network: Network,
  txid?: string,
  vout?: number,
  expected?: TxOutput,
) {
  const key = `${workspaceId}:${network}:${txid}:${vout}:${expected?.value}:${expected?.scriptPubKey.hex}`;
  const activeKey = useRef(key);
  const request = useRef<AbortController | undefined>(undefined);
  const [state, setState] = useState<CheckState>({ key });
  useEffect(() => {
    activeKey.current = key;
  });
  useEffect(() => {
    request.current?.abort();
    request.current = undefined;
    setState({ key });
    return () => request.current?.abort();
  }, [key]);
  const check = async (): Promise<CheckState | undefined> => {
    if (!txid || vout === undefined) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((current) => ({
      key,
      loading: true,
      observation: current.key === key ? current.observation : undefined,
    }));
    try {
      const observation = await fetchCurrentUtxo(
        network,
        txid,
        vout,
        expected,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      );
      if (
        !controller.signal.aborted &&
        activeKey.current === key &&
        request.current === controller
      ) {
        const result = { key, observation };
        setState(result);
        return result;
      }
    } catch {
      if (
        !controller.signal.aborted &&
        activeKey.current === key &&
        request.current === controller
      ) {
        const result = { key, error: 'Could not verify this output with the node. Try again.' };
        setState((current) => ({
          ...result,
          observation: current.key === key ? current.observation : undefined,
        }));
        return result;
      }
    }
  };
  return { ...(state.key === key ? state : { key }), check };
}
