# Chaingraph

<div align="center"><img src="public/favicon.svg" width="80px" /></div>

Chaingraph is a self-hosted, watch-only Bitcoin workbench for people who want to understand their wallets and follow activity on chain.

It runs against your Bitcoin Core node and Electrum server, and everything you save stays encrypted in your browser.

> Chaingraph is not a custodial wallet or a public service. It never touches private keys, cannot sign or spend, and does not identify people.

## What you can do

- **Explore transactions.** Look up a transaction, address or output in a 3D or
  flat graph. Filter the view, follow funding and spending links, and inspect
  bounded address history.
  <img src="docs/screenshots/readme-graph.png" />

- **Review wallets.** Import one or more watch-only wallets from an account-level
  extended public key. Chaingraph derives addresses in the browser, scans their
  activity through your node, and keeps factual UTXO, transaction, address,
  source and destination lists alongside a linked review queue. Successful
  address UTXO checks are saved inside the encrypted workspace with their dates
  and coverage; refresh them explicitly after reopening when you need a new
  observation.
  <img src="docs/screenshots/readme-wallet.png" />

- **Annotate activity.** Add labels, notes, bookmarks and tags to transactions,
  outputs and addresses. Undo and redo edits without rolling back accepted chain
  refreshes in the current session, or exchange
  labels through plaintext BIP329 files.

- **Run analysis.** Use seven local tools to find patterns in outputs, inputs,
  address reuse, value flow, scripts and wallet overlap. Findings link to
  evidence and remain hypotheses, not proof of ownership.

- **Scan connections.** Search loaded graph data for funding and spending paths,
  shared ancestors and descendants, and loops. Results are bounded observations
  you can add to the graph.

- **Start from examples.** Open nine bundled mainnet and testnet4 workspaces with
  public transaction snapshots and starter annotations. They require no
  downloads and appear only for configured networks.

## Requirements

- A Bitcoin Core node and an Electrum server (Fulcrum is what Chaingraph is
  tested with) for mainnet, testnet4, or both. Each network uses its own pair.
- Node.js 24 or newer for a native install, or Docker with Compose v2.
- A modern browser with WebGL. Encrypted workspaces need a secure context, so
  use `localhost` or HTTPS.

## Install

### Run from source

```sh
npm ci
cp -n .env.example .env.testnet4     # or .env.mainnet, or both
chmod 600 .env.testnet4
# Edit the file with your Bitcoin Core RPC and Electrum connection details.
npm run dev
```

Open <http://127.0.0.1:3001>. The backend reads `.env.mainnet` and
`.env.testnet4` from its working directory (or `CHAINGRAPH_NETWORK_CONFIG_DIR`)
and needs at least one of them. The file name selects the network. RPC accepts a
user/password pair or a cookie file; see [.env.example](.env.example).

For a production build served from one origin:

```sh
npm run build
npm start                            # http://127.0.0.1:3000, or SERVER_PORT
```

### Run with Docker

```sh
mkdir -p config
cp -n .env.example config/.env.testnet4
chmod 750 config && chmod 640 config/.env.testnet4
sudo chgrp 1000 config config/.env.testnet4
# Edit config/.env.testnet4; container loopback is the container itself.
docker compose --env-file /dev/null up --build -d
```

Open <http://127.0.0.1:3000>. The container runs as an unprivileged user with a
read-only filesystem, and Compose publishes the port on loopback only. HTTPS,
private certificate authorities, cookie authentication and upgrades are covered
in the [deployment guide](docs/deployment.md).

## Using Chaingraph

The [user guide](docs/user-guide.md) walks through workspaces, wallets, the
graph, annotations, analysis, connection scans and backups. A short guided tour
is built into the app and can be restarted from **Help**.

Create a workspace with a public name and a password. Everything else in it
(description, wallets, loaded transactions, annotations, analysis results and
your view) is encrypted before it reaches browser storage. Workspaces save
automatically and can be exported as encrypted files for backup or transfer.

## Data and trust

- The backend is a read-only proxy to your Bitcoin Core RPC and Electrum server.
  It keeps no database, wallet, index, or cache of anything you look up. The
  genesis hash of each configured network is held in memory to identify it. The
  proxy and your upstream services do see the script hashes and transaction IDs
  you look up.
- Address derivation, scanning, analysis and encryption happen in the browser.
  Extended public keys are never sent to the backend as a wallet import.
- Saved workspaces use AES-256-GCM with a PBKDF2-SHA256 derived key. Passwords
  live only in the unlocked browser tab. There is no recovery: keep encrypted
  exports and remember your password.
- **BIP329 label exports are plaintext** and may contain extended public keys.
- The backend has no login and binds to loopback by default. It is meant for one
  trusted user on a trusted machine or behind your own authenticated HTTPS proxy.
  Public or shared hosting is not supported.

## Limits

- Wallet import supports single-key account keys at depth 3 with legacy, nested
  SegWit, native SegWit and Taproot scripts. Descriptors, multisig, private keys,
  signing and spending are out of scope.
- Loaded data is a snapshot. Scans, history and expansion are bounded, and a
  partial result never proves that nothing else exists. A missing spend means
  unknown, not unspent. When bounded spending history reaches its configured
  limit, Chaingraph keeps any verified spenders already loaded and reports the
  incomplete evidence.
- Heuristics are hypotheses. Common-input ownership can be wrong, CoinJoin
  detection is incomplete, and no tool identifies a person or proves a wallet
  owns anything.
- Workspaces are stored per browser origin and subject to browser quotas. Export
  backups before large investigations.

## Documentation

The browser source separates React UI and wiring (`src/App`) from workspace
capabilities (`src/Core/Workspace`). Each concept owns its data types and validation;
the Workspace root composes the canonical document. `Persistence` owns encrypted
formats, migration and storage.
The source map below identifies each concept and its tests.

- [User guide](docs/user-guide.md)
- [Deployment and releases](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Source map](docs/source-map.md)
- [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)
- [References and attribution](docs/references.md), plus notes on
  [encryption and storage](docs/encryption-and-storage.md),
  [analysis heuristics](docs/analysis-heuristics.md) and
  [example workspaces](docs/example-workspaces.md)

## License

[LICENSE.md](MIT). Third-party dependency notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
