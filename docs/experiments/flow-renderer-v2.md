# Flow renderer v2

Local experiment on `experiment/flow-renderer-v2`, rebased onto main `daaaaee` (including `1e3dd63`).
The renderer now uses Compact only. Directed and the layout picker were removed
following review: stage shelves produced too many crossings and poor overviews.

## Engine and scope

Direct Three.js replaces the generic force-graph wrapper behind
`src/components/graph/defaultAdapter.ts`. Babylon.js thin instances were briefly
considered; Three.js already supplied instancing, picking and cursor zoom under
the existing MIT policy. The MIT d3-force-3d 3.0.6 dependency supplies stopped
force calculations. [Primary sources and licenses](../research/flow-renderer-v2.md)
record the decision. No old experiment was merged or copied wholesale, and its
rejected Studio preference was not used.

GraphView owns selection, hover-card content, annotation, trace and visibility
actions. Main's wallet Addresses/Transactions/UTXOs tabs, retained wallet context, and output action
**Open creating transaction** are preserved, including enablement. Transaction
ancestor loading stays explicit. There are no backend, storage, encryption or
schema changes in the renderer work, and no new wallet or analysis workflow.

Optional `RenderNode.selected` separates selection emphasis from glow. Optional
adapter `zoom(factor)` and `repack()` expose only renderer actions; other adapters
can omit them. GraphView's optional `navigationStatus` slot places filter/visibility
context after every control group, in DOM and visual order.

## Layout, controls and persistence

Fresh graphs settle into rounded force neighborhoods over 180 manual worker ticks.
They do not continue shuffling. Flat computes a separate 2D arrangement instead
of projecting a sphere onto a plane. Existing positions anchor incremental loads:
only new nodes enter the simulation. Their fixed connections act as tethers;
a spatial grid built once per request resolves nearby fixed-node collisions.
Distant existing nodes no longer incur force-tree work on every tick. Frames are
immutable; only private particles and link copies are mutated. Every underlying
node and individual connection remains represented, without aggregation or
ownership implications.

The worker runs one job at a time and retains only the latest replacement request.
Intermediate expansions no longer queue obsolete simulations. Ordinary idle saves
wait for layout completion; explicit lock/export/switch flush still completes any
pending layout. Camera gestures defer snapshots and encrypted saves. Frozen
snapshot geometry is reused between camera changes.

The floating toolbar groups selection history, center/lock, the existing path
filter, Fit, zoom out/in and Repack. Button zoom uses the viewport center; wheel
zoom remains pointer-relative. Repack explicitly rearranges visible nodes and fits
them, including an older saved Directed layout. Metadata edits and ordinary
expansion never repack. The hidden-selection message has its own footer below
all buttons and no leading separator; it cannot split the camera controls.
Existing amount and annotation controls remain in their shared toolbar.

Version-1 snapshots retain exact coordinates and camera orientation. 3D/Flat
return views are cached during the session. No strategy picker or strategy field
is stored. Repack clears those caches. Fit/focus preserves orientation and reserves
space for the floating toolbar, including a wrapped status footer.
Selection focus waits for final geometry, including when a watched address is
selected before its graph frame arrives. Subsequent manual gestures cancel that
deferred focus, so a late layout reply cannot override the user's camera.

Three shape batches respect supplied radii, palette, labels/icons and highlights.
An edge batch draws ribbons and direction arrows; all funding/spending connections
retain arrows while address associations remain arrowless. Node and edge buffers
use geometric capacity growth and reuse allocations for ordinary additions.
Picking ignores spare capacity. Buffers release resources on resizing/disposal;
context loss/recovery remains supported. Captions are pooled and decluttered,
with selected/hovered annotations prioritized. Links never open hover cards;
touch gestures never hover, and drag/pinch does not accidentally select.

## Performance evidence

The old layout integrated every fixed node for every tick. A synthetic Node 24 CPU
benchmark added 12 nodes beside a fixed grid with identical input before/after.
Three runs per size produced these median layout times:

| Existing nodes | Previous Compact | Incremental Compact |
| -------------- | ---------------: | ------------------: |
| 720            |           883 ms |               14 ms |
| 1,500          |         2,270 ms |               10 ms |
| 5,000          |        12,211 ms |               27 ms |

