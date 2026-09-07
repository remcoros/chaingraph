# Validation results

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
