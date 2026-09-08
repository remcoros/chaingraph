# Validation results

## Wallet record tabs and targeted input navigation, 2026-09-08

Wallet selection exposes Transactions and UTXOs while keeping the wallet context
available during entity editing. Browser coverage exercises history ordering and
deduplication, unloaded transaction selection, metadata persistence through locking,
UTXO refresh after a spend, partial backend failure and wallet-switch cancellation.
UTXO observations come from bounded Electrum queries, never absent graph spends.

Manual desktop and 390-pixel phone inspection reproduced the wallet tab overlap:
the two-row header inherited a fixed 45-pixel height, letting inspector content
cover the lower row. The header now fits both rows. Actual clicks on all four tabs
passed on both viewports; a browser regression checks containment and hit targets.

The bundled real WabiSabi case with 327 inputs and 279 outputs passed selection of
an input and navigation to its creating CoinJoin without additional ancestor RPCs.
The parent has more than 100 inputs and missing ancestry, so the scenario catches
the previous automatic fan-out. Bulk input loading remains an explicit action.
The production build and all 489 unit/backend tests passed. Browser checks cover
the affected wallet, flow, hover, icon, refresh and tracing workflows; this change
does not claim a fresh run of the entire browser suite.

A read-only check of the public example wallet succeeded for all 20 discovered
addresses against the configured mainnet backend, returning zero current UTXOs.
Positive UTXO verification, malformed responses and partial failures were exercised
with fixtures; the live check did not validate a currently unspent positive match.
Screenshots from the manual review remain in ignored local artifacts.

## Deferred autosave and entity visibility, 2026-09-08

Graph navigation now coalesces camera snapshots after 1.2 seconds of quiet and
pauses automatic save dispatch/publication during input. Workspace validation,
JSON serialization and encryption run in a browser worker. Camera-only changes
reuse immutable geometry and do not rebuild wallet script matches or node styling.
Lock, export, workspace switching and unload checks synchronously capture the
latest view before examining save state. The encrypted file format is unchanged.

A 15,000-output workspace with 1,501 displayed nodes passed continuous browser-timed
DOM wheel input through OrbitControls and a separate held-pointer mouse drag.
Neither gesture started an encryption job. Saving resumed after idle; immediate
export and lock preserved the changed camera and note. The recorded run's largest
observed main-thread long task after gesture start was 212 ms under Chromium with
SwiftShader. This is scheduling/regression evidence, not a universal frame-rate
or latency guarantee. [Measurements and methodology](research/graph-autosave-performance.md).

Entity rows have compact show/hide and eligible removal buttons, input/output
counts, and observed block or mempool status. Hidden entities remain editable and
persist through encrypted reopening. Grouped visibility leaves complete Bitcoin
records intact. Removal confirms affected annotations and tags, identifies the
canonical transaction/address even when labels collide, preserves unrelated
selection, and supports Undo. Hidden addresses remain recoverable while address
nodes are off; restoration explains the display setting and offers an explicit
button to enable it. Mobile row targets are 40 by 40 pixels with 6-pixel separation.

The full 96-case browser run passed 92 cases. Four affected cases passed after
correcting an obsolete button selector, an offline-banner assertion, automation
gesture timing, and a transient Chromium network-change interruption during Docker
recreation. A subsequent 12-case run passed all cases, including two additional
regressions for an already-open unlock modal during storage migration and explicit
address-display recovery. All **98 browser scenarios** have therefore passed across
the full run and targeted follow-up. The final dense performance rerun also passed
and saved its measurement artifact. **369 unit/backend tests**, TypeScript,
production build and formatting passed; the final outside-active-chain wording
also passed the 11 transaction-status tests.

Two independent Herdr Codex reviews checked persistence and actual desktop/phone
journeys in separate worktrees. Their findings led to stable queued-save draining
before unlock, refreshed saved-entry references after IndexedDB migration,
unrelated-selection preservation, unique removal identities and hidden-address
recovery. A browser security error in the independent fixture was reproduced on
Chromium's opaque failed-navigation page; the same initialization on the app origin
passed. No remaining confirmed product failure was reported in the exercised scope.

Read-only native checks passed for both configured networks, including block-header
height and matching Core/Electrum transaction bytes. Real credentials were loaded
only by runtime configuration, never inspected or copied. Block-height provenance,
network-scoped bounded reuse, cancellation and reorganization handling also have
focused regression coverage. [Transaction status limits](research/transaction-status.md).

The final local amd64 container built and ran through Compose as the node user with
a read-only filesystem and reported healthy. The production browser smoke verified
the actual bundled same-origin encryption worker under server CSP, plus built WebGL,
labels/tags and encrypted save/reload/unlock. Container configuration used public
synthetic upstream fixtures; real upstream connectivity was verified natively.

The native preview was restarted on port 3001 with its isolated mainnet/testnet4
backend on port 4000. A public testnet4 transaction walkthrough confirmed actual
block height, direct input loading, row hide/restore, label/tag editing, desktop and
phone controls, and encrypted lock/reopen without page errors or horizontal overflow.

- [Live transaction flow and graph on desktop](screenshots/visibility-live-desktop.png)
- [Live transaction flow on phone](screenshots/visibility-live-phone.png)
- [Compact entity rows on desktop](screenshots/visibility-entities-desktop.png)
- [Phone entity actions](screenshots/visibility-entities-phone.png)
- [Removal identity and metadata confirmation](screenshots/visibility-removal-confirmation.png)

## Tracing interaction and dense workspace refinement, 2026-09-08

Two independent Codex sessions in Herdr reviewed the application in separate
worktrees, using desktop and phone Chromium contexts and public transactions.
Their reports drove fixes to Inspector scroll restoration, horizontal tag choices,
long transaction labels, uneven lane collapse controls, and mobile touch targets.
The node hover card measured about 304 x 204 pixels for an annotated transaction,
compared with roughly 320 x 404 before this pass. Connections no longer open cards;
deliberate connection clicks still select their associated entity.

