# Chaingraph

A self-hosted Bitcoin analysis workbench for personal wallets and on-chain investigations. Explore transactions and outputs in an interactive 3D graph, follow funding and spending paths, annotate what you find, and compare tentative ownership hypotheses. Workspaces and wallet data live in your browser.

This first slice includes multiple encrypted workspaces, multiple watch-only wallets per workspace, address and transaction loading, receive/change scanning, labels, notes, icons, bookmarks, BIP329 label exchange, and three analysis tools: equal-output detection, common-input ownership, and address reuse. The graph supports a 2D view, value/degree sizing, cluster colors, and optional glow. A synthetic laboratory includes three 150-input/150-output transactions with funding and spending paths.

![Synthetic CoinJoin laboratory in Chaingraph](docs/screenshots/workbench.png)

## Run locally

Use Node.js 24 or newer and npm. Configure your own Bitcoin Core RPC and Fulcrum instance for the same network. Each backend process serves **one network**, either mainnet or testnet4.

```sh
npm ci
cp -n .env.example .env
# Set your upstream connection details in .env.
npm run dev
```

Open **http://127.0.0.1:3001**. The development launcher reads the configured backend port and proxies API calls to it; the browser UI stays on port 3001. Vite receives no upstream credentials. The laboratory can be explored without a working chain connection; live lookups need both upstream services.

If credentials are already in `.env.live`, use `npm run dev:live`. This loads the file directly into the backend process through Node's environment-file option. Environment files are local secrets and must not be committed. RPC accepts either a user/password pair or a cookie file, as shown in [.env.example](.env.example).

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

Workspace contents are encrypted before browser `localStorage` persistence and encrypted-file export, using AES-256-GCM and PBKDF2-SHA256. Workspace passwords stay in the unlocked browser session; there is no password recovery. Browser storage is origin-specific and subject to quota and deletion, so keep exported backups. **BIP329 label exports are plaintext** and can contain extended public keys. See [the user workflow](instructions.md) for the distinction.

This is a trusted, single-user, fully self-hosted application. The backend has **no user authentication** and binds to loopback by default. Public or shared hosting is unsupported. Browser-origin checks and upstream request limits do not provide a user authorization system. Workspace encryption protects saved data, not an unlocked session or untrusted code served to the browser. Web Crypto requires localhost or HTTPS.

## Current boundaries

- Wallet import accepts account-level public keys at depth 3: `xpub`/`ypub`/`zpub` on mainnet and `tpub`/`upub`/`vpub` on testnet4. Supported single-key scripts are legacy P2PKH, nested SegWit, native SegWit, and BIP86 Taproot. Descriptors, multisig, private keys, signing, and spending are unsupported.
- Loaded transactions are a **history snapshot**. Status polling does not refresh every saved confirmation count or detect every reorganization. Scans have address, history, and transaction bounds; a partial result is not proof that no further activity exists.
- CIOH produces a hypothesis. Skipping conspicuous equal-output transactions does not detect all collaborative spends or PayJoin. No tool identifies a person or proves wallet ownership.
- The 2D view still requires WebGL. The entity list provides a keyboard-friendly inspection path. Individual node dragging is disabled because of an upstream pointer-handling issue; camera orbit, pan, zoom, and node selection remain available.
- Tools are extensible through [`src/domain/analysis.ts`](src/domain/analysis.ts). There is no custom-script IDE, Boltzmann implementation, service worker, or WebSocket live feed in this slice. Boltzmann-related research and license compatibility remain research work.

## Development

```sh
npm run build     # TypeScript check and frontend build
npm test          # Unit and integration tests
npm run test:e2e  # Browser tests; requires Playwright Chromium
npm run check    # Build and unit/integration tests
npm run test:live # Read-only testnet4/mainnet smoke using .env.live
```

Use `npx playwright install chromium` if the browser required by the installed Playwright version is missing. Test commands are separate from claims about a live node or mobile performance.

See [verified results and limits](docs/validation.md) for automated, live testnet4, and production-browser evidence.

The dependency license notices are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); regenerate them with `npm run licenses` after dependency updates.

Read [architecture and extension points](docs/architecture.md), [user instructions](instructions.md), and the [research log](docs/research/2026-09-08-discovery.md). Research notes credit upstream specifications, papers, and libraries; third-party code retains its own license. Chaingraph is MIT-licensed.
