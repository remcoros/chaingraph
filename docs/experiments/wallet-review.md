# Wallet review proposal

2026-09-09. Local experiment on `experiment/wallet-review`, stacked on
`experiment/simple-workbenches` at `1efa564`, which is a direct child of the
original `56eecb3` base. It adds a third compact workbench
for one selected wallet at a time. It does not change the renderer, the backend,
dependencies, the encryption format or the graph/analysis contracts.

## Problem

The immediate case is an old extended public key with no labels or a few
historical ones. The base branch can already import it, list its addresses,
transactions and current UTXOs, and analyse loaded data. What it cannot do is
tell the owner where to start, remember what was already dealt with, or let
context be recorded for more than one record at a time.

## What changes

- **Wallet workbench.** `Wallet | Graph | Analysis` navigation. The Wallet
  workbench selects one wallet, offers a switcher across imported wallets and
  reuses the existing import, scan and record code. The right-panel wallet tabs
  in Graph are unchanged, so records stay reachable from the canvas.
- **Coverage, not a score.** Last check and partial discovery, used and
  discovered addresses, loaded versus known transactions, and the current UTXO
  count and balance from a verified Electrum check. No completeness percentage is
  invented. When no check has run the queue says so and offers the action.
- **A derived review queue.** `domain/walletReview.ts` builds items from loaded
  observations in a fixed priority: current UTXOs, unlabelled receipts that were
  spent into those UTXOs, new activity from a refresh, unknown counterparties,
  and existing analysis findings that cover verified wallet outputs. Each item
  carries its reason, evidence and amount. Nothing requires labelling the whole
  history first.
- **Resumable decisions.** Mark reviewed, Reviewed/source unknown and Review
  later are stored per item in the encrypted workspace under the optional
  `walletReviews` field, keyed by `walletId|reason|subject`. Unknown is a
  completed review, not a failure. Reopen clears a decision. Deciding a new
  activity item also acknowledges that transaction in the wallet's existing
  unreviewed queue, in the same update.
- **Evidence invalidation.** Each decision stores a fingerprint of the
  observations behind its item. A refresh preserves decisions; only an item whose
  evidence actually changed is flagged, with an explanation and the date of the
  earlier decision. A scan never resets the queue.
- **Batch metadata.** Records offers UTXOs, Transactions and Addresses with
  filters for text, labelled/unlabelled, reviewed/unreviewed and tag, plus counts.
  Rows carry checkboxes and an explicit `Select N matching`. `domain/batchMetadata.ts`
  provides ID-based label, tag and icon helpers that each return one workspace,
  so a batch is a single undoable, autosaved step. Labels and icons are preserved
  by default; replacement is an explicit checkbox and the affected count is shown
  before applying. Tag creation and the icon palette reuse the existing controls.
- **Scope safety.** The selection is an explicit list of IDs from the selected
  wallet's own records. Filtering never widens it, and records selected outside
  the current filter are reported rather than silently dropped. Switching the
  record kind clears the selection, and switching wallet or workspace remounts
  the workbench with an empty selection.
- **Separated ideas.** Wallet membership comes from verified derived addresses.
  Spends come from exact recorded outpoints. Counterparty items are offered only
  for outputs of transactions this wallet funded, so the outputs of a batch that
  merely paid the wallet are never presented as the owner's counterparties.
  Grouping items are the existing analysis findings, described as hypotheses with
  their evidence. When no finding applies, the workbench says grouping is unknown
  and links to Analysis instead of inventing a result.
- **Handoffs.** Review items and record rows have Show in Graph, Inspect and
  Analyze. They carry the wallet and entity through the existing workbench
  mechanism, and Graph and Analysis both show `Back to Wallet`. Analysis uses the
  selected item or the selected wallet as its scope.
- **Optional guidance.** When the selected UTXOs carry different recorded sources,
  one sentence says that combining them in an ordinary spend would publish that
  link. No score, probability, privacy guarantee, spend composer, fee estimate,
  PSBT, signing or broadcast is added.

## Validation

Browser runs were serial in this checkout on frontend port 4191 with the graph
fixture port set to 4192. The preview runs separately on 3119 against the
existing read-only backend.

- 538 domain tests pass across 48 files, including 22 new tests in
  `wallet-review.test.ts` and `batch-metadata.test.ts`. These cover queue
  priority, counterparty scoping, unloaded UTXO sources, rejected UTXO
  observations that disagree with a loaded transaction, finding selection,
  decision persistence and evidence invalidation, activity acknowledgment,
  cross-wallet key isolation, schema round-tripping with older workspaces,
  batch target scope and preservation, single-result batches, canonical and
  invalid references, and the guidance sentence.
