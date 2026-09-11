# Contributing

Chaingraph is a watch-only Bitcoin investigation tool. Keep chain observations, user annotations and heuristic hypotheses separate. The browser owns workspaces, wallets, scanning and encryption; the server is a bounded read-only bridge. Read [architecture](docs/architecture.md) before changing a module boundary.

## Set up and verify

Use Node 24+, npm and a modern WebGL browser. From a checkout:

```sh
npm ci
cp -n .env.example .env.testnet4
chmod 600 .env.testnet4
# Configure this testnet4 pair; add .env.mainnet for mainnet support.
npm run dev
```

Example workspaces bundle verified real-chain snapshots; creation requires supported-network discovery. Synthetic dense graphs live only in test fixtures. Use public key vectors or synthetic data for reproducible tests, and never commit environment files, wallet exports, credentials or personal browser artifacts.

```sh
npm run format:check
npm run check
node scripts/release-check.mjs
```

Routine push/PR CI runs these non-browser checks and verifies runtime license notices. `npm run check` includes portability, build/type checks and domain/integration tests. Prioritize engine correctness and data integrity: engine or data changes need relevant behavioral checks; UI polish does not require new E2E tests or routine browser runs. Documentation-only changes do not need the application test suite.

Run `npm run format` after editing source. Regenerate `THIRD_PARTY_NOTICES.md` with `npm run licenses` after changing runtime dependencies. MIT compatibility includes fonts and bundled transitive dependencies; research references do not authorize copying an implementation.

For non-browser production checks, build and start the app in a separate terminal with `SERVER_PORT=4300 npm start`, then run `npm run test:production:http`. This checks built HTML/JS/CSS, production CSP and security headers, and configured-network discovery. `CHAINGRAPH_SMOKE_URL` selects a different production origin.

When browser QA is explicitly requested, install Chromium with `npx playwright install chromium`. Against that built server, `npm run test:production` runs the HTTP checks followed by a narrow browser runtime check: real bundled encryption-worker execution under production CSP, WebGL context initialization, and encrypted save, reload/unlock and export of a synthetic workspace. It does not establish visual usability or exercise every worker or panel. Use [deployment instructions](docs/deployment.md) for container validation.

The **Browser QA** workflow is manual only and publishes nothing. Choose `runtime` (the default), `selected-e2e` with one existing path such as `tests/e2e/tags.spec.ts`, or explicitly opt into `full-e2e`. A local selected run uses `npm run test:e2e -- tests/e2e/tags.spec.ts`; `npm run test:e2e` runs the full historical suite. Keep existing E2E journeys as optional diagnostics. When one breaks, assess whether it still protects valuable behavior before maintaining it. Routine UI work does not carry an obligation to keep every historical journey current. Plan broader exploratory browser QA when preparing a release or investigating a specific concern; the narrow runtime check does not replace that review.

## Parallel worktrees and previews

Each checkout needs its own `npm ci`, Vite cache and test output. Do not share `node_modules` through a symlink between worktrees. Assign distinct ports, for example:

```sh
CHAINGRAPH_E2E_PORT=4176 CHAINGRAPH_GRAPH_TEST_PORT=4186 npm run test:e2e
```

Defaults are 4173 for the browser application and 4184 for the controlled renderer fixture. Tests deliberately fail if their application port is occupied rather than silently testing another checkout. Run one browser suite at a time per checkout.

For a frontend-only preview against an existing backend:

```sh
CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4400 \
  node --use-system-ca node_modules/vite/bin/vite.js \
  --host 127.0.0.1 --port 3103 --strictPort
```

Vite preserves the browser-facing Host header so the backend can validate same-origin requests on local preview ports. A connected status alone does not prove that browser RPC requests are allowed. Test an actual transaction lookup. Keep the browser and API on the same preview origin through Vite's proxy; do not weaken production Origin checks to make a preview work. Non-loopback hostnames still need the exact frontend origin in the backend's `CORS_ALLOW_ORIGINS` configuration, as described in the deployment guide.

Browser storage is tied to each origin. Two preview ports have separate workspace lists. Use synthetic/public data for comparison or intentionally export/import an encrypted workspace.

## Review a change

Describe the user-visible problem, what changes, and the checks actually performed. Test complicated arithmetic, cryptography, protocol handling, cancellation, evidence semantics and storage failures with meaningful regressions. Prefer behavioral checks below the UI for durable contracts; do not move or rewrite tests merely to match a new test hierarchy.

Browser and screenshot validation require explicit user request or an agreed QA scope. Otherwise, run appropriate non-browser checks and state that visual validation was not performed. This applies to targeted browser checks as well as full suites. UI work or skill selection alone does not authorize these checks; do not pause to request them merely to satisfy a checklist.

When browser and screenshot validation is authorized for UI changes, exercise the real workflow with mouse and keyboard, inspect desktop/mobile screenshots within the agreed scope, and check that notes and primary actions remain easy to reach. Count clicks and scrolling, not just green assertions. Passing non-browser checks does not establish visual usability.

Independent reviews can start with skills, memory and repository instructions disabled when explicitly requested. Give those sessions the product, privacy and file-ownership constraints in their task. Keep alternative designs in separate branches; compare working previews before adopting a wholesale redesign. Review all generated diffs before integration.

Keep local experiments and review reports separate from the release claim. Do not publish or push just because a local check passed. The [release guide](docs/deployment.md#release-process) describes the tag workflow and its verification boundaries.

## Portable repository content

Use repository-relative file references in committed documentation. Resolve local
home directories at runtime in tools; do not commit a developer's absolute home
path, private hostname or temporary handoff filename. Required upstream license
attribution and documented public Bitcoin fixtures are retained intentionally.
Local recordings and browser artifacts belong in the ignored `artifacts/` directory.

`npm run check:portability` checks tracked text for hardcoded user-home paths and
rejects tracked environment files other than `.env.example`. It reports filenames
and line numbers without echoing matched contents, and never opens environment
files containing runtime credentials. The check runs as part of `npm run check`
in CI. It is a narrow portability check, not an exhaustive secret scanner or an
inspection of Git history; review new screenshots and configuration separately.
