# Graph rendering research

Reviewed 2026-09-08. These are implementation references, not claims about Bitcoin ownership.

- [3d-force-graph API and examples](https://github.com/vasturiano/3d-force-graph): constructor, incremental data updates, graph picking, force dimensions, camera fitting, and custom scene objects. Confirmed against the installed `3d-force-graph` declarations. MIT-licensed project by Vasco Asturiano and contributors.
- [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html), [Points](https://threejs.org/docs/pages/Points.html), and [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html): a single GPU points layer provides soft selection and cluster halos. This avoids one additional object or full-scene bloom pass per highlighted node.
- Installed `three-forcegraph` types describe mutation of node positions and resolution of link endpoints into objects. The component clones inputs and preserves simulation-owned object identities and coordinates when annotations change.

## Decisions

- The canonical graph contains transaction, output and address entities. Cluster membership changes appearance but does not change the underlying links or establish ownership.
- Node size can encode uniform size, logarithmically scaled satoshi value, or degree.
- Ordinary edges are thin lines; selected incident edges show direction arrows. This avoids rendering cylinders and arrows for every edge in large graphs.
- Selection and inferred clusters receive inexpensive halos. Distinct clusters use deterministic colors. Color is supplemental to the entity inspector, not a confidence scale.
- 2D constrains simulation depth and camera rotation in the same renderer. It still requires WebGL. The app's entity list is the accessible fallback when WebGL is unavailable.
- Resizing follows the actual panel, pixel density is capped at 1.5, and the force simulation cools after 120 ticks or six seconds. Existing layouts survive annotation and selection changes. A newly expanded graph continues its layout from existing coordinates.
- Tooltips use DOM `textContent`, because graph labels and imported annotations are untrusted text.
- Unmount disconnects observers and calls the installed library's destructor to release controls, scene resources, and renderer. Context loss pauses rendering and explains the available fallback.
- Individual node dragging is disabled: the installed graph library's simulated pointer-up during drag completion conflicts with Three.js OrbitControls pointer tracking. Camera orbit/pan and node selection remain available. Re-enable only after testing compatible upstream versions.

## Verification boundary

An isolated React StrictMode browser harness rendered 3,001 frozen synthetic nodes and 3,000 links using Chromium with SwiftShader. Selection, glow, degree sizing and 2D toggles preserved the same canvas; an actual node click invoked selection; simulated WebGL context loss displayed the fallback; no browser errors remained after the interaction fixes above. Frozen inputs checked that graph rendering did not mutate caller-owned records. This is a functional smoke check, not an FPS benchmark or proof of mobile performance. The temporary harness is outside the repository; the app's end-to-end suite provides its persistent regression coverage.

The component passed TypeScript checking when the domain interfaces became available. Complete application build status is recorded by the coordinating agent. Production GPU/mobile performance still requires representative device measurements. There is no arbitrary truncation in the graph component.