- Six new browser journeys pass in `wallet-review.spec.ts`: the derived queue
  with lock, reload and unlock; batch label, tag and icon with three Undo steps;
  Graph and Analysis handoff with return; a refresh that keeps decisions, flags
  new activity and stays inside one wallet; and a phone viewport check that the
  batch editor is inside the visible viewport and closes on Escape. The sixth
  checks that a keyboard handoff moves focus into Graph and that `Back to Wallet`
  returns focus to the exact control that started it.
- Fresh desktop (1440x1000) and phone (390x844) screenshots were inspected in
  ignored `artifacts/wallet-review/`. The review fixed a colliding `.wallet-row`
  class that broke record row layout, an icon control that stacked its label and
  checkbox, a `Back to Wallet` control that the floating workspace actions
  covered, a decision confirmation that appeared far from the queue, duplicated
  reason text and raw 64-character identifiers in the detail panel, and singular
  wording in the guidance sentence.
- Build and typecheck pass. One real public mainnet transaction lookup through
  preview port 3119 returned the expected transaction through both the Core and
  Electrum paths. This shows preview RPC works through the existing backend; it
  is not a live wallet scan.

## Limits

The queue is derived from loaded data and one bounded UTXO check. Unloaded
ancestry, undiscovered addresses and unloaded spenders limit it, and the
workbench reports that rather than filling the gap. A missing spend is never
evidence that an output is unspent. UTXO observations stay transient and are
re-checked when the workbench is opened or the wallet changes; they are not
stored. Item counts are bounded per reason, so a very large wallet shows a
prioritised subset. Grouping is only as good as the last analysis scan.

Review decisions are personal bookkeeping. They are not chain facts, they do not
change annotations, tags or findings, and they never establish ownership.

This is a local proposal, not a release claim. No push, merge or publication was
performed.

## Upstream incorporation

Shared finding RUX-001, keyboard focus lost on Analysis and Graph evidence
navigation and return, belongs to the base branch and was fixed upstream at
`1efa564`. It is not reimplemented here. With root authorisation this branch was
rebased onto that exact commit. The conflict resolution kept the accepted focus
contract unchanged and only generalised it: the single Analysis invoker reference
became a per-origin map, `switchWorkbench` keeps its `handoffFocus` argument, and
the Wallet section gained a focus target so its handoffs and `Back to Wallet` use
the same behaviour. The upstream focus regressions in `analysis-state.spec.ts` and
`simple-workbenches.spec.ts` pass unchanged on the rebased snapshot.

## Review round one

Independent acceptance on `a9758be` reported five wallet-owned issues. All are
fixed in one batch, with the reviewer's identifiers retained.

- **RUX-002.** Review later acknowledged refreshed activity, so a deferred item
  left the wallet's unreviewed queue and disappeared from every view. Deferral is
  now explicitly not completion: only `reviewed` and `unknown` acknowledge. A new
  `isCompletedReview` predicate drives both the queue's Reviewed filter and the
  Records Reviewed/Unreviewed filters, so a deferred record reads as outstanding.
- **RUX-003.** The per-reason bound was applied before decisions were considered,
  so 401 current UTXOs with the first 400 reviewed produced an empty queue while
  Records still listed one unreviewed record. Candidates are now collected first,
  unresolved ones are selected ahead of settled ones, and anything beyond the
  bound is reported as an explicit count with a Load more records continuation.
  The empty state can no longer claim completion while records remain unlisted.
- **RUX-004.** Batch editors are mutually exclusive: opening the icon palette
  closes the label or tag popover instead of stacking a second focus trap, and
  creating and assigning a tag closes its editor and returns focus to the trigger.
- **RUX-005.** A Wallet Inspect handoff reveals the Inspector, so its focus
  destination is the Inspector rather than the graph canvas, which is hidden
  behind the mobile panel switch at phone widths. The accepted Analysis and Graph
  focus contract is untouched.
- **RUX-P02.** Queue rows keep real button semantics with their pressed state
  inside a list item wrapper.

Regressions added: four domain cases covering deferral versus completion, the
completion predicate, the 401-record bound with its continuation, and a deferred
record kept ahead of settled ones; four browser journeys covering deferral across
queue filters, Records filters, a flushed save and reload, non-stacking batch
editors with keyboard palette navigation, phone keyboard Inspect focus, and row
button semantics.

## Reported, not fixed here

Two `workbench.spec.ts` checks failed identically on the unmodified `56eecb3`
base and on this branch. They are pre-existing base issues outside this slice and
were left alone; the shared owner corrected those test assertions separately in
`eb47b39`, which root will bring into a later integration.