The public mainnet example with 327 inputs and 279 outputs initially expanded to
34,552 graph nodes and exceeded localStorage quota. Automatic input context now
retains full cached parent transactions while displaying their relevant outputs.
Live acceptance loaded 114 transactions into 720 graph nodes, populated all 327
input rows, saved successfully, and restored the data after reload and unlock.
Explicit navigation or discovery promotes a cached parent to its complete graph.

Large encrypted workspaces now use IndexedDB behind the public saved-workspace
index. Review found and reproduced a cross-tab publication/deletion race without
Web Locks, then a pending-unlock/deletion race. The final coordinator serializes
index publication across contexts, preserves committed ciphertext after a late
coordinator abort, and checks deletion/unlock preconditions at the commit boundary.
The independent reviewer reran both unlock/delete orderings and nine native
IndexedDB concurrency scenarios without remaining confirmed storage findings.

Empty, partial and failed spending searches retain the camera. A second regression
covers a failed trace interrupting and restarting automatic input hydration after
a manual pan. Focus graph has a visible label and shares the side-panel breakpoint;
Lock to selection has a persistent, visible pressed state. The lookup defaults to
Off for optional ancestry while the displayed transaction resolves its direct inputs.

A fresh live testnet4 journey exercised central transaction label/tag editing,
selection lock and compact tag actions at desktop and phone sizes, with no page
errors or horizontal overflow. Read-only mainnet and testnet4 service checks passed.

- [Final desktop controls and tags](screenshots/interaction-final-desktop.png)
- [Final phone controls](screenshots/interaction-final-phone.png)
- [Dense mainnet acceptance](screenshots/interaction-large-mainnet.png)
- [Compact node hover](screenshots/interaction-node-hover.png)
- [Phone Inspector after selection](screenshots/interaction-mobile-inspector.png)
- [Phone tag picker](screenshots/interaction-mobile-tags.png)

The complete 80-case browser suite passed after the final corrections, along with
328 unit/backend tests, TypeScript, production build and formatting. The rebuilt
amd64 image ran through Compose with public synthetic network configuration,
read-only root filesystem and the node user. Built WebGL, the real server CSP,
transaction inspection, tags and encrypted save/reload/unlock passed the production
browser smoke. Live upstream checks used the native host process; the container
smoke isolated chain requests with public synthetic fixtures.

Physical-device testing and native ARM runtime remain outside this validation.
No image, tag or GitHub Release was published.

## Isolated simultaneous networks, 2026-09-08

The backend discovers one or both named network files, with separate immutable
configuration, Core/Electrum clients, sockets, queues, limits and chain identity.
Network discovery is independent of upstream health. Every request declares its
network; the frontend captures the workspace network through scanning, fallback,
tracing and raw inspection. Unsupported workspaces open with a clear error and
remain editable offline. A single configured network is read-only during creation;
two configured networks offer a choice.

The complete **63-case browser suite passed** after the integration, covering
single/dual network creation, unsupported imports and unlocks, independent offline
status, late responses during switching, wallet refresh and encrypted restoration.
The earlier integration run exposed an ambiguous alert selector in the tag test;
it now targets the tag validation message alongside the separate offline banner.
Transaction address checks reject foreign-network metadata and recognized
address/script mismatches while preserving legacy multisig participant metadata.

The final TypeScript/build, formatting and **285 unit/backend tests passed**.
Visual review also caught small new graphs remaining tiny until simulation settled.
They now receive an early fit after valid initial ticks, while the final fit still
respects user gestures and restored snapshots. Completed manual camera gestures
save even before layout settlement, preventing a quick switch or lock from losing
that view; untouched automatic layouts still wait for settlement before capture.
After this final camera refinement, all **12 affected browser cases passed**,
including real first-load pixels, returning views, manual pan, touch picking,
hidden/short canvases and encrypted camera/mode restoration.

Both real upstream pairs passed concurrent read-only checks, including matching
raw transaction bytes from Core and Electrum. A fresh live browser walkthrough
created mainnet and testnet4 workspaces, loaded separate public transactions,
switched between saved labels, and inspected both connection states on desktop and
phone. No uncaught browser errors or horizontal overflow were observed. The main
preview was restarted using named-file discovery and both pairs rechecked healthy;
the retired `.env.live` was then removed without reading or copying it.

- [Both live networks on desktop](screenshots/networks-desktop.png)
- [Both live networks on phone](screenshots/networks-phone.png)
- [Mainnet transaction flow and early graph framing](screenshots/networks-mainnet-flow.png)

The local amd64 image built and ran through Compose with two public synthetic
configuration files in a dedicated read-only mount. Capability discovery returned
both networks and offline upstream status stayed separated. The container reported
healthy, ran as the node user and used a read-only root filesystem. Production
browser checks exercised built WebGL, the real server CSP, transaction inspection,
inline tags and encrypted save/reload/unlock. Live upstream checks used the native
host process; this container check did not claim real upstream connectivity.
The final rebuilt container and live dual-network browser walkthrough both passed
again after the camera refinement. The temporary test container was stopped; the
main development preview remains available on port 3001.

Workflow actionlint, release metadata and configuration checks passed. No image,
tag or GitHub Release was published; native ARM runtime remains unverified.

## Compact flow and automatic workspace state, 2026-09-08

The main transaction sits between input/output lanes, with exact-outpoint arrows
and adjacent transaction cards. Large lists show three rows plus the selection.
OP_RETURN previews decode literal pushes as safe UTF-8 or explicit hex, with full
selectable/copyable data. Inspector identifiers appear once; the output index stays
visible when its transaction ID truncates. Tags can be created and assigned inline.
Annotation and workspace-detail edits apply immediately, with no Save button.

Encrypted workspaces now retain camera/node coordinates, selection, filters,
pane choices and transaction-flow expansion. Continuous typing groups into Undo
steps; leaving a field starts a new step. Lock waits for the encrypted revision.
Tests wait for the completed lock before reloading, rather than interrupting crypto.

