# Flow renderer v2

One local experiment on `experiment/flow-renderer-v2`, based on main `7fcc98e`.
It supports exact-outpoint tracing and annotation in the existing wallet workbench.

## Decision and scope

Direct Three.js replaces the generic force wrapper behind `graph/defaultAdapter.ts`.
Babylon.js thin instances were the alternative considered. Three.js already provides
instancing, picking and cursor zoom under the existing MIT dependency policy; no
new drawing dependency was needed. The Compact follow-up pins the already-used
MIT `d3-force-3d` 3.0.6 as a direct layout dependency. [Primary sources, licenses and limits](../research/flow-renderer-v2.md)
were checked on 2026-09-08. New application code remains MIT.

GraphView, the 2D flow, toolbars, side panels, semantic selection, tracing, annotation
and visibility actions remain shared. Wallets, scanning, analysis, backend, schemas,
encryption and storage are unchanged. Trace/canvas integration can use the same
adapter. The only additive contract field is `RenderNode.selected?: boolean`, which
lets selection remain visible with glow disabled. Older adapters can ignore it.

Read-only inspection of `experiment/custom-three-graph` identified useful anchoring
and batching, but also rigid ordering, per-camera edge reconstruction, no damping,
and captions conflating glow with selection. No old branch was merged or renderer
copied wholesale. Its historical Studio preference was not used.

## Layout, drawing and interaction

The renderer's small **Compact / Directed** selector chooses between two static
layouts. Compact is the default for fresh graphs. It uses 180 stopped d3-force-3d
ticks in the worker, with link attraction, charge, radius-aware collision and weak
centering. Hubs form rounded 3D neighborhoods and sparse paths occupy less space.
Flat gets a separate 2D simulation, avoiding a flattened sphere's overlap.

Directed assigns stages and orders neighbors in two sweeps. Dense stages use
staggered shelves: rows remain separate in Flat, while depth separates columns in
3D. It remains useful for explicit input → transaction → output inspection. Layout
positions never imply time, amount or ownership. Every node and individual
connection remains present; there are no aggregate nodes or merged edges.

Within a chosen layout, existing positions are immutable anchors. New parents/spenders extend around them,
filters retain a bounded coordinate cache, and metadata edits do not run layout.
Revision checks reject stale worker replies. Worker failure uses the same local
algorithm. Version-1 snapshots restore existing coordinates and perspective cameras,
including old force layouts. An explicit checkpoint completes any pending layout
synchronously so lock/export/switch captures the latest view.

Choosing a strategy explicitly rearranges and fits the graph. Switching back restores
its cached positions and camera during the session, including separate Compact
3D/Flat views. A native, keyboard-accessible selector is the only new control.
Loaded snapshots show **Saved view** and retain their exact coordinates/camera until
an explicit choice. No schema field was added: algorithm identity and alternative
views are not persisted. New nodes in a reopened Saved view use Compact placement
around its fixed anchors. Switching to another strategy then back to Saved view is
also reversible during the session. All coordinate caches have the existing node
limit and at most six strategy/dimension entries.

Three instanced shape batches respect supplied silhouettes, radii and palette.
One edge batch projects trimmed ribbons and camera-facing arrows in its vertex
shader. Stable staggering avoids coincident arrow walls. Camera motion never
rebuilds these buffers. Every funding/spending connection has an arrow; address
associations retain their existing zero-arrow, non-flow semantics. Degree-dependent
selection emphasis limits brightness around dense hubs. Selection brackets work
independently from the glow toggle.

Up to 48 collision-checked captions prioritize selection, hover and highlights.
Repeated text is suppressed until hovered. Labels, tags and icons use supplied text
and existing toggles. Pooled DOM captions and outlines are visual only. Nodes are
picked before links; links never open hover cards. Touch does not hover, and drags
or pinches do not select accidentally.

Left drag orbits in 3D and pans in Flat; right/Shift drag pans. Wheel zoom follows
the pointer; two fingers pan/pinch. Arrow keys pan, plus/minus zoom, F fits, and
shared Enter opens selected details. Damping stops when settled and is disabled for
reduced motion. Fit/focus is immediate, preserves orientation and accounts for
navigation. Manual gestures cancel automatic reframing. Metadata edits and failed
requests preserve the camera.

