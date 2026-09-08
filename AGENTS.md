# Chaingraph agent guide

Chaingraph is an MIT-licensed application, not a StartOS package. The parent
workspace's packaging instructions apply when creating a separate package wrapper,
not when scaffolding this upstream application.

## Product and boundaries

- Read `README.md`, `docs/architecture.md`, and the relevant module before changing it.
- Build a self-hosted wallet analysis workbench, not a block explorer/dashboard.
- Workspaces own multiple watch-only wallets. The browser owns derivation, discovery,
  loaded chain data, annotations, analysis, and encrypted persistence.
- The backend only provides bounded read-only Core/Electrum access. No server database,
  wallet storage, scan jobs, indexes, or workspace cache. One network per backend pair.
- Support mainnet and testnet4; validate the network at all import and RPC boundaries.
- Keep observations, human annotations, and heuristic hypotheses distinct. Never call
  a cluster proof of common ownership; preserve evidence and allow removal.
- Use subagents for independent modules/reviews with explicit file ownership.
- Explicitly requested clean reviews must not inherit skills, memory or this guide;
  supply the essential product/privacy constraints in their standalone task.

## Working safely

- Never open, display, copy, or commit `.env.live`. Test processes may load it directly
  without logging credentials, URLs, headers, or raw upstream exception messages.
- No private keys, seed import, signing, spending, or wallet-mutating RPC methods.
- Workspace names are intentionally public in the saved index. Descriptions, xpubs,
  graph data and notes belong inside the encrypted envelope.
  Passwords and decrypted state live only in memory. Do not log them.
- Prefer vetted Bitcoin primitives and WebCrypto to custom cryptography. Test vectors,
  tampering, network mismatch, cancellations, and storage failure paths matter.
- MIT application code only. Check dependency and source licenses before reuse.
  Research references are not authorization to copy incompatible implementations.
- Keep external research in `docs/research/` with direct primary-source links, date,
  applicability, and limits. Record decisions in architecture docs, not TODO files.

## Development

- Node 24+, TypeScript, React/Vite, Three.js/3d-force-graph, Node HTTP proxy.
- `npm run dev` starts the app and proxy; `npm run dev:live` loads existing credentials
  into the backend process only. Production: `npm run build && npm start`.
- `npm run build`, `npm test`, `npm run test:e2e` are the verification gates.
- Test complex domain/security logic and end-to-end user workflows; avoid tests that
  merely repeat implementation. Exercise real services read-only when available.
- State exactly what was validated. A build or mocked RPC test is not live validation.
- Keep README and user instructions in sync with changes. Preserve unrelated files.
- Do not assume that passing checks makes a UI usable. Inspect screenshots and trace
  real editing/navigation tasks. Explicit redesign requests may change the layout
  and renderer; preserve data contracts and compare isolated working proposals.
- Do not use em dashes in authored copy.

For substantial UI work, use the local review checklist in
`.agents/skills/chaingraph-ui-review/SKILL.md`, inspect fresh-context screenshots,
and run browser suites serially within a checkout. See `CONTRIBUTING.md` for separate
worktree dependencies and preview/test ports. Release commands and validation are
documented in `docs/deployment.md`; do not assume a publication destination.
