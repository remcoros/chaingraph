# Wallet tabs, direct relationships and explicit editing

## Review guidance and detail polish

This pass follows the merged prevout integration (`2ce0675`). The transaction
chooser no longer has a redundant Context caption, and its copy control stays on
the same line. Flow columns now give the transaction a comparable card width.
Related-record graph actions sit directly beside their references.

The side panel groups information in a labelled details card: address/outpoint,
wallet relationship, activity, amount and tags. A short review sentence explains
the missing context and next action, updating after labels or tags change.
Known source addresses no longer appear unresolved before a flow context is chosen.
The initial review waits for its first UTXO observation before picking a default.

Used wallet addresses now have independent address-only reviews, without queuing
unused gap-discovery addresses or acknowledging their UTXOs. New individual
funding/counterparty output tasks are removed; compatible saved decisions remain
as history under Previous output decisions rather than reappearing as new work.
No Parties/Entities model was introduced.

TypeScript and 62 focused review/category/row/guidance tests passed after adapting
the old output-task expectations to the new workflow. Fresh public-fixture
screenshots at 1440 x 900 and 390 x 844 are under
`artifacts/wallet-guidance-polish/`. The chooser/copy vertical centres align and
the related graph action is 3 px from its reference controls on both viewports.
No page errors or horizontal document overflow appeared in those sessions.
This was a bounded visual pass, not a full browser suite or live-wallet scan.

## Earlier counterparty refinement

The side toolbar now follows Label / Tags / Icon, review decisions, Select related,
then Show / Isolate. Inspect and Scan are removed from the side toolbar; the
Wallet-wide Scan remains above the tabs. Related transactions and outpoints are
visible lists rather than a generic collapsed evidence description.

Sources and Destinations show only addresses not matching the selected wallet.
Sources resolve missing input transactions in a bounded background batch, with
explicit continuation and retry instead of unresolved outpoint rows. The UI
reports address search limits, queued history and failed input lookups separately;
inapplicable analysis tools no longer create a permanent partial-scan label.

Select all (N) toggles to Unselect all (N). Shortened Bitcoin references have copy
controls and full-value titles. Useful help is now a hover/focus/touch tooltip,
without a modal or focus trap; generic selection help was removed.

A code-level performance pass avoids hidden Wallet rerenders, reuses tag indexes,
builds only the active record tab and avoids repeated derivation on view/camera
changes. Counterparty validation now uses linear lookups rather than repeated
input/output scans. No browser timing claim is made.

Only basic checks are being used for this refinement. Browser suites, screenshots
and final visual QA remain deferred until manual layout approval. The independent
Core prevout/shared-resolver work has not been imported or rebased into this diff.
TypeScript, scoped formatting and the focused counterparty, selection, coverage,
related-record and control regressions passed. The tooltip control assertion was
updated to require a focusable non-button help icon and the new copy controls.
Root's separately committed scrollbar and password-tab fixes remain intact.

## Earlier address-first iteration

Subsequent manual feedback changes the primary Sources/Destinations targets from
individual outputs to grouped addresses and moves compact actions above a
collapsible flow. It also requests direct Wallet Scan, concise accessible help
and bounded visible-input loading. This iteration is intentionally limited to
basic type/format and narrow domain checks. The browser results and screenshots
below describe the earlier output-row layout, not approval of the current layout.
Final browser and visual QA is deferred until the user agrees the main UX.

The current changes are implemented: address groups and direction-specific review
keys, compact action-first details, accessible question-mark help, a real local
Wallet Scan action, and visible-input loading in 20-parent waves with four
concurrent requests. Cached merges are no-ops; new observations retain focused
input context and use the existing evidence invalidation path.

Basic checks passed: TypeScript, scoped formatting, 58 focused address/review/
category tests, 22 flow/control tests, and a 22-case targeted follow-up covering
row projection, related selection, scan scope and input planning/merging. Some
tests overlap between those commands. No browser suites, screenshot passes or
production build were run for this layout iteration. The earlier browser
assertions still need adaptation and final execution after layout agreement.

## Earlier validated iteration

This implementation replaces the intermediate Records navigation with one Wallet
tab row: To review, UTXOs, Transactions, Addresses, Sources and Destinations.
All tabs share the same selectable list and single/batch detail footprint.

## Behavior