TypeScript, production build, formatting and **253 unit/backend tests passed**.
All **53 distinct browser cases passed across serial runs**, including real renderer
camera capture/restoration across two workspaces, Flat/3D mode recovery, exact-output
flow navigation, 150-output phone scrolling, safe OP_RETURN clipboard actions and
inline tag creation. The final graph/OP_RETURN/persistence run passed all 11 cases.
The freshly built application also passed the production browser smoke under the
real server CSP. This used a temporary host server, not a rebuilt container.

A fresh live public-testnet4 journey loaded an output, its previous transaction and
exact spender, inspected verified raw bytes, edited notes and created an inline tag.
Desktop and phone views had no uncaught browser errors or horizontal overflow.

- [Desktop flow](screenshots/flow-main-transaction-desktop.png)
- [Phone flow](screenshots/flow-main-transaction-phone.png)
- [Phone inspector and inline tag](screenshots/flow-main-inspector-phone.png)
- [Phone graph](screenshots/flow-main-graph-phone.png)

Review fixed a typing render-depth failure caused by rebuilding graph/navigation
state on presentation-only writes. It also caught initial-fit and StrictMode camera
restoration races, typing groups crossing lock/reopen, and the installed engine's
omitted z coordinate in Flat mode. Snapshots canonicalize Flat depth to zero and
retain strict finite-coordinate checks in 3D. The OP_RETURN research is recorded
[with primary references](research/op-return.md).

## Compact main workbench, 2026-09-08

Workspace tabs now share the main header. Lookup and previous-level prefetch share
one row, with one previous level selected initially. Help holds the tour, curated
testnet4 examples, offline laboratory and About. On phones, Undo and Export are
available through Workspace menu. Selection history, centering, Paths and focus
controls float over the actual graph viewport without changing renderer picking
coordinates. Empty workspaces omit navigation until graph data is available.

A fresh public-testnet4 walkthrough loaded a selected output, one previous level
and its exact spender, saved a label/note and explicitly inspected raw data. It
passed at desktop and phone sizes without uncaught browser errors or horizontal
overflow. At 1440 × 900 the workbench starts roughly 150 pixels higher than the
previous layout. At 390 × 844, the header and lookup measured 47 and 52 pixels.
Selected transaction rows, phone graph and Help menu were visually inspected.

- [Desktop workbench](screenshots/compact-main-desktop.png)
- [Phone transaction view](screenshots/compact-main-phone.png)
- [Phone graph with transaction view collapsed](screenshots/compact-main-phone-graph.png)
- [Phone Help menu](screenshots/compact-main-help-phone.png)
- [Empty phone workspace](screenshots/compact-main-empty-phone.png)

TypeScript, production build, formatting and all 218 unit/backend tests passed.
The browser smoke against freshly built assets and the real server CSP passed
WebGL, transaction rows, annotations, tags and encrypted save/reload/unlock using
synthetic chain requests. This check used a temporary host server, not a rebuilt
container. All **49 distinct browser cases passed** across serial runs: the final
37-case run covered entities, icons, labels/tags, wallet refresh, workspace/dialog
workflows and transaction inspection; eight graph and four tracing cases had
already passed and were unaffected by the final empty-state/focus correction.
The new checks exercise Help arrows/Escape and modal focus return, mobile menu
Undo/Export, one-level default prefetch and actual renderer picking beneath the
floating navigation. The temporary production server exited cleanly; development
preview 3001 remains running.

Review caught and fixed two interaction defects: empty-graph navigation overlapped
wrapped phone display controls by 22 pixels, and a dialog's child autoFocus caused
focus restoration to target a removed input. Navigation now requires graph data;
dialogs capture their invoker before children mount and restore only connected
controls. Earlier browser attempts invalidated by development hot reload or a
cached obsolete sample-menu selector are not counted as passing evidence.

## Final local proposals, 2026-09-08

The [comparison report](experiments/comparison.md) identifies the three isolated
branches and four running previews. The root reviewer completed the same live
public-testnet4 tracing, annotation, transaction-row, raw-inspection and phone
journey on all four, with no uncaught browser errors or horizontal page overflow.
All four final proxy status checks reported connected testnet4 at height 151459.

Custom Three.js passed 225 unit/backend tests after proxy integration and recovery
refinement, four transaction checks and the dense-scene context-recovery/disposal
check. Its earlier full suite passed 59 tests. Studio passed 218 unit/backend and
four transaction checks after proxy integration; its full 57-test and subsequent
28-test UI-foundation checks are recorded in its branch report. The combined
proposal passed a complete 72-test browser run after its background-recovery fix,
then 225 unit/backend and four transaction checks after final proxy integration.
Shared domain, crypto/storage, proxy, graph interactions and transaction/script
views were compared against main, preserving separate renderer/layout changes.

## Final transport integration, 2026-09-08

Main `a47123b` adds the independently reviewed stale-socket correction to the UI
foundation below. Build, **218 unit/backend tests**, formatting and the separate
**5/5 live testnet4 checks** passed at height 151458. No frontend runtime code
changed after the complete **48-test browser run**.

The actual idle-time probe that reproduced the defect was repeated with the fix.
All five read-only calls succeeded. Both 30-second idle intervals still triggered
an underlying `ECONNRESET` on a reused socket, but the single fresh-connection retry
completed in 15 and 18 ms. The original deadline, cancellation and concurrency
limits are preserved. Nine deterministic transport tests cover retry boundaries,
shutdown, external cancellation and the original deadline. See the
[probe evidence](research/core-keepalive.md) and [Kimi review](reviews/kimi-foundation.md).

The linux/amd64 image was rebuilt from this source and started with a read-only
root, no capabilities and no-new-privileges. Its health check passed. The extended
production-browser smoke passed against its built assets and CSP: WebGL,
transaction rows, annotations, tags, encrypted save, reload and unlock. These
container chain requests were synthetic; the live checks above used the host
proxy. The owned test container exited with code 0 on SIGTERM and was removed. No
publication or native ARM runtime validation is implied.

