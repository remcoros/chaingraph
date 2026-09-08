# Chaingraph

A self-hosted Bitcoin analysis workbench for personal wallets and on-chain investigations. Explore transactions and outputs in an interactive 3D graph, follow funding and spending paths, annotate what you find, and compare tentative ownership hypotheses. Workspaces and wallet data live in your browser. Returning-wallet refresh keeps new activity visible until reviewed, without disrupting labels or the current graph selection.

Version 0.2.0 includes multiple encrypted workspaces and watch-only wallets, browser-side receive/change scanning, labels, notes, a searchable icon palette, bookmarks, and BIP329 label exchange. Workspace tags group counterparties independently from labels and notes, while separate wallet-match highlights identify derived addresses and their loaded outputs. Seven analysis tools cover equal outputs, common-input ownership, address reuse, value flow and fees, consolidation and fan-out, script types, and imported-wallet intersections. Each tool exposes its scope, parameters, assumptions and coverage.

Filter the graph by entity type, labels, notes, bookmarks, value and loaded funding/spending evidence. Follow a selection's neighborhood, navigate selection history, isolate findings, or use a paginated entity list. A synthetic laboratory contains three 150-input/150-output transactions with expandable paths. Four verified mainnet transactions and three testnet4 output examples offer real-chain tracing practice.

![Compact main workbench with public testnet4 transaction tracing and floating navigation](docs/screenshots/compact-main-desktop.png)

## Docker and Compose

```sh
mkdir -p config
cp -n .env.example config/.env.testnet4
chmod 750 config
chmod 640 config/.env.testnet4
sudo chgrp 1000 config config/.env.testnet4
# Set testnet4 upstreams reachable from the container; add .env.mainnet for mainnet.
docker compose --env-file /dev/null up --build -d
```

Open **http://127.0.0.1:3000**. The container runs without root privileges and Compose restricts the published port to loopback. See [deployment and release instructions](docs/deployment.md) for HTTPS, private CAs, cookie authentication, backups and the GitHub container release workflow. No GitHub repository or published image is assumed yet.

## Run locally

Use Node.js 24 or newer and npm. One backend can serve **mainnet, testnet4, or both simultaneously**, using an isolated Bitcoin Core/Fulcrum pair for each configured network.

```sh
npm ci
cp -n .env.example .env.testnet4
chmod 600 .env.testnet4
# Set testnet4 upstream connection details. Add .env.mainnet for mainnet support.
npm run dev
```

Open **http://127.0.0.1:3001**. The development launcher reads the configured backend port and proxies API calls to it; the browser UI stays on port 3001. Vite receives no upstream credentials. The laboratory can be explored without a working chain connection; live lookups need both upstream services.

The backend discovers `.env.mainnet` and `.env.testnet4` in the working directory, or in `CHAINGRAPH_NETWORK_CONFIG_DIR` when set. At least one valid file is required. Each file is parsed independently, and its filename selects its network; upstream credentials are never merged into the process environment. `.env` and `.env.live` are not loaded. `dev:live` and `start:live` are aliases for the same discovery-based launchers. RPC accepts either a user/password pair or a cookie file, as shown in [.env.example](.env.example).

The frontend discovers configured networks before creating a workspace and routes every lookup through that workspace’s network. A disconnected upstream does not remove its configured network or disable another pair. Importing or unlocking a workspace for an unconfigured network still opens its saved data for offline inspection and editing. A clear backend-network error explains why live queries are disabled.

To serve the built application from one local origin:

```sh
npm run build
npm start
# Or: npm run start:live
```

Open **http://127.0.0.1:3000** (or the port configured by `SERVER_PORT`). `npm start` serves `dist/` and the API; rebuild after frontend changes. The TypeScript backend runs through `tsx`, so retain the project's installed dependencies.

All launch scripts enable Node's system CA store (`--use-system-ca`), including
npm lifecycle tools through `.npmrc`. Certificates trusted by the operating system
remain verified. A separate private CA can be supplied with `NODE_EXTRA_CA_CERTS`;
TLS certificate and hostname checks are never disabled.

## Data and trust

The backend is a bounded, read-only RPC/Electrum proxy. It stores no workspaces, wallet indexes, labels, or chain-data cache. Address derivation, scan orchestration, analysis, and encryption run in the browser. The proxy and upstreams still see the requested script hashes and transaction IDs.

Workspace names are public so locked workspaces remain identifiable. Optional descriptions, wallets, graph data, and annotations are encrypted before browser persistence and encrypted-file export, using AES-256-GCM and PBKDF2-SHA256. Workspace passwords stay in the unlocked browser session; there is no password recovery. Small encrypted saves use localStorage; larger saves use IndexedDB with a compact public index. Browser storage is origin-specific and subject to quota and deletion, so keep exported backups. **BIP329 label exports are plaintext** and can contain extended public keys. See [the user workflow](instructions.md) for the distinction.

This is a trusted, single-user, fully self-hosted application. The backend has **no user authentication** and binds to loopback by default. Public or shared hosting is unsupported. Browser-origin checks and upstream request limits do not provide a user authorization system. Workspace encryption protects saved data, not an unlocked session or untrusted code served to the browser. Web Crypto requires localhost or HTTPS.

