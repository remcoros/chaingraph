# Loaded wallet row selection performance

Date: 2026-09-09. Local development application with public synthetic data.

## Cause and fix

Selecting a row remounts its detail panel to reset record-specific state. The
panel rebuilt the previous-output index and verified wallet addresses on each
mount. Address selection additionally scanned and decoded every loaded output
and resolved input to find transaction contexts. Visible-input planning repeated
the previous-output scan, including for an empty input list. These synchronous
operations delayed rendering even when all data was already loaded.

`WalletReview` now owns reusable transaction/script/prevout and wallet-address
indexes above the keyed detail panel. Context lookup, related records and visible
input planning reuse them. Their memo keys track transactions, addresses and
network, so new observations invalidate the relevant projection. Metadata edits
and row navigation reuse loaded facts. Status counts, related-selection candidates
and tag lookup also avoid redundant work. Clearing an empty batch selection no
longer creates another empty state value.

The projection lives only in component memory. No workspace schema, persistence,
backend behavior, evidence classification or automatic request scope changed.
Mutation-time evidence merges still validate against the current workspace.

## Measurement

The browser fixture contains 600 addresses derived from the published BIP84 test
key and 1,800 synthetic loaded transactions. Mainnet is unavailable in the mocked
backend configuration, exercising offline navigation. Five warmed row clicks per
tab measure native click dispatch through two animation frames, with Chromium
CPU profiling enabled. Each click verifies the selected row's pressed state.

| Row type | Before median | After median |
| --- | ---: | ---: |
| Addresses | 700.2 ms | 15.7 ms |
| Transactions | 84.2 ms | 50.7 ms |

No RPC requests occurred. Address selection's whole-history decoding disappeared
from the after profile. The test enforces a 250 ms warmed median ceiling; this is
a regression guard, not a hardware-independent latency guarantee. Initial wallet
opening and index construction are outside the timed clicks. This is neither a
real-wallet benchmark nor live-service validation.

Profiles, timings and the inspected fresh-context screenshot are under ignored
`artifacts/wallet-selection-performance/`. The screenshot confirms the selected
address, three available transaction contexts, 600 used addresses and 1,800 loaded
transactions, with metadata actions visible inside the detail panel.

## Validation

- Production build, changed-code formatting and portability checks passed.
- All 701 unit tests passed. New tests compare cached and uncached projections,
  including script authority, uppercase addresses, wrong networks, invalid map
  keys, loaded/attached/conflicting prevouts and immutable evidence refresh.
- Proxy guards reject full transaction enumeration during repeated indexed
  selection and visible-input planning, independent of timing variance.
- The new large-wallet browser performance test passed.
- Wallet To review, UTXOs, Transactions and Addresses browser editing workflows
  passed, including direct/batch metadata edits and encrypted reopening.
- The browser refresh scenario passed, preserving review decisions, exposing new
  activity and keeping wallet scopes separate.
- Shared quick editors passed at 1440px, 390px and 320px, including long tag names,
  explicit colors and notes surviving immediate lock and encrypted reopening.
- The address-context browser regression passed after updating stale copy
  assertions. It rejects history-only associations, requires explicit transaction
  choice, checks missing-prevout and wallet-match displays, and edits the selected
  transaction label in both list and flow. Its fresh screenshot was inspected.
- An independent integration review found no index-lifecycle, asynchronous
  evidence-merge or selection-anchor regressions.

The full browser gate is not green. Existing Sources/Destinations metadata
fixtures still assume outpoint rows instead of address groups. The Sources case
failed that lookup in this pass; Destinations was interrupted. Older related
selection controls also need fixture updates. Earlier unrelated browser failures
are recorded in the [quick editor review](2026-09-09-quick-edit-consistency.md).