## Shared analysis foundation, 2026-09-08

The [foundation review](reviews/2026-09-08-foundation.md) records renderer isolation, transaction/script inspection, wallet refresh and encrypted tags. The application remains version 0.2.0; experimental renderers and layouts are reviewed in separate local branches.

- At the integrated UI foundation (`6a62434`), production build and all 209 unit/backend tests passed. The final serial browser run passed all 48 tests in 5.3 minutes. It includes actual WebGL picking, short canvases, encrypted tags, large transaction lists, selected-row visibility, intentional scrolling, and returning-wallet refresh.
- The hardened linux/amd64 image `chaingraph:foundation-check` was rebuilt from that integrated source. The production-browser check passed against its actual built assets and CSP, including transaction rows, tags, annotations, encrypted persistence, reload and unlock. Chain requests in this container check use synthetic fixtures.
- The separate read-only Core/Electrum smoke passed five checks at testnet4 height 151449. A fresh browser then loaded a public testnet4 output, one previous level and its exact spender, added a tag and note, and explicitly inspected raw/witness data. A repeated walkthrough after UI integration completed at height 151457 with no uncaught browser errors; desktop and phone selected rows were fully visible. These live checks used the host proxy, not the production container.

[Live desktop walkthrough](screenshots/foundation-live-desktop.png) and [phone walkthrough](screenshots/foundation-live-mobile.png) contain a public example and disposable annotations. The initial captures exposed fixed fit margins in a short canvas and metadata pushing the selected row out of view. Fit now caps each margin at 10% of the available dimension, and row geometry follows tag wrapping and viewport changes without overriding deliberate scrolling. The extended production check initially expected a transaction's label in an output row, then encountered singular tag-count wording. Its journey now annotates an output and verifies that output after reopening; the tag-count copy was corrected. The first combined 48-test run passed 47 and failed an outdated requirement that the taller desktop transaction panel must scroll. The test now checks visibility rather than unnecessary scrolling, while the phone portion still exercises overflow; the final 48-test rerun passed.

No release was published. Native ARM runtime, physical-device GPU performance and a real GitHub release remain unverified. Wallet refresh tests use deterministic public vectors and synthetic histories, including a simulated return days later; they do not establish completeness for a personal wallet.

## Release polish, version 0.2.0, 2026-09-08

| Check                                                                       | Result                                  |
| --------------------------------------------------------------------------- | --------------------------------------- |
| Full unit/integration suite                                                 | 145 passed, 0 failed                    |
| Final serial browser suite                                                  | 29 passed, 0 failed, 2.2 minutes        |
| TypeScript, production build, formatting, release metadata, diff whitespace | Passed                                  |
| Dependency audit                                                            | 0 known vulnerabilities at check time   |
| Native Docker build and hardened runtime                                    | Passed on linux/amd64                   |
| Docker Compose startup and shutdown                                         | Healthy startup, clean shutdown         |
| Final production-container Chromium smoke                                   | Passed with actual built assets and CSP |
| GitHub workflows                                                            | Both passed actionlint 1.7.12           |

The [independent review](reviews/2026-09-08-independent.md) ran in a new Codex session without skills, memory, user configuration or inherited conversation. The [response matrix](reviews/2026-09-08-response.md) records fixes. Regression coverage includes imported wallet address/key binding, 200-character wallet labels surviving concurrent scan completion and encrypted reopening, annotation drafts surviving view changes and conflicting undo, preserved exclusions, stale findings, entity pagination beyond 200 records, shared canvas filters, locked-copy deletion, and selection history after graph removal.

Browser tests exercised actual WebGL node/link picking and viewports from 320 to 768 pixels. A separate manual analysis review ran all seven tools, selected/visible scopes, parameters, coverage reports, result filters and graph isolation, including a 375-pixel viewport with zero page errors. Screenshot review caught clipped mobile pagination and long scrolling between tools/results; both were fixed. Pending graph fitting now follows layout settling and yields to manual camera interaction. Selection history preserves path depth and skips removed nodes. Workspace switching clears pending queries and focus requests; unavailable tour storage cannot crash the workspace.

The final end-user walkthrough used a fresh browser context with a real public testnet4 example through the configured Core/Fulcrum proxy. It loaded two previous levels, found the selected output's spender, inspected graph details with the keyboard, chose an icon, saved a label/note, ran fee analysis and opened About. The result contained four transactions and 13 graph nodes; fee analysis distinguished three reconciled transactions from one with missing input data. Encrypted autosave completed, the 390-pixel layout had no horizontal overflow, and there were no uncaught page errors. No environment-file contents were read or captured.

Reviewed release screenshots:

- [Real testnet4 tracing and fee findings](screenshots/release-analysis.png)
- [Graph tracing and entity inspection](screenshots/release-tracing.png)
- [About, version and acknowledgements](screenshots/release-about.png)
- [Mobile findings](screenshots/release-mobile.png)
- [Mobile entity filters and accessible pagination](screenshots/release-entity-mobile.png)

Container checks used actual HTTP and TCP fixture servers to exercise Bitcoin RPC authentication/chain status, the Electrum handshake and history protocol, request allowlists and Origin rejection. The image ran as UID 1000 with system CAs, a read-only root, dropped capabilities and no environment files or node_modules; graceful SIGTERM exited successfully. The final rebuilt image also passed a production browser round trip covering WebGL, CSP, annotations, encrypted save, reload and unlock. Compose itself was started, reached healthy and stopped. These protocol fixtures do not replace the separately verified real testnet4 checks.

An earlier browser run passed 27 tests and failed one because a navigation assertion became ambiguous after accessible pagination was added. The selector was corrected to target workspace navigation, and the final 29-test run passed. One initial manual dev-page attempt encountered an empty module cached during concurrent file editing; invalidating that development cache restored the module, and the walkthrough passed. Fresh test servers and the production build did not exhibit that development-cache issue.

