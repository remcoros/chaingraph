# Validation results

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
