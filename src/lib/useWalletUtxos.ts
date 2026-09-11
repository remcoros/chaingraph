import { useEffect, useMemo, useRef, useState } from 'react';
import type { Wallet, Workspace } from '../domain/types';
import type { WalletUtxoRecord } from '../domain/walletRecords';
import { fetchWalletUtxos } from './walletUtxos';

export interface WalletUtxoView {
  records: WalletUtxoRecord[];
  checkedAt: string;
  checkedAddresses: number;
  totalAddresses: number;
  nextCursor?: number;
  failed: number;
}

export interface WalletUtxoController {
  utxos?: WalletUtxoView;
  loading: boolean;
  error: string;
  check: (cursor?: number) => Promise<void>;
}

async function runWalletUtxoRequest({
  workspace,
  wallet,
  scope,
  cursor,
  controller,
  previous,
  request,
  isCurrent,
  setState,
}: {
  workspace: Workspace;
  wallet: Wallet;
  scope: object;
  cursor: number;
  controller: AbortController;
  previous?: WalletUtxoView;
  request: { current: AbortController | undefined };
  isCurrent: () => boolean;
  setState: (state: {
    scope: object;
    utxos?: WalletUtxoView;
    loading: boolean;
    error: string;
  }) => void;
}) {
  try {
    const batch = await fetchWalletUtxos(workspace.network, wallet, {
      cursor,
      signal: controller.signal,
    });
    if (!isCurrent()) return;
    const records = new Map(
      (previous?.records ?? []).map((record) => [`${record.txid}:${record.vout}`, record]),
    );
    for (const record of batch.records) {
      const key = `${record.txid}:${record.vout}`;
      const existing = records.get(key);
      if (
        existing &&
        (existing.scripthash !== record.scripthash ||
          existing.valueSats !== record.valueSats ||
          existing.height !== record.height)
      )
        throw new Error('Conflicting UTXO observations. Refresh to restart the check.');
      records.set(key, record);
    }
    if (records.size > 50_000)
      throw new Error('The UTXO result limit was reached. Previous results remain available.');
    setState({
      scope,
      loading: false,
      error: '',
      utxos: {
        records: [...records.values()],
        // Continuations must not make earlier observations appear more recent.
        checkedAt: previous?.checkedAt ?? batch.checkedAt,
        checkedAddresses: batch.checkedAddresses,
        totalAddresses: batch.totalAddresses,
        nextCursor: batch.nextCursor,
        failed: (previous?.failed ?? 0) + batch.errors.length,
      },
    });
  } catch (cause) {
    if (isCurrent())
      setState({
        scope,
        utxos: previous,
        loading: false,
        error: cause instanceof Error ? cause.message : 'Could not check wallet UTXOs.',
      });
  } finally {
    if (request.current === controller) request.current = undefined;
  }
}

/** Transient observations shared by workbenches, scoped to one unlocked wallet.
 * Completed checks survive navigation, but never a wallet, workspace or scan change.
 */
export function useWalletUtxos({
  workspace,
  wallet,
  enabled,
}: {
  workspace?: Workspace;
  wallet?: Wallet;
  enabled: boolean;
}): WalletUtxoController {
  const scope = useMemo(
    () => ({}),
    [workspace?.id, workspace?.network, wallet?.id, wallet?.addresses, wallet?.scannedAt],
  );
  const activeScope = useRef(scope);
  const [state, setState] = useState<{
    scope: object;
    utxos?: WalletUtxoView;
    loading: boolean;
    error: string;
  }>({ scope, loading: false, error: '' });
  // Gate during render, before effect cleanup, so a new wallet never sees old evidence.
  const current =
    state.scope === scope ? state : { scope, utxos: undefined, loading: false, error: '' };
  const request = useRef<AbortController | undefined>(undefined);
  const attempted = useRef(false);
  const view = useRef<WalletUtxoView | undefined>(undefined);
  useEffect(() => {
    activeScope.current = scope;
    view.current = current.utxos;
  });

  async function check(cursor = 0) {
    if (!workspace || !wallet || !enabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    attempted.current = true;
    const previous = cursor ? view.current : undefined;
    setState({ scope, utxos: previous, loading: true, error: '' });
    const isCurrent = () =>
      !controller.signal.aborted && activeScope.current === scope && request.current === controller;
    await runWalletUtxoRequest({
      workspace,
      wallet,
      scope,
      cursor,
      controller,
      previous,
      request,
      isCurrent,
      setState,
    });
  }

  useEffect(() => {
    request.current?.abort();
    request.current = undefined;
    setState({ scope, loading: false, error: '' });
    attempted.current = false;
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [scope]);

  useEffect(() => {
    if (enabled && !attempted.current) void check();
    return () => {
      if (request.current) {
        request.current.abort();
        request.current = undefined;
        attempted.current = false;
        setState((value) => ({ ...value, loading: false }));
      }
    };
  }, [enabled, scope]);

  return { utxos: current.utxos, loading: current.loading, error: current.error, check };
}