No release was tagged or published: this checkout has no configured GitHub remote. Source/issues/releases links are enabled by the public build-time repository URL; the release workflow supplies its actual GitHub repository. Multi-platform publication is configured for amd64/arm64, but native ARM runtime and a real GitHub publication remain unverified. Software WebGL is functional browser evidence, not a native mobile GPU or frame-rate benchmark. Existing wallet-discovery and history-completeness limits remain documented.

## Tracing and workspace refinement, 2026-09-08

| Check                                                                                        | Passed | Failed |
| -------------------------------------------------------------------------------------------- | -----: | -----: |
| Unit/integration suite, including ancestry, spending continuation and public-name migration  |    112 |      0 |
| Final isolated browser suite, including actual WebGL picking and responsive workflows        |     21 |      0 |
| Live browser example loading and previous/spending expansion, across three testnet4 examples |      9 |      0 |
| Curated example verification through the configured Core/Fulcrum proxy                       |      3 |      0 |
| Actual frontend funding/spending helper checks against the live proxy                        |      6 |      0 |

TypeScript, production build, formatting, and `git diff --check` passed. The final browser suite took 1.6 minutes and used isolated synthetic API fixtures except for its renderer tests, which exercise actual canvas picking. Its viewport coverage includes 320, 375, 414 and 768 pixels. The live example browser used three separate fresh workspaces, loaded each selected output, and added its verified parents and spender. No uncaught browser errors or horizontal overflow were observed.

A separate end-user walkthrough exercised the first real testnet4 output with two previous levels, found its spender, opened graph details using the keyboard, jumped directly into label editing, selected an icon, saved encrypted data and inspected the layout at 390 pixels. The same walkthrough passed against the built application served by the production server, including its real content-security policy: zero page or console errors, one working WebGL canvas, and encrypted autosave completed. Temporary production and test servers were stopped; the development app remains on port 3001.

### Screenshot review and finishing changes

The review identified and fixed:

- The icon palette could place Clear below the viewport. Its heading and footer now stay visible while the icon grid scrolls.
- Returning to the same node after using its toolbar did not always reopen details. Canvas re-entry now waits for actual pointer movement and the renderer update, avoiding stale node/link cards.
- Loaded spending evidence was only a count. The inspector now links to creating and spending transactions and shows an output's script type and index.
- Routine success messages lingered over small-screen editing. They now dismiss after eight seconds; partial-result and error messages remain available.
- Busy spending histories repeatedly inspected the first 500 candidates. A continuation offset now advances to later candidates, with the changing-history limitation documented.

Reviewed screenshots contain only public testnet4 examples and disposable review annotations:

- [Tracing workbench](screenshots/trace-workbench.png)
- [Graph detail card and related transactions](screenshots/trace-details.png)
- [Icon palette with visible Clear action](screenshots/icon-picker.png)
- [390-pixel inspector](screenshots/mobile-tracing.png)
- [53-output fan-out with incoming and spending paths](screenshots/testnet4-fanout.png)

Earlier browser attempts exposed the picker and hover defects above. Overlapping test runners also collided in their shared artifact directory and stopped a shared test server; those runs were not treated as passing. The final 21-test run ran alone and passed. Two ad hoc live review assertions initially expected outdated transaction counts/pluralization; after correcting the review scripts, the actual flows passed. No wallet secrets or environment-file contents were read or included in screenshots.

The 3,001-node renderer smoke remains functional evidence using software WebGL, not a native mobile GPU or frame-rate benchmark. Mainnet live behavior, exhaustive wallet discovery, and complete spending-history scans remain outside these checks. See [example provenance and limits](research/testnet4-examples.md) and [rendering references](research/graph.md).

## Initial version validation

| Check                                                                           | Passed | Failed |
| ------------------------------------------------------------------------------- | -----: | -----: |
| Unit/integration suite (protocol, crypto, wallet, scanner, domain, persistence) |     95 |      0 |
| Deterministic browser suite, including the two-wallet round-trip regression     |     12 |      0 |
| Read-only live testnet4 backend smoke, with system CAs                          |      5 |      0 |
| Complete live testnet4 browser flow                                             |      8 |      0 |
| Immediate local status readiness probes                                         |      8 |      0 |
| Follow-up local API probes, 20 sequential requests at 2-second intervals        |     20 |      0 |

The live browser flow checked connected status, bounded transaction selection, encrypted workspace creation, real transaction graph loading, output inspection, address history, funding expansion, and spending expansion. Selection used 10 direct read-only proxy calls. Uncaught browser errors: **0**.

Two earlier helper attempts failed during the direct API readiness stage, before Chromium launched: **0 checks passed and 1 check failed per attempt**. Their original summaries omitted the response body and exception type, so they cannot distinguish an API `connected:false` response from a fetch/JSON exception. They were not frontend loading checks. The complete subsequent run passed all eight checks.

The follow-up probe made **20 sequential requests**, separated by **2 seconds**. All returned HTTP **200** with `connected:true`; failures: **0**. Observed response latency was **9–116 ms**. The earlier failure did not recur; its cause remains unconfirmed. No restart or upstream outage is inferred.

The browser used an isolated ephemeral context. Saved browser profiles, traces and screenshots: **0**. Environment-file reads by the browser test: **0**. Credentials, upstream endpoints, transaction identifiers, addresses and passwords recorded in this report: **0**.

The production build was also exercised through the real static server in Chromium. An initial check caught a blocked embedded graph font; the policy was adjusted narrowly to allow data fonts while retaining same-origin script restrictions. The rerun passed: one WebGL canvas rendered the 1,623-node / 1,620-link synthetic laboratory, encrypted autosave completed, and no console or page errors occurred. Production JavaScript is split into a 481 kB application chunk and a lazily loaded 1,381 kB graph chunk (uncompressed).

