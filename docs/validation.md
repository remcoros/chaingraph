# Validation results

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
proxy. No publication or native ARM runtime validation is implied.

## Shared analysis foundation, 2026-09-08

The [foundation review](reviews/2026-09-08-foundation.md) records renderer isolation, transaction/script inspection, wallet refresh and encrypted tags. The application remains version 0.2.0; experimental renderers and layouts are reviewed in separate local branches.

- At the integrated UI foundation (`6a62434`), production build and all 209 unit/backend tests passed. The final serial browser run passed all 48 tests in 5.3 minutes. It includes actual WebGL picking, short canvases, encrypted tags, large transaction lists, selected-row visibility, intentional scrolling, and returning-wallet refresh.
- The hardened linux/amd64 image `chaingraph:foundation-check` was rebuilt from that integrated source. The production-browser check passed against its actual built assets and CSP, including transaction rows, tags, annotations, encrypted persistence, reload and unlock. Chain requests in this container check use synthetic fixtures.
- The separate read-only Core/Electrum smoke passed five checks at testnet4 height 151449. A fresh browser then loaded a public testnet4 output, one previous level and its exact spender, added a tag and note, and explicitly inspected raw/witness data. A repeated walkthrough after UI integration completed at height 151457 with no uncaught browser errors; desktop and phone selected rows were fully visible. These live checks used the host proxy, not the production container.

[Live desktop walkthrough](screenshots/foundation-live-desktop.png) and [phone walkthrough](screenshots/foundation-live-mobile.png) contain a public example and disposable annotations. The initial captures exposed fixed fit margins in a short canvas and metadata pushing the selected row out of view. Fit now caps each margin at 10% of the available dimension, and row geometry follows tag wrapping and viewport changes without overriding deliberate scrolling. The extended production check initially expected a transaction's label in an output row, then encountered singular tag-count wording. Its journey now annotates an output and verifies that output after reopening; the tag-count copy was corrected. The first combined 48-test run passed 47 and failed an outdated requirement that the taller desktop transaction panel must scroll. The test now checks visibility rather than unnecessary scrolling, while the phone portion still exercises overflow; the final 48-test rerun passed.

No release was published. Native ARM runtime, physical-device GPU performance and a real GitHub release remain unverified. Wallet refresh tests use deterministic public vectors and synthetic histories, including a simulated return days later; they do not establish completeness for a personal wallet.

## Release polish, version 0.2.0, 2026-09-08

| Check | Result |
| --- | --- |
| Full unit/integration suite | 145 passed, 0 failed |
| Final serial browser suite | 29 passed, 0 failed, 2.2 minutes |
| TypeScript, production build, formatting, release metadata, diff whitespace | Passed |
| Dependency audit | 0 known vulnerabilities at check time |
| Native Docker build and hardened runtime | Passed on linux/amd64 |
| Docker Compose startup and shutdown | Healthy startup, clean shutdown |
| Final production-container Chromium smoke | Passed with actual built assets and CSP |
| GitHub workflows | Both passed actionlint 1.7.12 |

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

| Check | Passed | Failed |
| --- | ---: | ---: |
| Unit/integration suite, including ancestry, spending continuation and public-name migration | 112 | 0 |
| Final isolated browser suite, including actual WebGL picking and responsive workflows | 21 | 0 |
| Live browser example loading and previous/spending expansion, across three testnet4 examples | 9 | 0 |
| Curated example verification through the configured Core/Fulcrum proxy | 3 | 0 |
| Actual frontend funding/spending helper checks against the live proxy | 6 | 0 |

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

| Check | Passed | Failed |
| --- | ---: | ---: |
| Unit/integration suite (protocol, crypto, wallet, scanner, domain, persistence) | 95 | 0 |
| Deterministic browser suite, including the two-wallet round-trip regression | 12 | 0 |
| Read-only live testnet4 backend smoke, with system CAs | 5 | 0 |
| Complete live testnet4 browser flow | 8 | 0 |
| Immediate local status readiness probes | 8 | 0 |
| Follow-up local API probes, 20 sequential requests at 2-second intervals | 20 | 0 |

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
