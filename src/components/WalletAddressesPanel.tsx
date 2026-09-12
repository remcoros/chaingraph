import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { addressNodeId, type Wallet, type Workspace } from '../domain/types';
import { listWalletAddresses } from '../domain/walletRecords';
import { ResponsiveIdentifier } from './ResponsiveIdentifier';

const PAGE_SIZE = 40;

export function WalletAddressesPanel({
  workspace,
  wallet,
  selectedId,
  busy,
  onSelect,
}: {
  workspace: Workspace;
  wallet: Wallet;
  selectedId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  const addresses = useMemo(
    () => listWalletAddresses(workspace, wallet),
    [workspace.transactions, wallet],
  );
  const [query, setQuery] = useState('');
  const [requestedPage, setPage] = useState(0);
  const search = query.trim().toLowerCase();
  const filtered = addresses.filter((record) => {
    const annotation = workspace.annotations[addressNodeId(record.address)];
    return (
      !search ||
      [
        record.address,
        record.path,
        record.branch ? 'change' : 'receive',
        annotation?.label,
        annotation?.note,
      ].some((value) => value?.toLowerCase().includes(search))
    );
  });
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  return (
    <section className="wallet-records" aria-label="Wallet addresses">
      <div className="wallet-records-heading">
        <h2 className="panel-title" title={wallet.name}>
          {wallet.name}
        </h2>
      </div>
      <p className="small muted">{addresses.length} discovered addresses · receive then change</p>
      <p className="small muted">Output counts use loaded transactions, including spent outputs.</p>
      {!wallet.scanComplete && (
        <p className="small muted">Partial wallet scan. More addresses may exist.</p>
      )}
      <input
        type="search"
        aria-label="Filter wallet addresses"
        placeholder="Filter addresses, labels or paths"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(0);
        }}
      />
      <div className="wallet-record-list">
        {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((record) => {
          const id = addressNodeId(record.address);
          const annotation = workspace.annotations[id];
          return (
            <button
              key={id}
              className={`wallet-record-row ${id === selectedId ? 'selected' : ''}`}
              aria-label={`Select wallet address ${record.address}`}
              aria-pressed={id === selectedId}
              disabled={busy}
              title={`${record.address}\n${record.path}`}
              onClick={() => onSelect(id)}
            >
              <span className="wallet-record-title">
                <span aria-hidden="true">{annotation?.icon}</span>
                <strong>
                  {annotation?.label || <ResponsiveIdentifier value={record.address} />}
                </strong>
              </span>
              {annotation?.label && (
                <span className="mono muted">
                  <ResponsiveIdentifier value={record.address} />
                </span>
              )}
              <span className="wallet-record-meta">
                <span>
                  {record.branch ? 'Change' : 'Receive'} / {record.index}
                </span>
                <span title="Outputs in loaded transactions, spent or unspent. Not a complete history or UTXO count.">
                  {record.loadedOutputCount} loaded{' '}
                  {record.loadedOutputCount === 1 ? 'output' : 'outputs'}
                </span>
              </span>
            </button>
          );
        })}
        {!filtered.length && (
          <p className="small muted">
            {search ? 'No matching addresses.' : 'Scan this wallet to discover addresses.'}
          </p>
        )}
      </div>
      {filtered.length > PAGE_SIZE && (
        <nav className="wallet-record-pages" aria-label="Wallet address pages">
          <button
            className="icon-button"
            aria-label="Previous wallet addresses page"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            <ArrowLeft size={15} />
          </button>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <button
            className="icon-button"
            aria-label="Next wallet addresses page"
            disabled={(page + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage(page + 1)}
          >
            <ArrowRight size={15} />
          </button>
        </nav>
      )}
    </section>
  );
}