The final browser regression rerun passed all **12 tests** after component extraction,
scan continuation changes, domain validation, graph stylesheet scoping, and tour
improvements. TypeScript (including unused-import checks), production build,
formatting check, and dependency audit passed; the audit reported zero known
vulnerabilities at the time it ran. Browser tests emitted only terminal color-option
warnings from the runner, not application errors.

The final backend smoke passed **5/5** on testnet4 at height **151423**, using system
CAs with certificate/hostname verification enabled. The graphical stress harness
also rendered 3,001 synthetic nodes; this was a functional check using Chromium's
software WebGL, not a hardware/mobile frame-rate benchmark.

Mainnet behavior is covered by key/script vectors and protocol mocks, not by a live
mainnet node. Real personal-wallet completeness, every reorganization, native mobile
GPU performance, multisig/descriptors, PWA offline installation, and Boltzmann
computation have not been validated or implemented beyond the documented slice.

A subsequent two-wallet browser regression caught an on-blur preview changing button position during a click. Preview is now explicit; key encoding is detected during input without inserting layout content. The corrected two-wallet import/scan/reload/removal test and the existing BIP84 annotation test both passed on rerun.

A final numeric regression verifies that large valid eight-decimal BTC values are accepted despite binary floating-point scaling residue, while fractional-satoshi values remain rejected.

## Mainnet tracing, amount filtering and unlock focus, 2026-09-08

Reproduced the reported mainnet transaction
`1d690f3b96b878067f3a445b74dfb8fab4201c0455d88ac98cc14a927e7858d7`
from an empty workspace. On baseline `8cd1c27`, automatic flow hydration produced
6 nodes; Load previous expanded cached data to 18 nodes while reporting zero new
transactions. No RPC error occurred. Removing the root left its expanded parent.
The notice and ancestry cleanup now distinguish these cases correctly.

Verified with 402 unit/backend tests, TypeScript/build and formatting checks.
Thirty-four distinct targeted browser scenarios passed across serial batches:
tracing and late-result removal, amount filters, keyboard unlock focus, flow-input
loading, row actions, camera preservation/framing, hover/picking, save transitions,
and dense-graph deferred autosave. This was targeted regression coverage, not a
rerun of every browser test in the repository. New harness checks were corrected
to await completed locking, inspect entity rows while the status bar shows an
active operation, and expect Undo to restore the actual pre-download snapshot.
All corrected cases passed.

An independent Herdr browser review used the live mainnet backend from an isolated
preview. It reproduced the original report and exercised cached expansion,
removal/Undo, previous-output traversal, selection recovery, individual hide/show,
amount filtering, Value sizing and desktop/mobile rendering. Screenshots were
inspected and led to pruning automatic parent nodes isolated by the amount filter,
and correcting arrow endpoints for actual node geometry. The UI now isolates the
large parent input while reporting nine omitted small inputs. See the recorded
[fund-flow observations](research/mainnet-tracing-refinement.md),
[desktop view](screenshots/mainnet-funding-filter-desktop.png) and
[phone view](screenshots/mainnet-funding-filter-phone.png).

An independent source review found and verified fixes for late manual-trace results
restoring removed branches, retained output placeholders admitting such results,
laboratory reset retaining dangling provenance, and quiet wallet discovery losing
independent provenance through Undo. Targeted browser/store regressions cover them.
Camera-only updates retain an identity fast path through context propagation.

The value-radius scale is bounded and stable when filters change. It is not a
linear-value or volume representation. Existing node overlaps and occlusion can
still occur in 3D. No mobile-device frame-rate guarantee or Docker release claim
is made by this iteration; this pass used Chromium software WebGL and the native
read-only network bridge. The development preview remains on port 3001.

Final live acceptance also confirmed desktop/phone password autofocus and direct
keyboard unlock, actual 3D orbit/pan/zoom, phone touch orbit, no horizontal overflow
at 390px, and completed encrypted autosave. No browser runtime errors were observed.
The final wording pass renamed the manual visibility options to **Not hidden**,
**Hidden**, and **All entities**, with a tooltip explaining that amount-filtered
outputs stay listed. Compact phone targets and tight framing around a single
focused node remain presentation tradeoffs; Fit restores the wider path.

## Retained-value labels, orphan branches and direction arrows, 2026-09-08

Amount selectors now show **> threshold**, with matching strict greater-than
behavior. Exactly equal values are filtered out unless selected. The flow labels
this selection exception as outside the filter.

Canvas cleanup now omits isolated transaction/address nodes while a value filter
is active, including legacy records without context provenance. For tracked
prefetched ancestry, reachability before and after filtering removes entire
branches disconnected by small outputs, even when those branches contain larger
siblings or unknown-value inputs. Independent investigations and the selection
remain anchors. Cached data and manual hidden state are untouched.

Every funding/spending edge has a directional arrow. Selected incident edges use
larger arrows and thicker accent lines; address associations remain undirected.
Four-sided arrow geometry limits the extra rendering cost. Build, formatting and
404 unit/backend tests pass. Browser amount-filter, mobile layout, dense-gesture
save deferral and encryption-failure recovery checks pass with all arrows enabled.
Seven targeted browser scenarios passed in total, including actual node picking,
hover actions, keyboard navigation, quiet connection hover and mobile touch.
The screenshot test's address-color detector was tightened so muted arrows do not
get mistaken for address meshes; its real pointer-picking assertions remain intact.

A fresh live mainnet browser journey loaded the reported transaction with one
prefetch level, followed its parent, and expanded ten cached input transactions.
The complete graph had 90 nodes. At **> 10,000 sats**, the canvas projection retained
44 nodes and three loaded transactions along the large-value path, rather than
the nine detached small-input branches. Remaining unknown-value input placeholders
stay visible on the connected branch. Switching to All amounts and back succeeded,
encrypted autosave completed and no browser runtime errors occurred. See the
[expanded ancestry screenshot](screenshots/mainnet-direction-filter.png).

## Value contrast and independent amount filters, 2026-09-08