Snapshots wait for 1.2 seconds of quiet and idle dispatch, reusing frozen geometry.
Explicit flush captures the current visible camera and cancels residual damping.
Context loss releases activity and requests browser recovery; restoration clears
the shared error. Disposal releases controls, worker, callbacks, GPU and DOM state.

## Initial directed implementation validation

Final targeted browser run: **25 passed in 4.2 minutes**, serially, with source held fixed.

- Independent `npm ci`, build, TypeScript and changed-file formatting passed.
- 20 focused layout, presentation, camera-framing and snapshot unit tests passed.
- Seven renderer browser regressions cover actual picking/coordinates, rendered
  arrow pixels, stable edge buffers, orbit/pan/cursor zoom, Flat, immutable frames,
  metadata/filter/parent stability, literal text, touch tap/orbit/pinch, hidden first
  fit, unavailable workers, legacy cameras, repeated context recovery/disposal,
  and immediate flush during pending layout.
- Shared checks cover dense gesture/save deferral, encryption-failure retry,
  lock/export/switch/beforeunload, failed-request camera preservation, selection
  lock, desktop/mobile navigation, encrypted view restoration and visibility.

All five requested examples were created through the ordinary template dialog in
fresh browser contexts on the running preview. Each passed graph-body selection,
shared hover-card editing, 2D output and Entities selection, label/note edits, amount
filtering, hide/show, selection lock, orbit/zoom and lock/reopen. The public-wallet
case also changed an icon/tag and toggled captions and address display. The testnet4
case navigated its already-loaded exact spender. Both configured networks were
discovered through the existing backend. No fresh scan, curation, live-chain
validation or broad wallet/cryptography suite was run.

The same cases were captured using main's unchanged force adapter in this checkout.
All ten case runs had zero browser errors. Initial node/connection counts matched:
WabiSabi 720/933, Whirlpool 37/36, public wallet 21/19, large-value path 36/36,
testnet4 spent output 8/7. WabiSabi retains 114 loaded transaction records. Value
sizing visibly distinguishes 340,000,000,000 from 59,849,955,894 sats.

Opened screenshots show v2 separating WabiSabi funding, inputs, transaction and
outputs, with readable selected captions. Stable positions make returning from an
edit predictable. Main uses vertical space more compactly for sparse graphs; v2's
long directed paths need focus/zoom more often. Shared card and inspector editing
remain reachable without a new workflow.

The controlled three-shape scene uses four draw calls and returns GPU geometry
counts to zero on disposal. The autosave case displays 1,501 nodes while retaining
15,000 observations: zero encryption jobs during gestures, a 2,509 ms drag, and a
maximum observed gesture long task of 113 ms in this run. These are narrow resource
and scheduling observations, not FPS measurements. All browser evidence uses
Chromium/ANGLE SwiftShader software WebGL at DPR 1. Physical GPU, Safari, Firefox
and mobile hardware performance were not measured.

Iteration fixed reversed arrow winding, touch-leave hover, excessive dense-selection
brightness, repeated captions and pending-layout flush. One run made while source
was changing failed its idle-save assertion; the final run holds source fixed.

## Compact follow-up validation

The follow-up compares Compact, Directed and the initial main screenshots in the
same five bundled workspaces. Use `node scripts/review-flow-renderer-v2.mjs --layouts`
for current screenshots and the editing/navigation pass. Evidence is under ignored
`artifacts/flow-renderer-v2/layouts/`. Initial captures of Saved view confirmed
compatible restoration; current overview captures explicitly choose Compact.

New unit regressions measure rounded dense-hub spans, deterministic ordering,
immutable input, sparse path diameter, 2D geometry and anchored expansion/filtering.
The synthetic twelve-node path has less than half the diameter of Directed.
New browser regressions cover keyboard layout choice, return-camera/position
caches, Flat/3D restoration, legacy snapshots, rapid strategy changes and immediate
checkpointing with obsolete worker replies.

