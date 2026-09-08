import { useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  CodeXml,
  Info,
  Keyboard,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Modal } from './Dialogs';
import type { BackendStatus } from '../lib/api';
import type { Network } from '../domain/types';
import './product.css';

export function AboutDialog({
  initialTab = 'guide',
  onClose,
  onTour,
  status,
  statusError,
  networks,
  statuses = {},
  onReconnect,
}: {
  initialTab?: 'guide' | 'about' | 'connection';
  onClose: () => void;
  onTour?: () => void;
  status?: BackendStatus;
  statusError?: string;
  networks?: Network[];
  statuses?: Partial<Record<Network, BackendStatus>>;
  onReconnect: () => void;
}) {
  const [tab, setTab] = useState<'guide' | 'about' | 'connection'>(initialTab);
  return (
    <Modal title="Help and about Chaingraph" onClose={onClose}>
      <nav className="help-tabs" aria-label="Help sections">
        <button aria-pressed={tab === 'guide'} onClick={() => setTab('guide')}>
          <BookOpen size={15} />
          Guide
        </button>
        <button aria-pressed={tab === 'connection'} onClick={() => setTab('connection')}>
          <ShieldCheck size={15} />
          Connection
        </button>
        <button aria-pressed={tab === 'about'} onClick={() => setTab('about')}>
          <Info size={15} />
          About
        </button>
      </nav>
      {tab === 'guide' ? (
        <div className="help-content">
          <h3>Build an investigation</h3>
          <ol className="workflow-guide">
            <li>
              <strong>Start with an output or wallet.</strong> Paste a transaction, txid:vout or
              address. Example workspaces contain real transactions with starter labels and tags.
            </li>
            <li>
              <strong>Follow one path at a time.</strong> Cubes are transactions; spheres are
              outputs. Hover for details, trace previous levels, or find spends in the inspector.
            </li>
            <li>
              <strong>Narrow your view.</strong> Use Entities to filter labels, values, funding
              details and loaded spends. Focus a selection's neighborhood, then restore All paths.
            </li>
            <li>
              <strong>Review the evidence.</strong> Run analysis on the visible graph or a selected
              transaction. Findings explain assumptions and become stale when underlying data
              changes.
            </li>
            <li>
              <strong>Label what you know.</strong> Add notes, bookmarks and workspace tags for
              known sources and destinations. Export encrypted backups; your public workspace name
              remains visible while locked.
            </li>
          </ol>
          {onTour && (
            <button
              className="primary"
              onClick={() => {
                onClose();
                onTour();
              }}
            >
              Restart guided tour
            </button>
          )}
          <h3>Wallet matches and tags</h3>
          <p>
            Wallet highlights match loaded scripts to addresses derived from your imported wallets.
            A related transaction can include other participants. Manual tags group your
            observations independently from analysis findings. Use Tags to group imported labels or
            apply a counterparty to an address and its outputs.
          </p>
          <h3>
            <Keyboard size={15} /> Keyboard and graph controls
          </h3>
          <dl className="shortcut-list">
            <div>
              <dt>Quick lookup</dt>
              <dd>
                <kbd>Ctrl / ⌘ K</kbd>
              </dd>
            </div>
            <div>
              <dt>Flush automatic save</dt>
              <dd>
                <kbd>Ctrl / ⌘ S</kbd>
              </dd>
            </div>
            <div>
              <dt>Selected graph details</dt>
              <dd>
                <kbd>Enter</kbd> on the canvas
              </dd>
            </div>
            <div>
              <dt>Close a dialog</dt>
              <dd>
                <kbd>Esc</kbd>
              </dd>
            </div>
            <div>
              <dt>Orbit / pan / zoom</dt>
              <dd>Drag / right-drag / scroll</dd>
            </div>
          </dl>
          <p className="small muted">
            Flat view and the entity list provide alternatives to 3D navigation. Filters and view
            settings are saved in your encrypted workspace. Selection history stays in this session.
          </p>
        </div>
      ) : tab === 'connection' ? (
        <div className="help-content">
          <h3>
            {status?.connected && !statusError
              ? 'Your node is connected'
              : 'Your node is unavailable'}
          </h3>
          <dl className="details">
            <div>
              <dt>Network</dt>
              <dd>{status?.network ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Reported height</dt>
              <dd>{status?.height?.toLocaleString() ?? 'Unavailable'}</dd>
            </div>
          </dl>
          {(statusError || status?.error) && (
            <p className="error-text">{statusError || status?.error}</p>
          )}
          {!!networks?.length && (
            <section aria-label="Configured backend networks" className="network-connections">
              <h3>Configured networks</h3>
              {networks.map((network) => (
                <div key={network} className="network-connection-row" data-network={network}>
                  <strong>{network}</strong>
                  <span>
                    {statuses[network]?.connected
                      ? `Connected · ${statuses[network]?.height?.toLocaleString() ?? 'height unavailable'}`
                      : statuses[network]
                        ? 'Unavailable'
                        : 'Checking connection…'}
                  </span>
                </div>
              ))}
            </section>
          )}
          <button onClick={onReconnect}>
            <RefreshCw size={15} />
            Check connection again
          </button>
          <p>
            Each network has separate Bitcoin and Fulcrum connections. Every workspace stays on its
            own network. Check that network’s RPC credentials, upstream availability and TLS trust
            if it is unavailable.
          </p>
          <p className="small muted">
            Saved workspaces can be explored offline. Loaded transactions are snapshots;
            reconnecting does not automatically refresh every saved confirmation count.
          </p>
          <p className="small muted">
            Chaingraph is designed for a trusted, single-user, self-hosted setup. The backend has no
            user login. Use localhost or HTTPS, and keep it on a trusted network.
          </p>
        </div>
      ) : (
        <div className="help-content">
          <span className="eyebrow">CHAINGRAPH {__APP_VERSION__}</span>
          <h3>About this workbench</h3>
          <p>
            A watch-only Bitcoin analysis workbench for personal wallets and independent
            investigations. Built for mainnet and testnet4, with client-owned encrypted workspaces.
          </p>
          <div className="about-links">
            {__SOURCE_URL__ ? (
              <>
                <a href={__SOURCE_URL__} target="_blank" rel="noreferrer">
                  <CodeXml size={16} />
                  Source on GitHub
                </a>
                <a href={`${__SOURCE_URL__}/issues`} target="_blank" rel="noreferrer">
                  Report an issue
                  <ExternalLink size={13} />
                </a>
                <a href={`${__SOURCE_URL__}/releases`} target="_blank" rel="noreferrer">
                  Releases
                  <ExternalLink size={13} />
                </a>
              </>
            ) : (
              <p className="small muted">
                GitHub source and release links are not configured for this build yet.
              </p>
            )}
            <a href="https://opensource.org/license/mit" target="_blank" rel="noreferrer">
              MIT license
              <ExternalLink size={13} />
            </a>
          </div>
          <h3>Research and acknowledgements</h3>
          <p className="small">
            The graph uses Three.js and 3d-force-graph. Bitcoin primitives use bitcoinjs, scure and
            noble libraries. Analysis references are recorded with their assumptions in the project
            research log.
          </p>
          <div className="about-links">
            <a href="https://github.com/bitcoin/bips" target="_blank" rel="noreferrer">
              Bitcoin Improvement Proposals
            </a>
            <a href="https://github.com/vasturiano/3d-force-graph" target="_blank" rel="noreferrer">
              3d-force-graph
            </a>
            <a href="https://threejs.org/" target="_blank" rel="noreferrer">
              Three.js
            </a>
          </div>
          <p className="small muted">
            No private keys, signing or spending. Heuristics do not establish ownership or identity.
            There is no telemetry or third-party analytics. External links open only when you choose
            them.
          </p>
        </div>
      )}
    </Modal>
  );
}