The reported outputs of transaction
`a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d`
were loaded through the live mainnet bridge in a fresh browser workspace. Their
observed values were 59,849,955,894 and 340,000,000,000 sats. The previous radius
curve gave only 1.079 times the diameter. The new bounded square-root curve gives
radii of 6.582 and 11.265, or 1.711 times the diameter and 2.929 times the projected
area at equal depth. The actual 3D screenshot was inspected and the difference is
visible: [mainnet value comparison](screenshots/mainnet-value-contrast.png).

This is a visual emphasis scale, not a proportional volume representation. The
minimum radius keeps small outputs selectable, so smaller absolute amounts remain
compressed: 1 BTC versus 10 BTC differs by about 1.15 times the diameter. Perspective
also changes apparent sizes. The scale is independent of which nodes are visible,
and its smooth upper limit replaces the old early hard cap.

The live workspace retained different canvas and flow thresholds (10,000 and
1,000 sats). Collapsing the flow removed its control; reopening retained its value.
Encrypted autosave completed and no browser runtime errors occurred. Desktop and
phone browser regressions also cover independent controls, exact boundaries,
unknown inputs, selected-output exceptions, recovery actions, and lock/unlock
persistence. A separate read-only agent review found no integration blocker.

Final checks passed: build, formatting, 406 unit/backend tests, and five targeted
browser scenarios. These include the two amount-control journeys plus dense
navigation with deferred autosaves and latest-camera export/lock flushing,
encryption-worker failure recovery, and real node picking/card/keyboard actions.
The renderer tests cover the reported high-value pair, monotonic growth, invalid
values, and stable sizes when unrelated nodes are filtered away. Browser rendering
was checked in Chromium with software WebGL, not benchmarked on physical phones.

## Findings from the first demo recording, 2026-09-08

The isolated recorder reported four user-facing issues: workspace suggestions
required manual clearing, framing alternated between clipped and tiny graphs,
automatic input context crowded Entities, and the Inspector could not explicitly
check whether an output remained in the current UTXO set. Recording-tool timeouts,
Python selection and clicking the embedded amount selector were distinguished
from application defects.

The workspace suggestion now selects on focus and preserves that selection on
pointer-down until edited. A browser regression reproduced native click placement
collapsing the initial selection; the final fix covers keyboard replacement,
clicking an already focused field, and normal caret editing after replacement in
both live and laboratory creation dialogs.

Entities adds an optional, saved Match graph mode, consuming exactly the canvas
projection. Loaded observations remain recoverable in the existing visibility
modes. Browser checks cover amount filtering, independent flow thresholds, recovery
and locking/reopening this preference.

The Inspector's explicit Core UTXO check validates response metadata against the
loaded output, includes mempool spends and shows the check time. Null, network
failure and non-null observations remain distinct. Selection changes cancel and
clear observations; delayed responses cannot leak into another selected output.
Browser regressions cover retry, error sanitization, annotations and graph
preservation, loaded-spender independence, and switching away and back.

The camera now frames actual mesh bounds in the current viewing direction. Tests
cover translated graphs, large foreground neighbors, narrow viewports, field of
view, tilted cameras, exclusion of distant branches from focus and stable camera
state during presentation edits. The implementation replaces the pinned renderer's
origin-centered fit behavior with original local framing code.

Validation passed: build, formatting, 428 unit/backend tests and 15 targeted
browser scenarios, including camera preservation, actual picking, short canvases,
mobile touch, deferred autosaves, export/lock flushing and worker-failure recovery.
The new name test first exposed a native pointer-selection regression; it passed
after preserving the suggestion on pointer-down rather than click.

A fresh live mainnet workspace loaded `a6d697a25266ce3c78774fd1d75f896b7af522ada209b0f6228ea497bc49a46d`,
used Match graph with amount filtering (5 displayed nodes from 33 loaded), focused
its 3,400 BTC output and confirmed Unspent at check through the new UI. No page
errors occurred. Desktop focus, full Fit and a 390px Inspector were inspected:
[Inspector and selection](screenshots/recorder-feedback-inspector.png),
[full framing](screenshots/recorder-feedback-framing.png), and
[phone Inspector](screenshots/recorder-feedback-mobile.png).
Focus intentionally frames local connections; unrelated branches can lie outside
that view. Fit restores all displayed nodes. Physical-device performance was not
benchmarked. The first MP4 was retained without re-recording it.

## Findings from the second demo recording, 2026-09-08

The second isolated recording completed the full four-card tour, labels and tags,
one observed mainnet spending link, and a comparison of common-input heuristics.
The 3:08 annotated MP4 is preserved locally under `artifacts/demo2/`, alongside
captions, public case evidence and sources. Independent validation checked its
H.264/yuv420p format, faststart, complete decode, HTTP range delivery and actual
Chromium playback. Tour and analysis frames were visually reviewed. The
[case research](research/demo-patterns-and-hypotheses.md) documents what the
observations establish and why the optional toxic-change claim was not used.

The recording reproduced an analysis scope reset after an Inspector visit.
Temporary scope, parameters, searches, result filters and expanded parameter
panels now survive navigation per unlocked workspace. Locking clears those
temporary controls. Last-run settings are recorded independently and a notice
identifies changes to parameters or the actual transaction scope. Browser tests
cover Inspector revisits, missing selection, changed graph filters, independent
workspaces and lock/reopen behavior.

The second finding concerned graph labels underneath floating navigation.
Framing now considers cached caption bounds and measured navigation height.
The graph uses the remaining space below the toolbar instead of adding matching
unused space at the bottom. Browser rendering checks cover an uppermost caption,
a shorter flow/canvas, longer annotation text, caption toggles and preservation
of a manually moved camera during resizing. These use actual WebGL rendering.

Build, formatting and 431 unit/backend tests passed. Twelve targeted browser
scenarios passed, including the two analysis journeys, five graph interaction
cases, deferred saves with immediate export/lock flushing, worker failure,
failed/partial trace preservation and workspace framing. The graph fixtures first
exposed a fixture minimum height and antialiased edge pixels in the old caption
probe; the final tests use a correctly sized viewport and measured no-caption
baseline. These were distinguished from product failures.

