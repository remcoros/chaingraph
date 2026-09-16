# Contributing

Chaingraph is a watch-only Bitcoin workbench. The browser owns workspaces,
wallets, scanning and encryption; the server is a bounded read-only bridge.
Read [docs/architecture.md](docs/architecture.md) before changing a module
boundary, and keep chain observations, user annotations and heuristic
hypotheses separate.

Use [docs/source-map.md](docs/source-map.md) to find a product area's UI, state,
helpers and tests. The source tree follows App, FrontPage, Workspace and its
workbenches, with shared UI, domain logic and browser infrastructure alongside.

## Set up

Node 24+, npm and a WebGL-capable browser.

```sh
npm ci
cp -n .env.example .env.testnet4     # and/or .env.mainnet
chmod 600 .env.testnet4
npm run dev                          # http://127.0.0.1:3001
```

Never commit environment files, wallet exports, credentials or personal browser
artifacts. Use public key vectors or synthetic data in tests; example workspaces
bundle verified real-chain snapshots.

## Check

```sh
npm run format:check          # Prettier
npm run check                 # portability, types, build, domain/integration tests
node scripts/release-check.mjs
```

Routine push/PR CI runs exactly these plus a license-notice diff, without a
browser. Run `npm run format` after editing source and `npm run licenses` after
changing runtime dependencies. Engine or data changes need relevant behavioral
tests; UI polish does not need new E2E coverage. Documentation-only changes
need no test run.

Narrower commands:

```sh
npm test                      # vitest domain/backend suites
npx vitest run tests/connectionScan   # focused scan suites, see docs/connection-scan-testing.md
npm run test:live             # read-only smoke against configured real networks
```

### Production and browser checks

Build and start the app (`npm run build && SERVER_PORT=4300 npm start`), then:

```sh
npm run test:production:http  # built assets, CSP and security headers, network discovery
npx playwright install chromium
npm run test:production       # the above plus a narrow browser runtime check
npm run test:e2e              # small smoke suite: the app renders and a workspace opens
```

`CHAINGRAPH_SMOKE_URL` selects another origin. The browser runtime check covers
the real encryption worker under production CSP, WebGL initialization and
encrypted save/reload/unlock/export with synthetic data. It does not establish
visual usability. Browser and screenshot validation happen only on explicit
request or within an agreed QA scope; otherwise run the non-browser checks and
say that visual validation was not performed. The manual **Browser QA** GitHub
workflow runs the runtime check or the smoke suite and publishes nothing.

## Parallel worktrees

Each checkout needs its own `npm ci` and test output; do not symlink
`node_modules` between worktrees. Browser tests fail if their port is occupied
rather than silently testing another checkout, so assign distinct ports:

```sh
CHAINGRAPH_E2E_PORT=4176 CHAINGRAPH_GRAPH_TEST_PORT=4186 npm run test:e2e
```

Defaults are 4173 (app) and 4184 (renderer fixture). Run one browser suite at a
time per checkout.

For a frontend-only preview against an existing backend:

```sh
CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4400 \
  node --use-system-ca node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3103 --strictPort
```

Vite preserves the browser-facing Host header so the backend can validate the
request. Keep the browser and API on one origin through the proxy; do not weaken
Origin checks to make a preview work. Browser storage is per origin, so each
preview port has its own workspace list.

## Review a change

Describe the user-visible problem, what changes, and the checks actually run.
Cover arithmetic, cryptography, protocol handling, cancellation, evidence
semantics and storage failures with meaningful regressions rather than tests
that restate the implementation. When browser validation is in scope, exercise
the real workflow with mouse and keyboard on desktop and phone widths, and count
clicks and scrolling, not just green assertions.

Keep alternative designs in separate branches and compare working previews
before adopting a redesign. Do not push or publish because a local check
passed; the [release process](docs/deployment.md#release-process) describes the
tag workflow.

## Layer boundaries

`npm run lint` (part of `npm run check`) enforces the dependency direction as
well as style. `Domain` and `Infra` may not import `App`. Workspace persistence
lives under `App/Workspace/Persistence`: it may depend on the canonical Workspace
model and the store-owned persistence port, but never React views, workbenches or
the concrete session store. The session store may depend on that port and other
Workspace-owned concepts, never persistence adapters or workbench implementations.
Workspace-scope code under `Evidence`, `Selection` and `Wallet/WalletUtxos` may not
import a workbench. Graph-owned address evidence, lookup and expansion live with the
Graph workbench. Wallet and Analysis reach Graph only through the `GraphHandoff`
contract in `Workbenches/workbenchHandoff.ts`. Import cycles are rejected everywhere,
with no exceptions. Prefer a declared contract, or move what both sides need into a
module below them, over reintroducing one.

## Portable content

Use repository-relative references in committed documentation. Do not commit a
developer's absolute home path, private hostname or temporary handoff filename.
`npm run check:portability` (part of `npm run check`) checks tracked text for
user-home paths and rejects tracked environment files other than `.env.example`
without echoing matched contents. It is not a secret scanner; review new
screenshots and configuration separately. Local recordings and browser output
belong in the ignored `artifacts/` directory.
