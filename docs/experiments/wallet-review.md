# Wallet review proposal

2026-09-09. Local experiment on `experiment/wallet-review`, stacked on
`experiment/simple-workbenches` at `56eecb3`. It adds a third compact workbench
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
- Five new browser journeys pass in `wallet-review.spec.ts`: the derived queue
  with lock, reload and unlock; batch label, tag and icon with three Undo steps;
  Graph and Analysis handoff with return; a refresh that keeps decisions, flags
  new activity and stays inside one wallet; and a phone viewport check that the
  batch editor is inside the visible viewport and closes on Escape.
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

## Upstream dependency

Shared finding RUX-001, keyboard focus lost on Analysis and Graph evidence
navigation and return, belongs to the base branch and is fixed upstream at
`1efa564` on `experiment/simple-workbenches`. It is deliberately not reimplemented
here. The Wallet handoffs use the same selection and return contract as the
existing Analysis handoff, so that fix is expected to extend to them when root
authorises importing the upstream commit.
