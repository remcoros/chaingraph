# Wallet QF fixes

Implemented 2026-09-09 in this worktree. Task input: the preserved `REVIEW.md` and public demo export only. Project-local instructions, skills, other reviews and memory were not loaded.

## Branch and preview

- Base: local `main`, `d425d91711ec929fb090e450d7d3f0eb68e7ed37`. Tracked files were clean before branching. No remotes were configured.
- Head: `fix/wallet-qf-findings`, the single implementation commit containing this document (`git rev-parse fix/wallet-qf-findings`). Its parent is the base above.
- Preserved review branch: `review/wallet-clean-qf`, `2ce067576bde9630f535fa7c89830624d3ebbcd0`.
- Preview: http://127.0.0.1:3123. Backend: http://127.0.0.1:4123.
- Both ports were free at startup. New owned backend PID 3212889 and frontend PID 3212903 were verified by listening port and process working directory. Both remain running from this worktree. Verify ownership again before stopping either.
- No merge, push, publication, other-worktree changes, or wallet discovery refresh was performed. Backend runtime alone loaded network configuration.

## Findings

| Finding | Status | Changes |
| --- | --- | --- |
| WQF-001 | Fixed | `matchesWalletStatus` admits an item to To review only when a non-legacy review decision is open or evidence changed. Transactions without decisions remain browseable in All items without a fabricated backlog. Saved deferred/completed legacy decisions remain visible. No evidence or decisions are written by filtering. |
| WQF-002 | Partly already resolved upstream; remaining distinctions fixed | Main had removed the incorrect “Unresolved script” badge. The detail relationship now checks verified wallet addresses and explicitly distinguishes In this wallet, No match in this wallet, Unknown script, Conflicting evidence, and Wallet activity. Existing prevout conflict status takes precedence over a stale address or ownership hint. No ownership or allocation inference was added. |
| WQF-003 | Fixed | Direct single-entity Notes popover beside Label and Tags. Every edit uses canonical annotation identity and the existing encrypted autosave path. Existing typing-group Undo coalescing applies. Other labels, tags, icons, bookmarks and entities are preserved. Supports empty notes, Escape, focus cycling/return, outside dismissal, entity/view changes, and viewport/scroll repositioning. No batch notes overwrite. Mobile workspace menu now stacks above the sticky detail toolbar so Undo is clickable. |
| Plurals | Fixed / upstream resolved | Address selection uses addresses; selection counts use row/rows and decision/decisions; relationship summaries use outpoint/outpoints and transaction/transactions. Main had already removed the old detail outpoints badge. |
| Clear filters | Fixed | Compact named button clears search, label, tag, review-state and finding-type filters. It does not clear selection or write review decisions. |
| Operation wording | Fixed | “Analyse loaded” distinguishes local analysis from Refresh and Check UTXOs. One short visible sentence explains discovery/history, unspent status and loaded-data analysis. |
| Mobile graph space | Deferred | Optional layout suggestion. Existing flow collapse remains available. No graph layout overhaul was needed for the three findings. |

Unknown amounts, observed-versus-inferred ownership, optional enriched prevouts and existing review semantics remain intact. No algorithms, indexing, spending or signing changes.

## Validation

- Focused domain/storage regression run: **113 tests passed, 9 files**. Includes Wallet rows, metadata, review decisions, review context/guidance/categories, flow input evidence, review controls and cached-navigation Undo/storage.
- Targeted public-demo browser run: **2 passed**, Chromium at **1440×900** and **390×844**. Checks transaction filter/count/action agreement, clear filters, source relationship wording, direct notes, Graph consistency, cached-navigation Undo, encrypted envelope contents, reload/unlock, clearing notes, focus cycling/Escape, section-change dismissal, entity isolation and horizontal overflow.
- A real phone-layout failure exposed workspace-menu Undo being covered by the sticky Wallet toolbar. The stacking fix was retested with actual pointer clicks, without forced clicks.
- Initial test authoring attempts used incorrect accessible-name selectors; those were corrected. The final focused run passes.
- `npm run build`: passed, including TypeScript checking.
- `npm run format:check`: passed.
- `npm run check:portability`: passed.
- `git diff --check`: passed.
- No full browser, baseline, heavy suite, or live wallet rescan was run.

Reproduce the opt-in browser retest with this preview and the preserved demo export present:

```sh
CHAINGRAPH_QF_RETEST=1 npx playwright test --config scripts/wallet-qf-playwright.config.ts
```

The configuration reuses port 3123 and starts no server. The test is skipped in ordinary browser runs unless explicitly enabled.

Focused domain command:

```sh
npx vitest run tests/context-undo-storage.test.ts tests/wallet-review-controls.test.ts tests/wallet-workbench-rows.test.ts tests/batch-metadata.test.ts tests/wallet-review.test.ts tests/wallet-review-context.test.ts tests/wallet-review-guidance.test.ts tests/wallet-review-categories.test.ts tests/wallet-flow-inputs.test.ts
```

## Screenshots

Original review screenshots and `REVIEW.md` are unchanged. New before screenshots show current main before application fixes, using the preserved public demo. New after screenshots show the fix branch.

| View | Desktop 1440×900 | Phone 390×844 |
| --- | --- | --- |
| Before, Wallet overview | [Before desktop](screenshots/fix-before-desktop.png) | [Before phone](screenshots/fix-before-phone.png) |
| After, Wallet overview | [After desktop](screenshots/fix-after-desktop.png) | [After phone](screenshots/fix-after-phone.png) |
| Transactions | [Desktop](screenshots/fix-transactions-desktop.png) | [Phone](screenshots/fix-transactions-phone.png) |
| Direct Notes | [Desktop](screenshots/fix-notes-desktop.png) | [Phone](screenshots/fix-notes-phone.png) |
| Known source address | [Desktop](screenshots/fix-source-desktop.png) | [Phone](screenshots/fix-source-phone.png) |

## Limitations and manual review

Browser tests use public demo data and live read-only backend responses. Normal bounded UTXO checks occur on opening Wallet; no discovery refresh was triggered. Live values and check times can differ from the original review. Unknown-script and conflicting-evidence distinctions are covered by domain tests; the public live demo does not supply a deterministic conflict. Phone validation uses a Chromium viewport, not a real on-screen keyboard, touch device or screen reader. No positive live UTXO editing or cross-browser claim is made.

To review manually, open the preview and import `demo-review.chaingraph` with its existing throwaway password `Throwaway-WQF-2026`. Choose Wallet, then an address or transaction and Notes. Notes save automatically; Undo is in the workspace menu on phone. Existing browser review annotations were not written back to the original export.
