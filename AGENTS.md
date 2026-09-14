# Chaingraph agent guide

Chaingraph is an MIT-licensed, self-hosted, watch-only Bitcoin workbench for
personal wallets and on-chain investigation. Read `README.md`,
`docs/architecture.md` and the module you are changing before editing it.
`CONTRIBUTING.md` has the commands, worktree conventions and review expectations.
Use `docs/source-map.md` to locate the product area and relevant tests before
searching across the repository. UI and its owned helpers live under
`src/App/Workspace/Workbenches/`; shared domain and infrastructure code live
under `src/Domain/` and `src/Infra/`. Follow direct imports from the affected area.

## Product boundaries

- The browser owns derivation, scanning, loaded chain data, annotations,
  analysis and encrypted persistence. The backend is a bounded read-only
  Core/Electrum proxy with no database, wallet storage, jobs, index or cache.
- Mainnet and testnet4 are supported, each through an isolated Core/Electrum
  pair, possibly at the same time. Validate the network at every import and RPC
  boundary.
- Keep observations, human annotations and heuristic hypotheses distinct. Never
  present a cluster or a wallet match as proof of ownership. Missing evidence is
  unknown, not zero or unspent. Preserve evidence and allow removal.
- No private keys, seed import, signing, spending or wallet-mutating RPC.
- Workspace names are public in the saved index; everything else belongs inside
  the encrypted envelope. Passwords and decrypted state live only in memory and
  are never logged.
- Wallet, Graph and Analysis share evidence, selection and metadata. Keep
  renderer mechanics separate from selection, metadata and workspace logic.

## Working safely

- Never open, display, copy or commit real `.env.mainnet` or `.env.testnet4`
  files. Tests may load them without logging credentials, URLs, headers or raw
  upstream error text. Public synthetic fixtures are fine.
- Keep committed content free of personal account names, absolute home paths,
  private hostnames and machine-specific paths. `npm run check:portability`
  catches the common cases; it is not a credential scan. Local recordings and
  browser output go under the ignored `artifacts/`.
- Prefer vetted Bitcoin primitives and WebCrypto over custom cryptography. Test
  vectors, tampering, network mismatch, cancellation and storage failures.
- Keep workspace validation and encryption off the UI thread. Camera gestures
  defer snapshots and autosave; lock, export and switch capture the latest view.
- MIT-compatible code only. Research references never authorize copying an
  incompatible implementation. Regenerate `THIRD_PARTY_NOTICES.md` after
  dependency changes.
- Credit external sources in `docs/references.md` and record decisions and their
  reasoning in `docs/architecture.md` or the topic notes under `docs/`. The
  ignored `docs/research/`, `docs/reviews/` and `docs/experiments/` folders are
  personal working notes and are not part of the published repository.

## Validation

- `npm run check` (portability, linting, build, domain and integration tests) is
  the routine gate and must pass without lint errors. Engine or data changes
  need relevant behavioral tests; UI polish does not need new E2E coverage.
  Documentation-only edits need no test run.
- Keep to the tools the repository already has. Do not add a linter, test
  framework, build step or runtime dependency in order to finish a task. When
  one would genuinely help, report it instead of quietly working around it:
  name the gap it would close, what adopting it would cost, and what the work
  settled for in its absence. An unreported gap is the failure this rule guards
  against, not the missing tool.
- Do not suppress a lint diagnostic merely to make the check pass. A suppression
  is allowed only when the diagnostic is demonstrably incorrect, or when a
  deliberate technical decision accepts it, such as a measured performance or
  compatibility tradeoff. Keep suppressions as narrow as possible and add a
  concise comment directly beside each suppression explaining the reason.
- Browser and screenshot validation happen only on explicit request or within an
  agreed QA scope. Otherwise run non-browser checks and say that visual
  validation was not performed. Do not pause merely to ask for it.
- State exactly what was validated. A build or mocked RPC test is not live
  validation, and passing non-browser checks does not establish visual usability.
- Keep `README.md` and `docs/user-guide.md` in sync with behavior changes.

## Conventions

- Do not use em dashes in authored copy.
- Use `.agents/skills/product-ui-design/SKILL.md` before UI work, and
  `.agents/skills/chaingraph-ui-review/SKILL.md` when browser validation is in
  scope.
- Independent reviews requested without skills, memory or this guide must
  receive the product and privacy constraints above in their task.
