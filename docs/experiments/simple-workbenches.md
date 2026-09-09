# Small workbenches proposal

2026-09-09. The active proposal now enables Graph and Analysis; Trace is disabled pending a later iteration. See the iteration note below.

## Original proposal at `c18731f`

Local experiment based on `main` at `a97e4ab`. This proposal keeps the accepted v2 renderer and wallet Addresses/Transactions/UTXOs intact. It replaces the cramped Analysis panel with a full workbench and adds a small output-oriented Trace view. No renderer, backend, dependency or encryption format changes were introduced.

### Original changes

- Compact Graph, Analysis and Trace navigation is separate from workspace tabs. Mode changes flush the camera and keep Graph mounted. Selection, wallet context, layout, transaction flow and annotations use the existing contracts. The optional encrypted mode field migrates old `rightTab: analysis` safely.
- Analysis uses one Scan across the existing registry, contextual or loaded-workspace scope, optional defaults, readable findings and evidence, and per-tool coverage, skips and errors. Analysis never fetches chain data. Unlocked workspace controls remain in an App-owned memory map that is cleared on lock.
- Show on graph selects and reveals. Isolate is explicit, promotes relevant compact input context and clears the graph amount threshold. Active include, focus, wallet, tag and other filters have a visible reset. Manual hiding remains separate.
- Trace starts at an explicit outpoint, uses loaded exact links first, and follows only a chosen branch. Backward lookup loads at most one creating transaction. Forward lookup checks a current UTXO observation and one script history, with at most 12 candidate transactions and a 15-second action timeout. The trail retains 40 recent selections in memory. All through-transaction continuation requires a choice; sole-output and consolidation hints explain uncertainty. See [semantics and primary sources](../research/simple-trace.md).
- Label, note, tag and icon edits use the shared Inspector and encrypted storage. Pending scans cancel when leaving their workbench or locking; fetched Trace data requires the original workspace and source to remain present.

### Original validation

All browser runs were serial in this checkout, using frontend port 4178 and configured graph-fixture port 4188. No other checkout dependencies or processes were used.

- 64 passing domain/regression tests across `analysis-scan`, `trace-workbench`, `analysis`, `graph-filters`, `tracing`, `flow-inputs` and `workspace-save-scheduling`.
- 30 distinct passing browser tests across focused serial runs: four Analysis state/error/empty tests, eight new Graph/Analysis/Trace journeys, four curated public examples, and 14 affected regressions. These cover scan-all, explicit branches, unknown/unspent and timeout states, cancelled late results, graph reset versus manual hiding, preserved canvas/camera/selection, encrypted label/note/tag/icon reopen, wallet tabs, activity acknowledgment, tag/entity filters, tour restoration, immediate camera flush and encryption-worker save failure/retry.
- The four public snapshots were WabiSabi, Whirlpool, large value path and the public BIP84 wallet. Each exercised Analysis and explicit loaded forward/backward Trace choices without RPC. The large WabiSabi test uses the existing IndexedDB encrypted-envelope store.
- Fresh Chromium screenshots at 1440×1000 and 390×844 were inspected. Review fixed compressed result rows, excess vertical spacing, missing annotation controls, and mobile Trace positioning. Current output and both hop controls fit together on mobile. Keyboard-accessible native controls, shared editor focus and encrypted persistence were exercised.
- Build/typecheck, changed-file formatting, diff whitespace and portability checks passed. No new packages or copied external implementations were added.
- One real read-only mainnet Whirlpool transaction lookup through preview port 3117 returned the expected transaction with five inputs and five outputs. This verifies that preview RPC works through the existing backend. It is not a live wallet scan or a full live Trace validation.

Local screenshots are under ignored `artifacts/simple-workbenches/`, including `mainnet-wabisabi-analysis-desktop.png`, `mainnet-wabisabi-analysis-mobile.png`, `mainnet-wabisabi-trace-desktop.png`, `mainnet-wabisabi-trace-mobile.png` and equivalent files for the other public examples. Local recordings are not release assets.

### Original limits

Analysis cancellation occurs between existing synchronous tools, not within one tool's loop. Trace does not paginate an oversized history or recursively crawl; results beyond the candidate bound remain unknown. Its trail is temporary and resets on workspace changes or locking. Loaded spend observations may be stale or competing. Heuristics never establish ownership or an authoritative satoshi mapping.

This is a local UI proposal, not a release-readiness claim. The full foundation suite, production deployment, real mobile-device performance and repeated live scans were not rerun. No merge or push was performed. The frontend preview runs separately on port 3117 against the existing backend.

## Follow-up iteration: Graph and Analysis

Trace navigation and entry points are disabled for now. A saved Trace mode opens Graph. The dormant Trace source remains available for later work; existing Graph funding/spending actions and the transaction input/output view remain available.

The floating graph toolbar adds **Isolate selection** next to **Lock to selection**. It reuses the existing Paths filter, defaults to one hop and follows selection changes. Paths offers two hops when needed. Turning it off or resetting filters clears filters while preserving deliberate manual hiding. Analysis retains its explicit finding-level Isolate action.

Analysis names its default scope **Current selection**, with an explicit loaded-workspace fallback when nothing is selected. A finding's affected outputs, addresses and transactions now link individually to Graph, alongside its supporting transactions. Output rows show outpoints, loaded amounts, saved labels and address links when available. Evidence lists scroll without omitting references.

### Iteration validation

- 21 domain tests passed in `analysis-scan.test.ts` and `graph-filters.test.ts`.
- 13 distinct browser tests passed across serial runs of `analysis-state.spec.ts`, `simple-workbenches.spec.ts` and `workbench-examples.spec.ts`, using frontend port 4178 and configured graph-test override 4188. Coverage includes saved Trace fallback, absent Trace entry points, keyboard isolation, one/two-hop selection following, reset versus manual hiding, preserved camera/layout/selection, scan-all, empty/skipped/error states, and each of six output links plus address and supporting transaction links. An address outside compact input context is promoted and revealed without a network request. The four curated public snapshots exercise Analysis and graph isolation.
- Five retained Trace browser journeys are explicitly skipped while that workbench is disabled. Initial test setup failures were corrected: mobile Graph pane selection, a non-coinbase equal-output fixture, and matching public address/script data. The affected evidence journey passed on its focused rerun.
- Fresh desktop (1440×1000) and phone (390×844) screenshots were inspected. The scope selector was given sufficient arrow spacing; the two selection toggles fit together on phone. Evidence rows retain separate outpoint, amount and address controls. Local captures include `graph-selection-isolated-desktop.png`, `graph-selection-isolated-mobile.png`, `six-outputs-evidence-desktop.png` and `six-outputs-evidence-mobile.png` in ignored `artifacts/simple-workbenches/`.
- Build/typecheck, changed-file formatting, diff whitespace and portability checks passed. Preview port 3117 returned HTTP 200. No new packages, external code or network analysis requests were introduced.

These are targeted fixture/browser checks, not another live scan or a full foundation/release validation. The original counts above describe `c18731f`; dormant Trace behavior was not rerun for this iteration.
