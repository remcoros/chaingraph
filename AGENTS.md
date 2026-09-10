# Chaingraph agent guide

Chaingraph is a standalone MIT-licensed Bitcoin application. This repository owns
the application, tests and deployment configuration. Unrelated parent-folder
packaging workflows do not apply here.

## Product and boundaries

- Read `README.md`, `docs/architecture.md`, and the relevant module before changing it.
- Build a self-hosted personal wallet, UTXO and label-management tool with on-chain
  analysis for individuals and hobbyists. Wallet, Graph and Analysis workbenches
  share evidence, selection and metadata; keep their workflows coherent and compact.
- Workspaces own multiple watch-only wallets. The browser owns derivation, discovery,
  loaded chain data, annotations, analysis, and encrypted persistence.
- The backend only provides bounded read-only Core/Electrum access. No server database,
  wallet storage, scan jobs, indexes, or workspace cache. Each configured network has
  an isolated Core/Electrum pair; mainnet and testnet4 may run simultaneously.
- Support mainnet and testnet4; validate the network at all import and RPC boundaries.
- Keep observations, human annotations, and heuristic hypotheses distinct. Never call
  a cluster proof of common ownership; preserve evidence and allow removal.
- Use subagents for independent modules/reviews with explicit file ownership.
- Explicitly requested clean reviews must not inherit skills, memory or this guide;
  supply the essential product/privacy constraints in their standalone task.
- Keep experiments in their requested worktrees with separate preview ports. Treat
  scope and test budgets as task instructions that the user can revise, not fixed
  restrictions in an agent's startup configuration. Merge only when requested.

## Working safely

- Keep committed code, documentation and screenshots free of personal account names,
  absolute user-home paths, private hostnames and machine-specific handoff locations.
  Use repository-relative references, runtime home-directory discovery or explicit
  placeholders. Preserve required upstream attribution and documented public fixtures.
  Run `npm run check:portability` before committing; this narrow check does not replace
  a credential review. Keep local recordings and browser artifacts under `artifacts/`.

- Never open, display, copy, or commit real `.env.live`, `.env.mainnet`, or `.env.testnet4` files.
  Test processes may load them directly without logging credentials, URLs, headers,
  or raw upstream exception messages. Public synthetic fixtures are allowed.
- No private keys, seed import, signing, spending, or wallet-mutating RPC methods.
- Workspace names are intentionally public in the saved index. Descriptions, xpubs,
  graph data and notes belong inside the encrypted envelope.
  Passwords and decrypted state live only in memory. Do not log them.
- Keep workspace validation/encryption off the browser UI thread. Camera gestures
  must defer snapshots and autosaves; lock/export/switch must capture the latest view.
  Renderer changes need gesture, flush and save-failure regression checks.
- Prefer vetted Bitcoin primitives and WebCrypto to custom cryptography. Test vectors,
  tampering, network mismatch, cancellations, and storage failure paths matter.
- MIT application code only. Check dependency and source licenses before reuse.
  Research references are not authorization to copy incompatible implementations.
- Keep external research in `docs/research/` with direct primary-source links, date,
  applicability, and limits. Record decisions in architecture docs, not TODO files.

## Development

- Node 24+, TypeScript, React/Vite, a Three.js graph renderer, and a Node HTTP proxy.
- `npm run dev` starts the app and proxy; `npm run dev:live` uses the same isolated per-network file discovery as `dev`;
  `.env.live` is not a runtime fallback. Production: `npm run build && npm start`.
- `npm run build` checks types and builds; `npm test` runs domain/backend tests;
  `npm run test:e2e` runs browser journeys. Match checks to the change and current
  user instructions. Documentation-only edits do not need an application test suite.
- Agents normally run focused checks, not full end-to-end/browser suites. Run a full
  browser suite only when explicitly requested or included in an agreed release/QA
  pass. A targeted browser regression or small visual check is appropriate when it
  verifies the change; avoid repeating broad checks during iteration. This default
  does not prohibit `npm test`, and later user instructions can expand validation.
- Test complex domain/security logic and end-to-end user workflows; avoid tests that
  merely repeat implementation. Exercise real services read-only when available.
- State exactly what was validated. A build or mocked RPC test is not live validation.
- Keep README and user instructions in sync with changes. Preserve unrelated files.
- Do not assume that passing checks makes a UI usable. Inspect screenshots and trace
  real editing/navigation tasks. Explicit redesign requests may change the layout
  and renderer; preserve data contracts and compare isolated working proposals.
- Keep renderer mechanics separate from selection, metadata and workspace logic.
  Prefer loaded or attached prevout evidence before fetching parents; distinguish
  missing evidence from zero values, unspent outputs or ownership conclusions.
- Do not use em dashes in authored copy.

For substantial UI work, when visual validation is in the requested scope, use the local review checklist in
`.agents/skills/chaingraph-ui-review/SKILL.md`, inspect fresh-context screenshots,
and run browser suites serially within a checkout. See `CONTRIBUTING.md` for separate
worktree dependencies and preview/test ports. Release commands and validation are
documented in `docs/deployment.md`; do not assume a publication destination.
