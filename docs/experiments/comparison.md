# Local UI and renderer comparison

Reviewed on 8 September 2026. Subsequent UI work targets the main foundation, following user review; the Studio and custom renderer remain isolated proposals. The foundation is integrated on main; the three
alternatives remain separate local branches. No branch was pushed or published.
Each preview has a separate browser origin, so its saved workspaces are separate.
Use an encrypted workspace export/import to compare the same saved data.

## Try the proposals

| Preview | Local branch | What changes |
| --- | --- | --- |
| [Foundation, port 3001](http://127.0.0.1:3001) | `main` | Reviewed shared workflows, force renderer, transaction panel above the canvas |
| [Custom renderer, port 3103](http://127.0.0.1:3103) | `experiment/custom-three-graph` | Same workbench with a directed Three.js renderer, stable layout and camera history |
| [Tracing studio, port 3104](http://127.0.0.1:3104) | `experiment/tracing-studio` | Activity rail, task tray and tabbed selection dock, retaining the force renderer |
| [Studio plus custom renderer, port 3105](http://127.0.0.1:3105) | `experiment/studio-three` | Studio layout composed with the custom renderer through the shared adapter boundary |

The previews use the existing read-only testnet4 proxy. Synthetic laboratory
workspaces remain offline. No environment-file contents or private wallet data
were read or included in this comparison. Ports are loopback listeners on this
machine, not published services. Final status checks on all four previews reported
connected testnet4 at height 151459.

## End-user comparison

The root reviewer independently used all four previews with the same public
spent-output example: load one previous level, find the exact spender, save a
label and note, inspect the selected conventional output row, explicitly load raw
transaction data, then resize to 390 pixels and return to the graph. All four
journeys completed without uncaught browser errors or horizontal page overflow.
The complete selected row stayed inside the phone viewport.

| View | Foundation | Custom renderer | Studio | Combined |
| --- | --- | --- | --- | --- |
| Desktop transaction context | [Screenshot](comparison/3001-transaction-desktop.png) | [Screenshot](comparison/3103-transaction-desktop.png) | [Screenshot](comparison/3104-transaction-desktop.png) | [Screenshot](comparison/3105-transaction-desktop.png) |
| Phone transaction context | [Screenshot](comparison/3001-transaction-phone.png) | [Screenshot](comparison/3103-transaction-phone.png) | [Screenshot](comparison/3104-transaction-phone.png) | [Screenshot](comparison/3105-transaction-phone.png) |
| Phone fitted graph | [Screenshot](comparison/3001-graph-phone.png) | [Screenshot](comparison/3103-graph-phone.png) | [Screenshot](comparison/3104-graph-phone.png) | [Screenshot](comparison/3105-graph-phone.png) |

My preferred next trial is the **combined studio and custom renderer**. The tabbed
selection dock makes labels, exact transaction rows and script details easier to
reach without scrolling through unrelated controls. The directed graph makes the
loaded input-to-output path easier to follow. Selection, tracing, metadata,
wallet refresh and encryption still belong to the shared application.

The tradeoffs remain visible in the screenshots. A fitted long horizontal path
has very small markers on a phone, so Center selection and the transaction/entity
views are useful for exact inspection. Dense connections can overlap, and custom
labels are capped to avoid covering the entire canvas. Studio trades simultaneous
phone panels for one task surface at a time. Its desktop dock can scroll a
transaction heading out of view while keeping the selected row visible. The
custom renderer also owns more layout/picking/GPU code and currently loads Three
earlier than main's lazy force-renderer chunk. These are reasons to keep the
proposals available for comparison before choosing the default.

## Shared behavior and review boundaries

Renderers receive display frames and emit stable IDs and pointer coordinates.
Shared React code owns tooltip contents, selection, tracing, annotation actions,
transaction rows and script inspection. The domain, browser wallet/scanning,
crypto/storage and backend modules are shared. Experiments do not reinterpret
wallet matches, tags or heuristic findings as proof of ownership.

Main includes the independent Opus and Kimi corrections, with reviewed follow-up
iterations. The UI foundation passed all 48 browser tests. Its final transport
integration passed 218 unit/backend tests, the rebuilt hardened-container browser
round trip, five live testnet4 checks and the idle probe that reproduced and then
verified recovery of stale RPC sockets. The test container exited successfully
and was removed after verification. See [validation](../validation.md).

## Reviewed branches and checks

| Proposal | Reviewed head | Validation |
| --- | --- | --- |
| Foundation | `a47123b` runtime, later documentation commits | 218 unit/backend; complete 48 browser tests before backend-only integration; built-container, live RPC and idle recovery checks |
| Custom renderer | `72b551d` | 225 unit/backend; complete 59 browser tests on the UI base; 4 transaction checks after proxy sync; dense-scene recovery/disposal check after the background correction |
| Studio | `70122d5` | 218 unit/backend; earlier complete 57 browser tests, then 28 focused on the final UI base and 4 transaction checks after proxy sync |
| Combined | `c0c0d1f` | 225 unit/backend; complete 72 browser tests after recovery correction; 4 transaction checks after final backend sync |

The combined review independently found and reproduced a WebGL restoration defect:
Three reset the neutral frame background to black. The renderer now preserves and
reapplies that color. The standalone custom branch includes the same correction,
with an actual background-pixel assertion after repeated context restoration.

Detailed branch reports can be read without switching the main checkout:

```sh
git show experiment/custom-three-graph:docs/experiments/custom-three.md
git show experiment/tracing-studio:docs/experiments/tracing-studio.md
git show experiment/studio-three:docs/experiments/studio-three.md
```

The reviewer compared shared source bytes, not just matching method names.
Renderer-specific drawing/layout and Studio arrangement stay separate from
GraphView, TransactionView, adapter/presentation contracts, domain, browser
wallet/crypto/storage and server code. Browser evidence uses software WebGL, not a physical
mobile GPU benchmark. Native ARM runtime and actual GitHub publication have not
been exercised. The MIT application and Docker/Compose release candidate remain
version 0.2.0.
