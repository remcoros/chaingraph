# UI/usability finishing review: opus-foundation

Independent finishing review of the Chaingraph watch-only workbench at commit
`0b0b271` on branch `review/opus-foundation`. The brief was a fresh pass over the
real end-user flows plus small, bounded finishing fixes, not another wholesale
redesign. Coordinator studio / custom-renderer experiments were left untouched,
and the shared `GraphView` interactions and engine contract were preserved.

Scope reviewed: the shared `GraphView` / render-adapter boundary, the collapsible
transaction inputs/outputs panel above the canvas, the raw / script / witness
inspector, encrypted tags and wallet-match badges, returning-wallet refresh /
new-activity, and the seven analysis tools. Reviewed at 1440x900, 390x844 and
320px across navigation, filters, label/tag assignment, note drafts, inspector
reachability, menus, and empty / disconnected states, with mouse, keyboard and
touch.

## How it was validated

- Independent `npm ci` (195 packages, 0 vulnerabilities).
- Preview kept running on `http://127.0.0.1:3115` (Vite dev server, exclusive
  strict port), proxying `/api` to the existing backend on `127.0.0.1:4400`
  with `changeOrigin: false` so the browser-facing Host is preserved. No env
  files were read and TLS was not disabled.
- Backend on 4400 was reachable and connected (`{"network":"testnet4",
  "connected":true,"height":151457}`), so the public testnet4 example path was
  exercised live end to end.
- Synthetic 150/150 CoinJoin laboratory fixture is `workspace.demo = true`, so
  its lookups never reach the live backend (raw/witness loading is explicitly
  disabled and labelled "Synthetic fixture").
- Browser review driven with Playwright/Chromium (swiftshader) at all three
  viewports; force-directed layouts were allowed to settle before judging
  framing, per the brief.

Test evidence:

- `npm run build` (tsc `--noEmit` + vite build): passes.
- `npm test`: 203/203 unit tests pass.
- Baseline `npm run test:e2e` (`CHAINGRAPH_E2E_PORT=4209`): 46/46 pass. The
  panel-focused specs (`transaction-inspection.spec.ts`, `tracing.spec.ts`) ran
  after the CSS fix: 7/7 pass. The coordinator runs the combined suite after
  integration.
- `prettier --check` clean on the changed file.

The full reviewer path was walked and confirmed working: lookup a testnet4
example output -> select the output -> read the 2D input/output rows -> edit
label/notes and assign a tag -> open Scripts and raw transaction and load raw
scriptSig/witness/version/locktime/hex from the node -> find spending
transactions and load previous outputs -> run analysis -> restore the full graph.
The synthetic 150/150 fixture and wallet-refresh flows were exercised via the
demo workspace and the existing `wallet-refresh.spec.ts` suite (6/6).

## Finding and fix

### Trace action buttons were clipped in the transaction panel

`.transaction-view` (the "Transaction inputs & outputs" panel above the canvas)
was capped at `max-height: min(45%, 430px)` with `overflow: auto`. On a standard
1440x900 desktop the graph stage is ~623px tall, so 45% resolves to ~278px. Even
the smallest real transaction (1 input / 2 outputs) renders ~327px of content, so
the panel clipped its own footer: the primary trace actions **Load previous
outputs (1 level)** and **Check this output for spends**, plus the "Absence here
does not establish that an output is unspent" coverage caveat, were cut in half
at the fold and only reachable by scrolling inside a nested scroll region. This
read as a rendering glitch and hid the unspent-status caveat that the app is
otherwise careful to always surface.

Measured before (live testnet4 example, 1-in/2-out, desktop 1440x900):

```
clientHeight 278, scrollHeight 327, scrollable: true
Load previous outputs button: top 513, bottom 550  (panel visible bottom 537)
```

Fix: raise the cap to `max-height: min(65%, 460px)` in
`src/components/transaction-view.css`. This is a one-line, isolated change:

- The panel is `flex: 0 1 auto`, so it still sizes to its content and only the
  cap changed; normal transactions now show their footer without a scrollbar.
- The graph region keeps `flex: 1; min-height: 150px`, and the panel can still
  shrink (`flex-shrink: 1`), so the taller cap preserves a 150px graph region on short viewports and the panel scrolls
  instead. Shared controls occupy part of that region, so the actual canvas can
  be shorter; the coordinator separately fixed adaptive Fit margins for it.
- Large transactions (e.g. the 150/150 fixture) still cap and scroll as before,
  which is the intended behaviour for long lists.
- The mobile override (`@media (max-width: 700px) { max-height: 48% }`) is
  unchanged; phones are too short to fit a full transaction panel and keep their
  existing scroll behaviour.

Measured after:

```
small tx (1-in/2-out), desktop: clientHeight 327 == scrollHeight 327, scrollable: false
large tx (150/150), desktop:    clientHeight 403,  scrollHeight 486, scrollable: true (graph keeps 220px)
```

Before / after (public testnet4 example output, center column):

- `docs/screenshots/opus-foundation-tx-actions-before.png`
- `docs/screenshots/opus-foundation-tx-actions-after.png`

## Things checked and deliberately left as-is

- **Tags and wallet-match wording vs heuristics.** Verified this is already
  accurate and consistently distinct from the analysis heuristics, so no wording
  change was needed. Deterministic script-hash equality is worded as fact
  ("Wallet match" for outputs/addresses, tooltip "Script matches a derived wallet
  address"); a transaction that merely touches wallet outputs is worded as
  association ("Wallet-related transaction" / "Related", tooltip "Transaction
  associated with matched wallet outputs"), and none of it claims ownership. The
  analysis tools are separately badged "Observation" / "Hypothesis", and the
  wallet-intersections tool explicitly states it "does not identify real owners
  or assign particular inputs to particular outputs". No hypothetical compliance
  or warning flows were added.
- **Selecting an entity that a filter hides.** When the Entities filter is set to
  a single kind (e.g. Transactions), selecting an output from the transaction
  panel correctly reports "selection hidden by filters" and the inspector still
  shows it. This is honest filter behaviour, not a regression.
- **Transient empty canvas after a large filter change** (e.g. filtering 903
  nodes down to 3 in the demo). This is force-layout re-simulation plus camera
  fit settling, not a framing regression; the shared "Fit graph" control and
  auto-fit on filter change (`fitToken`) frame the result once the sim settles.
- **Duplicate trace actions.** The inspector's own "Load previous transactions" /
  "Find spending transactions" buttons remain the primary controls; the panel
  buttons operate on the currently displayed related transaction and are kept.

## Limits of this review

- The upstream node reachability produced one transient
  `"Bitcoin RPC connection failed"` before settling to connected; live queries
  worked thereafter. Deeper multi-hop tracing and wallet scanning against the
  live testnet4 node were only spot-checked via the curated example, not
  exhaustively.
- No screenshots contain personal wallets; all evidence is the synthetic
  laboratory fixture or the public testnet4 curated example.
- Review is bounded to the current worktree; root-owned files
  (README/.github/AGENTS/version/deployment) and the renderer experiments were
  not touched.
