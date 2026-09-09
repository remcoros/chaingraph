import { useEffect, useRef, useState } from 'react';
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

/** Transient Electrum observations for one wallet. They never enter storage and
 * are discarded when its discovered addresses or scan time change.
 */
export function useWalletUtxos({
  workspace,
  wallet,
  enabled,
}: {
  workspace: Workspace;
  wallet: Wallet;
  enabled: boolean;
}) {
  const [utxos, setUtxos] = useState<WalletUtxoView>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  const attempted = useRef(false);
  const view = useRef<WalletUtxoView | undefined>(undefined);
  view.current = utxos;

  async function check(cursor = 0) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    attempted.current = true;
    setLoading(true);
    setError('');
    if (cursor === 0) setUtxos(undefined);
    try {
      const batch = await fetchWalletUtxos(workspace.network, wallet, {
        cursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const previous = cursor ? (view.current?.records ?? []) : [];
      const records = new Map(previous.map((record) => [`${record.txid}:${record.vout}`, record]));
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
      setUtxos({
        records: [...records.values()],
        checkedAt: batch.checkedAt,
        checkedAddresses: batch.checkedAddresses,
        totalAddresses: batch.totalAddresses,
        nextCursor: batch.nextCursor,
        failed: (cursor ? (view.current?.failed ?? 0) : 0) + batch.errors.length,
      });
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'Could not check wallet UTXOs.');
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    request.current?.abort();
    setUtxos(undefined);
    setLoading(false);
    setError('');
    attempted.current = false;
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [wallet.addresses, wallet.scannedAt]);

  useEffect(() => {
    if (enabled && !attempted.current) void check();
    // Leaving cancels in-flight requests, while completed observations stay available.
    return () => {
      if (request.current) {
        request.current.abort();
        request.current = undefined;
        attempted.current = false;
        setLoading(false);
      }
    };
  }, [enabled, wallet.addresses, wallet.scannedAt]);

  return { utxos, loading, error, check };
}
