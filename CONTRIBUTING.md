# Contributing

Chaingraph is a watch-only Bitcoin workbench. The browser owns workspaces,
wallets, scanning and encryption; the server is a bounded read-only bridge.
Read [docs/architecture.md](docs/architecture.md) before changing a module
boundary, and keep chain observations, user annotations and heuristic
hypotheses separate.

Use [docs/source-map.md](docs/source-map.md) to find a product area's UI, state,
helpers and tests. App owns React UI and wiring; Core owns workspace capabilities.
Each Core concept holds its canonical data types and validity rules together;
`Core/Workspace/Persistence` owns encrypted formats and storage. Behavior and tests
stay grouped by their actual concept.

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
npm run check                 # formatting, portability, linting, build and domain/integration tests
node scripts/release-check.mjs
docker buildx bake --check release-platform
```

Routine push/PR CI runs exactly these plus a license-notice diff, without a
browser. Run `npm run format` after editing source and `npm run licenses` after
changing runtime dependencies. Engine or data changes need relevant behavioral
tests; UI polish does not need new E2E coverage. Documentation-only changes
need no test run.

Narrower commands:

```sh
npm test                      # vitest domain/backend suites
npx vitest run src/Core/Workspace/ConnectionScan tests/integration/connection-scan
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

For an **additional UI** against a running backend, verify its listener and
`/proc/<pid>/cwd`, choose an unused strict UI port, then reuse it with a
frontend-only preview:

```sh
CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4400 \
  node --use-system-ca node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3103 --strictPort
```

Vite preserves the browser-facing Host header so the backend can validate the
request. Keep the browser and API on one origin through the proxy; do not weaken
Origin checks to make a preview work. Browser storage is per origin, so each
preview port has its own workspace list.

`npm run dev` remains the contained-stack option and starts both Node and Vite
watchers. If a watcher reports `ENOSPC` or `EMFILE`, inspect and report the
shared host settings `fs.inotify.max_user_instances` and
`fs.inotify.max_user_watches` and the process owners. Do not change sysctls or
kill unknown listeners automatically.

## Review a change

Describe the user-visible problem, what changes, and the checks actually run.
Cover arithmetic, cryptography, protocol handling, cancellation, evidence
semantics and storage failures with meaningful regressions rather than tests
that restate the implementation. When browser validation is in scope, exercise
the real workflow with mouse and keyboard on desktop and phone widths, and count
clicks and scrolling, not just green assertions.

Keep alternative designs in separate branches and compare working previews
before adopting a redesign. Do not push or publish because a local check
passed; the [release process](docs/release-process.md) describes the
tag workflow.

## Layer boundaries

`npm run lint` (part of `npm run check`) enforces the dependency direction as
well as style. Core production code cannot import React or App. Canonical schemas
and pure validity rules do not load execution, transport or Persistence. Persistence consumes those rules,
never App or the Session runtime. Session consumes the public persistence contract;
`App/appServices.ts` constructs and supplies the facade.
Domain has been removed. Core Bitcoin contains native primitives without
application dependencies. Core ChainData consumes Bitcoin and provides shared
chain models, validation, observation rules and workspace-independent RPC queries.
Account-wallet policy belongs to Workspace Wallets; entity references belong to
the Workspace root, not Bitcoin.
Shared amount/reference formatting lives in Core Formatting. ChainData owns Bitcoin RPC
decoding and fetch scheduling; Session owns workspace-bound request lifetime and accepted 
publication. Live queries use named-file imports and are not re-exported by the model/validation 
index, so canonical document parsing does not load the transport or scheduler.

App Selection and the shared wallet UTXO hook cannot import workbench internals.
Wallet and Analysis reach Graph through `GraphHandoff` in
`Workbenches/workbenchHandoff.ts`. ConnectionScan models, execution and retained
result rules live together in Core; Graph owns target projection and path-add UI.
Public interfaces may be named files, not just root indexes. Bitcoin, ChainData
and workspace concepts allow direct imports; a folder alone does not imply private
implementation. Persistence and Formatting retain explicit root interfaces.
Outside callers cannot deep-import those two modules, including type imports,
re-exports and literal dynamic imports. Internal files use direct imports.
Browser, Codec and Migrations have no public subfolder entry points. Indexes
must not initialize storage or workers. Do not export fault-injection options
or private formats merely to support external tests.

Unit tests live beside their owner. Persistence's module-owned `Integration/`
suite exercises private storage/crypto fault injection together with real Session
and App behavior. Only that test suite may cross those production dependency
rules; no production caller may import it. Other cross-module tests remain in
`tests/integration/` and use the relevant concept and Persistence public interfaces.

Import cycles are rejected everywhere. Do not add forwarding files or hypothetical
interfaces merely to make intermediate refactor states compile.
Complete the related ownership changes and then validate the coherent chunk.

## Portable content

Use repository-relative references in committed documentation. Do not commit a
developer's absolute home path, private hostname or temporary handoff filename.
`npm run check:portability` (part of `npm run check`) checks tracked text for
user-home paths and rejects tracked environment files other than `.env.example`
without echoing matched contents. It is not a secret scanner; review new
screenshots and configuration separately. Local recordings and browser output
belong in the ignored `artifacts/` directory.