- A normal row click opens single-item details. Checkboxes, Ctrl/Command toggles
  and Shift ranges open batch details without changing the list width. Unique
  metadata targets and hidden selections remain explicit beside the actions.
- Compact icon buttons show the current, mixed or empty state beside `Icon`.
  Label, tag and icon editors retain their keyboard and deactivation behavior.
- The full-width transaction flow precedes the selected entity's details.
  Cards are not clickable. Named magnifiers reveal and frame their exact entity
  in Graph even with selection lock off, and Back restores the invoker.
- Identifiers and tags are always visible. Address flows with multiple verified
  loaded transaction contexts require an explicit choice.
- New review decisions use Mark reviewed and Review later. Return to review and
  Reopen preserve the existing lifecycle. Encrypted `unknown` decisions remain
  completed and discoverable under Reviewed.
- The finding-type filter includes all 18 supported categories, including zero
  counts. Multiple categories match by union. Counts precede the type filter but
  follow the other filters, so overlapping counts are not additive. Missing
  labels, missing effective tags, and missing both are separate conditions.
  Session scan state and partial observations qualify the counts.
- Sources and Destinations are local one-hop projections using verified scripts
  and exact loaded outpoints. Canonical subjects retain relationship transaction
  contexts. Missing prevouts, coinbase inputs and unusable outpoints are reported.
  An earlier wallet receipt is not presented as an exchange identity, and a
  no-match script does not prove external ownership or exact coin allocation.

## Validation

The integrated focused domain/control command passed 96 tests:

```sh
npm test -- --run \
  tests/wallet-workbench-rows.test.ts tests/wallet-relationships.test.ts \
  tests/wallet-review-categories.test.ts tests/wallet-review.test.ts \
  tests/wallet-review-context.test.ts tests/wallet-records.test.ts \
  tests/wallet-review-controls.test.ts tests/batch-metadata.test.ts \
  tests/batch-edits.test.ts
```

Browser journeys ran serially on dedicated port 4199 with renderer fixture port
4200. The initial three-file Wallet run covered 43 distinct journeys: 34 passed
and nine stopped on test adaptations. The adaptations corrected whitespace in
ordered accessible tab names, partial-count suffixes, and subpixel scroll
rounding. No semantic expectation was removed.

```sh
CHAINGRAPH_E2E_PORT=4199 CHAINGRAPH_GRAPH_TEST_PORT=4200 \
  npm run test:e2e -- tests/e2e/wallet-review.spec.ts \
  tests/e2e/wallet-name.spec.ts tests/e2e/wallet-records.spec.ts --workers=1
```

All nine were covered by a 14-case follow-up, which passed:

```sh
CHAINGRAPH_E2E_PORT=4199 CHAINGRAPH_GRAPH_TEST_PORT=4200 \
  npx playwright test tests/e2e/wallet-review.spec.ts \
  --grep 'fixed list|context distinguishes|late selected|finding types|explicit verified|one-hop|related selection|range selection'
```

The one-hop Sources/Destinations case also passed once more after tightening the
source-row wording to distinguish a wallet funding input from possible change.

Across those runs, the coverage includes all six tabs' direct and batch metadata
updates and encrypted persistence; legacy unknown decisions; category OR/none/
reset and zero counts; fixed selection footprints; exact related scopes; current
wallet isolation; editor lifetime; lock-off camera framing and return focus;
cached navigation preserving Undo/findings; and changed-evidence invalidation.
The existing wallet-name and Graph wallet-record journeys were retained.

Build/typecheck, scoped Prettier, portability and diff whitespace checks passed.
Fresh manual public-fixture sessions on the existing frontend at
`http://127.0.0.1:3001` supplied desktop 1440 x 900 and phone 390 x 844 screenshots.
The list kept its width during batch selection, and neither viewport had
horizontal document overflow.

Local screenshots and structured observations are in
`artifacts/wallet-six-tabs/`, including `desktop-initial.png`, `desktop-batch.png`,
`phone-categories.png`, `phone-sources.png` and `manual-results.json`.

## Limits and boundaries

These are synthetic public fixtures with browser API interception, not live
upstream scans or native-device certification. Source/destination relationships
use loaded one-hop evidence; missing data can hide other relationships.
No deep trace algorithm, backend persistence/index, signing or spending was added.
No credential files were read and no source changes were committed or published
by this implementation. The existing frontend/backend processes and the separate
landing-page scrollbar commit were left in place.
