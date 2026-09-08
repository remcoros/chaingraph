import { examplesForNetwork } from '../domain/examples';
import type { Network } from '../domain/types';
import { Modal } from './Dialogs';

export function ExamplesDialog({
  network,
  canLoad,
  onLoad,
  onClose,
}: {
  network: Network;
  canLoad: boolean;
  onLoad: (query: string) => void;
  onClose: () => void;
}) {
  const name = network === 'mainnet' ? 'Mainnet' : 'Testnet4';
  return (
    <Modal title={`${name} tracing examples`} onClose={onClose}>
      <p className="muted">
        Public transactions for practicing tracing, labels and analysis. Patterns do not prove
        wallet ownership. Examples load through your own backend.
      </p>
      {!canLoad && (
        <p className="warning">
          Open a {network} workspace with a connected {network} backend to load these examples.
        </p>
      )}
      <div className="example-list">
        {examplesForNetwork(network).map((example) => {
          const query =
            example.vout === undefined ? example.txid : `${example.txid}:${example.vout}`;
          return (
            <article key={example.id}>
              <h3>{example.title}</h3>
              <p>{example.description}</p>
              <p className="small muted">
                {example.evidence.inputCount} inputs → {example.evidence.outputCount} outputs
              </p>
              <p className="mono small wrap">{query}</p>
              <div className="button-row">
                <button className="primary" disabled={!canLoad} onClick={() => onLoad(query)}>
                  Load example {example.vout === undefined ? 'transaction' : 'output'}
                </button>
                <a href={example.sources[0].url} target="_blank" rel="noreferrer">
                  Explorer reference
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </Modal>
  );
}
