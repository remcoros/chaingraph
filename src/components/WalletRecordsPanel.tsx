import { TransactionBlockTime } from './TransactionBlockTime';
import { formatGmtTimestamp, walletRecordBlockObservation } from '../domain/transactionTime';
import { WalletAddressesPanel } from './WalletAddressesPanel';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw } from 'lucide-react';
import {
  formatSats,
  outputNodeId,
  short,
  txNodeId,
  type Wallet,
  type Workspace,
} from '../domain/types';
import {
  listWalletTransactions,
  verifyWalletUtxo,
  type WalletUtxoRecord,
} from '../domain/walletRecords';
import type { WalletUtxoController } from '../lib/useWalletUtxos';
import './wallet-records.css';

export type WalletRecordsTab = 'addresses' | 'transactions' | 'utxos';
const PAGE_SIZE = 40;

/** Wallet context survives entity selection; transient UTXO observations never enter storage. */
export function WalletRecordsPanel({
  workspace,
  wallet,
  walletUtxos,
  active,
  canQuery,
  busy,
  selectedId,
  onSelect,
}: {
  workspace: Workspace;
  wallet: Wallet;
  walletUtxos: WalletUtxoController;
  active?: WalletRecordsTab;
  canQuery: boolean;
  busy: boolean;
  selectedId?: string;
  onSelect: (nodeId: string, utxo?: WalletUtxoRecord) => void;
}) {
  const transactions = useMemo(
    () => listWalletTransactions(workspace, wallet),
    [workspace.transactions, wallet],
  );
  const [queries, setQueries] = useState({ addresses: '', transactions: '', utxos: '' });
  const [pages, setPages] = useState({ addresses: 0, transactions: 0, utxos: 0 });
  const { utxos, loading, error, check: checkUtxos } = walletUtxos;
  const query = active ? queries[active].trim().toLowerCase() : '';

  if (!active) return null;
  if (active === 'addresses')
    return (
      <WalletAddressesPanel
        workspace={workspace}
        wallet={wallet}
        selectedId={selectedId}
        busy={busy}
        onSelect={onSelect}
      />
    );
  const invalidUtxos = new Set(
    (utxos?.records ?? [])
      .filter(
        (record) =>
          workspace.transactions[record.txid] &&
          !verifyWalletUtxo(record, workspace.transactions[record.txid], workspace.network),
      )
      .map((record) => `${record.txid}:${record.vout}`),
  );
  const rows =
    active === 'transactions'
      ? transactions.map((record) => ({
          id: txNodeId(record.txid),
          txid: record.txid,
          transaction: record.transaction,
          height: record.height,
          mempool: record.mempool,
          utxo: undefined as WalletUtxoRecord | undefined,
        }))
      : [...(utxos?.records ?? [])]
          .filter((record) => !invalidUtxos.has(`${record.txid}:${record.vout}`))
          .sort(
            (a, b) => b.valueSats - a.valueSats || a.txid.localeCompare(b.txid) || a.vout - b.vout,
          )
          .map((record) => ({
            id: outputNodeId(record.txid, record.vout),
            txid: record.txid,
            transaction: workspace.transactions[record.txid],
            height: record.height,
            mempool: record.height <= 0,
            utxo: record,
          }));
  const filtered = rows.filter((row) => {
    const annotation = workspace.annotations[row.id];
    return (
      !query ||
      [row.id, annotation?.label, annotation?.note, row.utxo?.address].some((value) =>
        value?.toLowerCase().includes(query),
      )
    );
  });
  const page = Math.min(pages[active], Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  return (
    <section
      className="wallet-records"
      aria-label={`Wallet ${active === 'transactions' ? 'transactions' : 'UTXOs'}`}
    >
      <div className="wallet-records-heading">
        <strong title={wallet.name}>{wallet.name}</strong>
        {active === 'utxos' && (
          <button
            className="icon-button"
            aria-label="Refresh wallet UTXOs"
            title="Check discovered addresses for current UTXOs"
            disabled={!canQuery || loading || busy}
            onClick={() => void checkUtxos()}
          >
            <RefreshCw size={15} />
          </button>
        )}
      </div>
      <p className="small muted">
        {active === 'transactions'
          ? `${transactions.length} known transactions · newest first`
          : 'Unspent at the last check · largest first'}
      </p>
      {!wallet.scanComplete && (
        <p className="small muted">Partial wallet scan. Lists cover discovered addresses.</p>
      )}
      {active === 'utxos' && (
        <>
          {!canQuery && (
            <p role="status" className="small muted">
              Connect to your backend to check current UTXOs.
            </p>
          )}
          {loading && (
            <p role="status" className="small">
              Checking wallet UTXOs…
            </p>
          )}
          {utxos && (
            <p className="small muted" title={utxos.checkedAt}>
              Checked {utxos.checkedAddresses} / {utxos.totalAddresses} addresses ·{' '}
              {formatGmtTimestamp(Date.parse(utxos.checkedAt) / 1000)?.compact}
              {utxos.failed > 0 && ` · ${utxos.failed} failed; refresh to retry`}
            </p>
          )}
          {invalidUtxos.size > 0 && (
            <p role="alert" className="small warning">
              {invalidUtxos.size} UTXO observations disagree with their loaded transactions and are
              excluded. Refresh to retry.
            </p>
          )}
          {error && (
            <p role="alert" className="small warning">
              {error}
            </p>
          )}
          {utxos?.nextCursor !== undefined && (
            <button
              className="text-button"
              disabled={!canQuery || loading || busy}
              onClick={() => void checkUtxos(utxos.nextCursor)}
            >
              Check next addresses
            </button>
          )}
        </>
      )}
      <input
        type="search"
        aria-label={`Filter wallet ${active === 'transactions' ? 'transactions' : 'UTXOs'}`}
        placeholder="Filter labels or IDs"
        value={queries[active]}
        onChange={(event) => {
          setQueries((current) => ({ ...current, [active]: event.target.value }));
          setPages((current) => ({ ...current, [active]: 0 }));
        }}
      />
      <div className="wallet-record-list">
        {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row) => {
          const annotation = workspace.annotations[row.id];
          const identifier = row.utxo ? `${row.txid}:${row.utxo.vout}` : row.txid;
          return (
            <button
              key={row.id}
              className={`wallet-record-row ${row.id === selectedId ? 'selected' : ''}`}
              aria-label={`Select ${row.utxo ? 'wallet UTXO' : 'wallet transaction'} ${identifier}`}
              aria-pressed={row.id === selectedId}
              disabled={busy || (!row.transaction && !canQuery)}
              title={`${identifier}${annotation?.note ? `\n${annotation.note}` : ''}`}
              onClick={() => onSelect(row.id, row.utxo)}
            >
              <span className="wallet-record-title">
                <span aria-hidden="true">{annotation?.icon}</span>
                <strong>{annotation?.label || short(identifier)}</strong>
              </span>
              {annotation?.label && <span className="mono muted">{short(identifier)}</span>}
              <span className="wallet-record-meta">
                <TransactionBlockTime
                  transaction={walletRecordBlockObservation(
                    row.txid,
                    row.transaction,
                    row.height,
                    row.mempool,
                  )}
                />
                <span>
                  {row.utxo
                    ? formatSats(row.utxo.valueSats)
                    : row.transaction
                      ? `${row.transaction.vin.length} in / ${row.transaction.vout.length} out`
                      : 'Load transaction'}
                </span>
              </span>
              {row.utxo && (
                <span className="mono muted" title={row.utxo.address}>
                  {short(row.utxo.address)}
                </span>
              )}
            </button>
          );
        })}
        {!filtered.length && !loading && (
          <p className="small muted">
            {query
              ? 'No matching records.'
              : active === 'transactions'
                ? 'Scan this wallet to discover transactions.'
                : utxos
                  ? utxos.failed || invalidUtxos.size || utxos.nextCursor !== undefined
                    ? 'No UTXOs found in the addresses checked successfully so far.'
                    : 'No UTXOs found for the checked addresses.'
                  : 'No UTXO check available yet.'}
          </p>
        )}
      </div>
      {filtered.length > PAGE_SIZE && (
        <nav className="wallet-record-pages" aria-label="Wallet records pages">
          <button
            className="icon-button"
            aria-label="Previous wallet records page"
            disabled={!page}
            onClick={() => setPages((current) => ({ ...current, [active]: page - 1 }))}
          >
            <ArrowLeft size={15} />
          </button>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <button
            className="icon-button"
            aria-label="Next wallet records page"
            disabled={(page + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPages((current) => ({ ...current, [active]: page + 1 }))}
          >
            <ArrowRight size={15} />
          </button>
        </nav>
      )}
    </section>
  );
}