Fixed-source results: **27 browser tests passed**, serially (nine renderer tests in
26.3 seconds, 18 shared tests in 4.0 minutes). **23 focused unit tests**, TypeScript,
build and changed-code formatting passed. Shared checks include gesture save
deferral, encryption-failure retry, failed-request camera preservation,
lock/export/switch, selection lock, visibility and encrypted view restoration.
The 1,501-node autosave fixture retained 15,000 observations, with zero encryption
jobs during gestures and a maximum observed gesture long task of 94 ms. This is
software WebGL scheduling evidence, not an FPS or physical GPU benchmark.

The initial development capture restarted after Vite's one-time dependency
optimization reload. Subsequent browser runs use settled dependencies and fixed
renderer source.

The final five-template preview pass had zero browser errors and unchanged
node/connection counts. It repeated graph/2D/Entities selection, shared-card
label/note editing, filters, hide/show, selection lock and lock/reopen. The wallet
also exercised tags/icons/address visibility; testnet4 traversed its loaded spender
and checked the narrow screen. Screenshots were opened for all five Compact
cases and compared with Directed and the initial main baseline. WabiSabi returns
to a rounded hub; wallet and Whirlpool paths fit into tighter neighborhoods.
The large-value pair remains visibly different. Dense central overlap and the
small mobile graph area remain tradeoffs. `layouts/index.html` links full-size
Compact, Directed and main images plus Flat, selection and editing evidence.

## Limits

Compact trades stage ordering for less travel; dense hubs can still occlude nodes.
Collision uses radii at placement time; later value-sizing changes preserve positions
and can introduce overlap. The bounded solver does not guarantee convergence or
optimal packing. Saved view preserves geometry, not the previous strategy identity.
Synchronous checkpoint/worker-failure simulation can pause on large unseen graphs.

Anchoring can leave long or backward-looking links when investigations join; arrows
retain their actual direction. There is no crossing optimizer. Dense overviews
still require zoom or existing filters. An exactly end-on edge has no readable
projected direction until the camera moves. Tiny nodes can be subpixel at Fit.
Captions truncate to two lines; full metadata remains in the shared card/inspector.
Selection/glow outlines are screen overlays without depth occlusion. Maximum-size
fallback layout and heavily highlighted DOM scenes are unbenchmarked. Both modes
require WebGL, and the custom renderer adds application code to maintain.

## Reproduce and evidence

Preview, using the existing backend:

```sh
CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4000 node --use-system-ca node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3116 --strictPort
```

Open <http://127.0.0.1:3116> and create a bundled example. The published BIP84 test
wallet is test material; never deposit. No environment file is needed by this command.

```sh
npx vitest run tests/flow-layout.test.ts tests/graph-presentation.test.ts tests/graph-camera-framing.test.ts tests/graph-snapshot.test.ts
CHAINGRAPH_E2E_PORT=4191 CHAINGRAPH_GRAPH_TEST_PORT=4192 npx playwright test \
  tests/e2e/flow-renderer-v2.spec.ts tests/e2e/graph-autosave-performance.spec.ts \
  tests/e2e/graph-camera-preservation.spec.ts tests/e2e/graph-save-transitions.spec.ts \
  tests/e2e/graph-boundary-workbench.spec.ts tests/e2e/selection-controls.spec.ts \
  tests/e2e/view-persistence.spec.ts tests/e2e/visibility.spec.ts \
  --output artifacts/flow-renderer-v2/final-tests
npm run build
npm run check:portability
# Serially after browser suites, with port 4192 free:
node --use-system-ca scripts/review-flow-renderer-v2.mjs
node --use-system-ca scripts/review-flow-renderer-v2.mjs --baseline
```

The baseline temporarily serves main's force adapter without changing checkout
files or other previews. Local evidence stays under ignored `artifacts/flow-renderer-v2/`:
`index.html` compares images; `flow-<case>-3d.png` and `main-<case>-3d.png` are the
five pairs. Additional `-flat`, `-selected`, `-hover-edit`, `-addresses`, `-hop` and
`-mobile` captures show workflows. `flow-observations.json`, `main-observations.json`
and `final-tests/` retain the observed counts, renderer and test artifacts.
