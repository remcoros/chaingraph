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

The synthetic laboratory works without an upstream connection. Use public key vectors or synthetic data for reproducible tests, and never commit environment files, wallet exports, credentials or personal browser artifacts.

```sh
npm run format:check
npm run check
npx playwright install chromium
npm run test:e2e
node scripts/release-check.mjs
```

Run `npm run format` after editing source. Regenerate `THIRD_PARTY_NOTICES.md` with `npm run licenses` after changing runtime dependencies. MIT compatibility includes fonts and bundled transitive dependencies; research references do not authorize copying an implementation.

To check the built application and its production security headers, start it in a separate terminal with `SERVER_PORT=4300 npm start` after building, then run `npm run test:production`. That browser smoke intercepts chain requests with public fixtures while serving real built assets. `CHAINGRAPH_SMOKE_URL` selects a different production origin. Use [deployment instructions](docs/deployment.md) for actual container validation.

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

Describe the user-visible problem, what changes, and the checks actually performed. Test complicated arithmetic, cryptography, protocol handling and storage failures with meaningful regressions. For UI changes, exercise the real workflow with mouse and keyboard, inspect desktop/mobile screenshots, and check that notes and primary actions remain easy to reach. Count clicks and scrolling, not just green assertions.

Independent reviews can start with skills, memory and repository instructions disabled when explicitly requested. Give those sessions the product, privacy and file-ownership constraints in their task. Keep alternative designs in separate branches; compare working previews before adopting a wholesale redesign. Review all generated diffs before integration.

Keep local experiments and review reports separate from the release claim. Do not publish or push just because a local check passed. The [release guide](docs/deployment.md#release-process) describes the tag workflow and its verification boundaries.