These measure placement calculation, not RPC, rendering, encryption or FPS.
The separate Chromium worker/renderer check added 12 nodes beside 1,500 existing
nodes in 95 ms from update to accepted layout, using a frame-boundary poll. All
1,512 nodes and 1,511 connections remained; existing coordinates, camera and
allocated node/edge buffers stayed unchanged. This scene used three draw calls.
Timing is one local browser observation, not a latency guarantee.

Evidence uses Chromium/ANGLE SwiftShader software WebGL at DPR 1. Physical GPUs,
mobile hardware, Firefox and Safari were not benchmarked. Initial/repack layouts
still simulate the whole visible graph. Large additions or very dense collision
neighborhoods remain more expensive; explicit flush can still pause on a large
unsettled layout. Packing is bounded, not guaranteed optimal or fully converged.

## Validation and limits

The renderer suite passed 12 cases covering real node/line picking, directional
arrow pixels, orbit/pan/cursor zoom, Flat, stable edits/filtering/expansion, touch,
WebGL recovery/disposal, unavailable workers, immediate flush, obsolete worker
replies, Repack, dense GPU-capacity reuse, and isolated-address focus before a
frame/worker reply, with and without intervening manual gestures.

Across serial runs, 27 distinct targeted browser cases passed: those 12 renderer
cases, 10 shared camera/autosave/save-transition/selection/persistence cases, two
hidden-selection footer checks at 1440/390 pixels, wallet-history editing, wallet
Addresses selection, and desktop/mobile graph bounds. The Addresses case verifies
that a zero-output address remains visible after layout and save settling without
RPC. Two older camera/selection test setups now explicitly select an input to
match main's scoped creator loading. Main's GraphView action section has no
renderer changes. The four focused unit files passed all 21 tests; the production
build and portability check passed.

Foundation wallet/cryptography suites and live scans were not repeated. The five
bundled cases use the ordinary template creation UI and the existing backend;
no fresh chain curation is needed.
All five passed the final preview interaction script after rebasing onto
`daaaaee`, with no captured console/page errors. Fresh screenshots were inspected
for rounded dense structure, value contrast, selection/editing, status-footer
order and mobile bounds, alongside the earlier main-renderer comparison captures.

Compact reduces sparse-path travel but trades away stage ordering. Dense hubs can
still occlude nodes in projection. Exactly end-on links need camera movement to
show direction. Later value-sizing changes preserve positions and may overlap;
Repack can incorporate the current radii. Anchored investigations can leave long
links when paths join. Full metadata remains in the shared card/inspector; captions
truncate and selection outlines do not perform depth occlusion. The narrow-screen
graph area is still small when the transaction panel is expanded. Repack is an
explicit arrangement replacement, without a separate layout undo history.

## Reproduce and evidence

Preview remains <http://127.0.0.1:3116>, using the existing backend on 4000:

```sh
CHAINGRAPH_PROXY_TARGET=http://127.0.0.1:4000 node --use-system-ca node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3116 --strictPort
npx vitest run tests/flow-layout.test.ts tests/graph-presentation.test.ts tests/graph-camera-framing.test.ts tests/graph-snapshot.test.ts
# Run browser suites serially with free ports:
CHAINGRAPH_E2E_PORT=4191 CHAINGRAPH_GRAPH_TEST_PORT=4192 npx playwright test tests/e2e/flow-renderer-v2.spec.ts
# CPU-only baseline and current placement, without modifying another checkout:
node --import tsx scripts/benchmark-compact-layout.ts --baseline=312a676
node --import tsx scripts/benchmark-compact-layout.ts
# After browser suites, with the preview running:
node scripts/review-flow-renderer-v2.mjs --compact
npm run build
npm run check:portability
```

Ignored `artifacts/flow-renderer-v2/compact/` contains CPU timing JSON, browser test
artifacts, and `index.html` comparing current Compact with earlier Compact/main
captures. `hidden-by-filters-1440.png` and `hidden-by-filters-390.png` show the status
footer fix. Per-case 3D/Flat, selection, editing, address and mobile captures show
the bundled workflows. The published test wallet is test material; never deposit.