## Current boundaries

- Wallet import accepts account-level public keys at depth 3: `xpub`/`ypub`/`zpub` on mainnet and `tpub`/`upub`/`vpub` on testnet4. Supported single-key scripts are legacy P2PKH, nested SegWit, native SegWit, and BIP86 Taproot. Descriptors, multisig, private keys, signing, and spending are unsupported.
- Loaded transactions are a **history snapshot**. Status polling does not refresh every saved confirmation count or detect every reorganization. Scans have address, history, and transaction bounds; a partial result is not proof that no further activity exists.
- CIOH produces a hypothesis. Skipping conspicuous equal-output transactions does not detect all collaborative spends or PayJoin. No tool identifies a person or proves wallet ownership.
- Transactions use cubes, outputs use spheres, and optional addresses use diamonds. Hover a node for details and compact tracing/editing actions; connection lines do not open hover cards. The lookup toolbar defaults to Previous Off, with 1 and 2 levels available, bounded to 500 downloads per action. The displayed transaction separately loads its direct input data automatically. Automatically fetched parents initially show only relevant outputs in the graph, keeping unrelated branches out of the current view. Workspaces share the main header; Help and samples holds the tour, examples and About. Graph navigation floats over the canvas. The Flat graph layout still requires WebGL; the transaction inputs/outputs panel does not. The entity list provides a keyboard-friendly inspection path. Individual node dragging is disabled because of an upstream pointer-handling issue; camera orbit, pan, zoom, and node selection remain available.
- Tools are extensible through [`src/domain/analysis.ts`](src/domain/analysis.ts). There is no custom-script IDE, Boltzmann implementation, service worker, or WebSocket live feed in this version. Boltzmann-related research and license compatibility remain research work.

See the curated [mainnet examples](docs/research/mainnet-examples.md) and [testnet4 examples](docs/research/testnet4-examples.md). The Help menu follows the active workspace network. Examples are real chain observations, not attributed wallets or proof of ownership.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for isolated worktrees, configurable browser-test ports, frontend-only previews and review expectations. Security reporting and deployment boundaries are in [SECURITY.md](SECURITY.md).

```sh
npm run build     # TypeScript check and frontend build
npm test          # Unit and integration tests
npm run test:e2e  # Browser tests; requires Playwright Chromium
npm run check    # Build and unit/integration tests
npm run test:live # Read-only smoke for configured network pairs
npm run test:production # Browser smoke against built server on port 4300
```

Use `npx playwright install chromium` if the browser required by the installed Playwright version is missing. Test commands are separate from claims about a live node or mobile performance.

See [verified results and limits](docs/validation.md) for automated, live mainnet/testnet4, and production-browser evidence.

The dependency license notices are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); regenerate them with `npm run licenses` after dependency updates.

The [review records](docs/reviews/2026-09-08-response.md) and [validation report](docs/validation.md) distinguish implemented features, tested behavior and release limitations.

Read [architecture and extension points](docs/architecture.md), [user instructions](instructions.md), and the [research log](docs/research/2026-09-08-discovery.md). Research notes credit upstream specifications, papers, and libraries; third-party code retains its own license. Chaingraph is MIT-licensed.

## Transaction and script inspection

Select a transaction or output to open the collapsible inputs/outputs view above the graph. Selecting an input follows its previous output while retaining the transaction being examined. For a selected output, the transaction chooser includes its creating transaction and all loaded spending transactions. Large lists start collapsed, with expand/collapse controls above the rows and the selected row kept visible. Direct input transactions load automatically while the flow panel is open, with explicit retry or continuation for unavailable or bounded results. Click the central transaction block to select it, or use its label, tag and icon controls to edit it. Missing spending data does not prove an output is unspent.

The Inspector’s **Scripts and raw transaction** section shows saved output script hex and normalized opcodes. **Load raw transaction** explicitly fetches and verifies serialized bytes for scriptSig, witness, version, locktime and size inspection. Raw data stays in memory only for that inspected selection. The laboratory has no serialized raw data. Script decoding does not execute scripts or verify signatures. See [inspection research and limits](docs/research/transaction-inspection.md).

Edits to labels, notes, icons, bookmarks, tags and workspace details save automatically.
The status bar confirms when the encrypted copy has reached browser storage; locking
flushes pending edits first. Graph camera/layout, filters, selection and transaction-flow
expansion are encrypted and restored when reopening. Export remains an explicit action
for keeping a portable backup.

The compact transaction flow places inputs and outputs around the current transaction.
Select an output to see adjacent creating/spending transactions and use its arrows to
follow the exact outpoint. Direct input data loads automatically; explicit navigation opens the corresponding parent transaction and its wider context.
OP_RETURN outputs show decoded text when possible, with a short preview and expandable,
selectable, copyable full data. Binary data stays hex; script decoding never executes it.
Tags can be searched, created and assigned from **Add or choose tags** in the inspector.

**Lock to selection** keeps the graph centered as you select items anywhere in the
workbench. Graph controls independently show or hide labels, tags and icons. On
desktop, **Focus graph** sits beside the 3D/Flat toggle and temporarily hides the
side panels; it is hidden on mobile, where panels already have separate views.
