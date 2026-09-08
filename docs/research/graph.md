# Graph rendering research

Reviewed 2026-09-08. These are implementation references, not claims about Bitcoin ownership.

- [3d-force-graph API and examples](https://github.com/vasturiano/3d-force-graph): constructor, incremental data updates, graph picking, force dimensions, camera fitting, and custom scene objects. Confirmed against the installed `3d-force-graph` declarations. MIT-licensed project by Vasco Asturiano and contributors.
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [Points](https://threejs.org/docs/pages/Points.html), and [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html): a single GPU points layer provides soft selection and cluster halos. This avoids one additional object or full-scene bloom pass per highlighted node.
- Installed `three-forcegraph` types describe mutation of node positions and resolution of link endpoints into objects. The component clones inputs and preserves simulation-owned object identities and coordinates when annotations change.
- [Three.js BoxGeometry](https://threejs.org/docs/pages/BoxGeometry.html) and [OctahedronGeometry](https://threejs.org/docs/pages/OctahedronGeometry.html), together with the graph library's `nodeThreeObject`, supply distinct transaction cubes, output spheres, and address octahedra. Shared geometry and color materials keep the additional resource count bounded; selection updates meshes in place.

## Decisions

- The canonical graph contains transaction, output and address entities. Cluster membership changes appearance but does not change the underlying links or establish ownership.
- Node size can encode uniform size, logarithmically scaled satoshi value, or degree.
- Ordinary edges are thin lines; selected incident edges show direction arrows. This avoids rendering cylinders and arrows for every edge in large graphs.
- Selection and inferred clusters receive inexpensive halos. Distinct clusters use deterministic colors. Color is supplemental to the entity inspector, not a confidence scale.
- 2D constrains simulation depth and camera rotation in the same renderer. It still requires WebGL. The app's entity list is the accessible fallback when WebGL is unavailable.
- Resizing follows the actual panel, pixel density is capped at 1.5, and the force simulation cools after 120 ticks or six seconds. Existing layouts survive annotation and selection changes. A newly expanded graph continues its layout from existing coordinates.
- Hover cards use React text interpolation, because graph labels and imported annotations are untrusted text. Native HTML-string tooltips are disabled. Node and link cards show identifiers, available values, saved confirmations, and funding-data gaps; create/spend links act on their output, while address links act on their address.
- Cards remain open while hovered or focused, with a short leave delay. They expose previous-level loading and label/notes editing; address cards omit previous-level loading because that operation has no unambiguous address meaning. A selected entity's card also opens with Enter or Space on the canvas and closes with Escape. Touch users can use the parent entity list and inspector.
- The installed renderer retains its picked object while the pointer is over an HTML card. Reopening after an action therefore waits for actual canvas pointer movement and a renderer update, avoiding stale cards when the HTML card disappears.
- Unmount disconnects observers and calls the installed library's destructor to release controls, scene resources, and renderer. Context loss pauses rendering and explains the available fallback.
- Individual node dragging is disabled: the installed graph library's simulated pointer-up during drag completion conflicts with Three.js OrbitControls pointer tracking. Camera orbit/pan and node selection remain available. Re-enable only after testing compatible upstream versions.

## Verification boundary

An isolated React StrictMode browser harness rendered 3,001 frozen synthetic nodes and 3,000 links using Chromium with SwiftShader. Selection, glow, degree sizing and 2D toggles preserved the same canvas; an actual node click invoked selection; simulated WebGL context loss displayed the fallback; no browser errors remained after the interaction fixes above. Frozen inputs checked that graph rendering did not mutate caller-owned records. This is a functional smoke check, not an FPS benchmark or proof of mobile performance. The temporary harness is outside the repository; the app's end-to-end suite provides its persistent regression coverage.

The persistent `tests/e2e/graph-hover.spec.ts` fixture uses the real renderer and mouse picking. It reads rendered pixels to locate and compare cube, sphere, and octahedron silhouettes, then exercises node cards, all three link relationships, callback targets, delayed pointer leave, editing focus, and keyboard opening/dismissal. Its temporary Vite cache and data are isolated from the app and browser workspace storage.

The component passed TypeScript checking when the domain interfaces became available. Complete application build status is recorded by the coordinating agent. Production GPU/mobile performance still requires representative device measurements. There is no arbitrary truncation in the graph component.
