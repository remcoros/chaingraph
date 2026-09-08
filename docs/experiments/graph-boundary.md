# Shared graph boundary

Implemented on `refactor/graph-engine-boundary`, starting from reviewed main `cd34f78`. The default renderer remains `3d-force-graph`. This boundary separates the shared React workbench interactions from renderer state so the custom Three.js experiment can later use the same view.

## Ownership and integration

- `GraphView.tsx` owns semantic ID lookup, node and edge selection routing, hover cards, keyboard details, trace/edit actions and disabled reasons. It observes the actual viewport and provides the same behavior to every adapter factory.
- `graph/presentation.ts` resolves domain nodes/links into visual primitives. Optional `nodePresentation: ReadonlyMap<string, NodePresentation>` supplies `color`, `highlight` and `scale`; tag, wallet-match and finding interpretation stays with callers. Selection color takes precedence; glow gates highlighting. Omitted overrides restore the existing kind/cluster and sizing defaults. Callers should replace the map when its contents change.
- `graph/adapter.ts` defines a small factory and instance contract: `update`, `resize`, `focus`, `fit`, `dispose`, and a canvas reference for accessibility focus. Events carry stable node/link IDs and viewport-local CSS coordinates with pointer type. No simulation object, transaction record, domain callback or workspace enters the engine.
- `graph/forceAdapter.ts` owns mutable clones, simulation identity, positions, depth restoration, WebGL resources, controls, picking and camera operations. Presentation-only changes retain the simulation and camera.

`GraphView` also accepts optional `toolbar` and `legend` React content. Toolbar content occupies layout above the graph viewport, with wrapping; the legend belongs to that viewport. The adapter sees neither content nor semantic callbacks. The committed substitute-adapter fixture verifies the shared toolbar, legend, actions, lifecycle and viewport boundary. Root can route the reviewed controls into these slots during integration. Existing App toolbar/legend markup remains unchanged and is not duplicated by default. App, inspector, icon picker, transaction DOM view and all backend/storage/crypto modules are untouched.

A custom renderer only needs to implement `GraphAdapterFactory` and accept the already resolved `GraphFrame`. Pass that factory through `GraphView.adapterFactory`. It must clone data before mutation, report IDs instead of renderer objects, distinguish taps from camera gestures, and release listeners and graphics resources on disposal. Future custom-only camera actions can be expressed as adapter capabilities after root supplies the final foundation; this commit does not introduce a plugin system or engine-specific React interaction fork.

## Preserved behavior and corrections

Forcegraph keeps the reviewed cube/sphere/octahedron shapes, selected incident links/arrows, cluster colors, value/degree sizing, batched glow, simulation cooldown, pixel-density cap, pointer-directed zoom, screen-space panning and damping. Flat mode maps mouse/one-finger drag to pan; 3D maps them to orbit. Two fingers pan/pinch. Reduced motion disables damping and camera transitions. Existing entity-list and inspector routes remain available on WebGL failure.

Empty engine-stop events retain the first-fit request. Hidden canvases retain the last nonzero viewport instead of setting a 1-pixel render target and consuming fit while invisible. Fit and focus made while hidden run after reveal. Empty 2D initialization uses no camera tween. Explicit focus and manual camera gestures cancel pending automatic fitting. Browser regressions cover both visible empty-to-data and hidden-data-to-reveal transitions.

The combined experiment's committed source and report (`403c8c9`) informed touch and viewport handling. A real browser test exposed forcegraph's intermittent cached-pick race on a tap completed between render frames. The adapter now raycasts node meshes at touch-up and resolves nearby projected link segments, prioritizing nodes. Touch does not open hover cards. Movement beyond five pixels, cancellation and multiple pointers suppress selection. Mouse hover retains the force engine's picker, including same-node re-entry after visiting a React action card. Hover-card anchors stay stable while moving toward their buttons.

GPU cleanup now explicitly removes/disposes the halo layer as well as shared node geometry/material caches and engine resources. Colors no longer in the graph are released from the material cache.

## Validation

An independent `npm ci` installed this worktree's dependencies. Package manifests, lockfile and dependencies are unchanged. Browser tests use fresh Playwright contexts, Chromium/SwiftShader and only ports 4205 (app) and 4206 (fixture). No private browser profile, live-node request or additional preview was needed. Existing preview 3103 and experiment branches were left unchanged.

```sh
NODE_OPTIONS=--use-system-ca npm run build
NODE_OPTIONS=--use-system-ca npm test
CHAINGRAPH_E2E_PORT=4205 CHAINGRAPH_GRAPH_TEST_PORT=4206 NODE_OPTIONS=--use-system-ca npm run test:e2e
```

The production build, all 166 unit/backend tests in 15 files, and the full 36-test browser suite pass. After final disposal and touch-picking hardening, the build, unit suite and all seven focused graph browser tests were rerun successfully. Formatting and git whitespace checks pass.

The focused contract tests cover mutable-clone isolation, visual-only updates, first-data fit, hidden fit/focus, 2D/3D mappings, focus distance, resize, explicit fit, stable ID events, local pointer coordinates, gesture cancellation, context loss and idempotent disposal. Pure presentation tests cover all edge action targets, override precedence, selection/arrow styling and filtered degree sizing.

Real browser tests retain rendered-pixel silhouette checks and actual node/edge hover picking, trace/edit actions and keyboard focus. Additional tests exercise a substitute adapter through the same GraphView, selected node and all edge actions, busy trace state, stale data dismissal, shared chrome, empty first data, hidden reveal, desktop pan/orbit, focus/fit, mobile node/link taps, drag and pinch selection suppression. Full-workbench captures exercise the existing reviewed controls and a hidden/revealed mobile graph.

Desktop and mobile screenshots are actual Chromium renders, not design mockups:

- [Desktop force fixture](graph-boundary/desktop-force.png)
- [Mobile force tooltip](graph-boundary/mobile-force.png)
- [Desktop workbench](graph-boundary/desktop-workbench.png)
- [Mobile workbench](graph-boundary/mobile-workbench.png)

These establish functional behavior under desktop Chromium and mobile emulation with SwiftShader. They do not establish hardware performance or a mobile-device benchmark. The existing force layout still produces compact dense laboratory fans; this boundary does not replace its layout algorithm.

## Handoff

The integration interface was announced in `/tmp/chaingraph-review-sessions/graph-boundary-interface.md`. The completed commit and final test results are handed off in `/tmp/chaingraph-review-sessions/graph-boundary-ready.md`. Experimental branches `experiment/custom-three-graph` at `0d58cf5` and `experiment/studio-three` at `403c8c9` have only been read as committed source/reports. They will not be rebased until root supplies the final integrated main base. Nothing is pushed or published.