A fresh live mainnet browser loaded the demonstration's five-equal-output
transaction, labeled an output, isolated its observed equal-output group and
checked analysis settings across Inspector visits. The selected scope and a
two-output threshold remained intact; changing the threshold visibly differed
from the prior run's settings. No browser page errors occurred. This is functional
Chromium/SwiftShader evidence, not a physical mobile performance benchmark.

An early live screenshot caught a label overlapping navigation while layout was
still moving. At settlement, the existing pending Fit correctly reframed it.
A new moving-geometry regression verifies final framing and cancellation by a
manual gesture without camera updates on every simulation tick. The settled
live view was checked again with all six finding nodes visible:
[caption clearance](screenshots/demo2-caption-fit.png) and
[last-run settings](screenshots/demo2-analysis-settings.png).

## Real example workspaces (2026-09-08)

The shipped synthetic laboratory was replaced by four annotated real-chain
workspace templates. Synthetic dense graphs now live only under test fixtures;
old encrypted `demo: true` workspaces retain an explicit offline boundary.
The [template research](research/workspace-templates.md) records snapshot sources,
retrieval times and independent raw-byte verification of all 22 saved records.

Build, formatting and 446 unit/backend tests passed. All 45 migrated browser
scenarios passed across the initial run and targeted reruns. Early failures
included a development-server reload, a CSS transition assertion, and navigation
selectors that depended on the retired laboratory workflow. Ten new browser
scenarios cover every template, no initial RPC calls, independent copies,
edited names/descriptions, annotation persistence across locking, supported-network
filtering, disconnected configured networks, unavailable discovery, cancellation,
retry, disabled fields during loading and mobile keyboard focus.

The production smoke passed with real built assets and security headers, including
the existing WebGL/encryption/save/unlock workflow and new template creation in its
bundled worker. Production output contains four separate snapshot chunks, from
1.6 kB to 68.6 kB, loaded by an ES module worker. UI fields are disabled during
preparation so an edited password cannot diverge from the captured creation request.

Fresh live Chromium sessions on the main preview verified the mainnet equal-output
example starts with zero RPC calls, refreshes through the mainnet backend, navigates
the known spending hop and autosaves an edited note. The refresh used
`getrawtransaction` and `getblockheader`; no other network was queried and no page
errors occurred. A 390×844 viewport verified the direct example shortcut,
scrollable picker, selected suggested name and no horizontal overflow. Screenshot
review caught a close button scrolling out of view; the example dialog now keeps
its heading visible. Cancelling creation after leaving the picker restores focus
to Help. A disconnected 53-output testnet4 template at 1440×900 kept its notes fully
visible (intersection ratio 1).

Reviewed screenshots: [welcome](screenshots/workspace-templates-home.png),
[desktop picker](screenshots/workspace-templates-picker.png),
[mobile picker](screenshots/workspace-templates-mobile.png), and
[live tracing](screenshots/workspace-template-tracing.png).
These are functional Chromium/SwiftShader checks, not physical mobile benchmarks.
The full unrelated browser suite was not rerun. The test migration also observed
minor notes clipping in a disconnected 543-record synthetic fixture; the connected
dense baseline and the real disconnected template both passed their visibility
checks. That larger offline layout remains a separate Inspector refinement.

## Expanded guided tour (2026-09-08)

The first-use tour now covers ten practical topics with a floating, collapsible
contents navigator, stable step IDs, Back/Next, active-topic indication and
keyboard focus restoration. Step metadata and optional availability rules live
separately from the renderer. App projects temporary panel and flow views without
persisting those choices, changing selection or starting scans.

Eight browser scenarios passed together: sequential traversal of all topics in an
empty workspace, direct jumps and keyboard focus, preserved selection and prior
panels, reverse navigation on mobile, an unobscured mobile annotation editor with
scroll restoration, collapsed flow and tab choices surviving encrypted save and
unlock, short-landscape navigation, and the existing restartable-tour regression.
The tests use real public template snapshots and mocked network boundaries; they
observed no unexpected RPC calls. All 446 unit/backend tests also passed.

Screenshot review at 1440×1000 and 390×844 found and corrected the phone tour card
covering its annotation target. That step now temporarily reveals the editor and
places the card above it. At 740×420 the navigation and explanations scroll within
the card while Skip and Next remain visible; opening contents reveals the current
topic, and changing topics resets the explanation's scroll position.

Reviewed screenshots: [transaction flow](screenshots/tour-flow.png),
[topic navigation](screenshots/tour-contents.png), and
[mobile annotation showcase](screenshots/tour-mobile.png).
These are Chromium/SwiftShader UI checks, not physical-device benchmarks. The
unrelated browser suite and production container were not rerun for this UI-only
change. Build and formatting checks passed.

### Nine annotated example workspaces

The final gallery contains six mainnet and three testnet4 examples, grouped in
three desktop columns with a thin network divider. Unsupported networks are
omitted; narrow layouts retain every available example and a reachable close
control. Keyboard card focus now uses an inset outline to avoid clipping.

The final catalog includes a 327-input / 279-output WabiSabi example and a public
BIP84 demo wallet with verified derivation and explicitly incomplete discovery.
Sources, raw-byte checks and snapshot bounds are in
[workspace template research](research/workspace-templates.md).

Validation: production build, formatting, portability, 29 template domain tests
and all 17 template browser scenarios passed. Browser scenarios were exercised
incrementally; replaced examples and affected interactions were rerun after the
catalog changes. The scenarios cover offline initial creation, encrypted copies,
network filtering, editing and locking, cancellation, retry, responsive layout
and keyboard focus. Desktop/mobile gallery and both new graph screenshots were
inspected. The wallet inspection exposed ambiguous gap-limit wording, now labeled
explicitly as a configured limit. Screenshots remain local under `artifacts/`.
These are functional checks, not a mobile GPU benchmark or a complete wallet scan.
