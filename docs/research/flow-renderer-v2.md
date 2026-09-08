# Flow renderer v2: engine references

Consulted 2026-09-08. These are primary documentation and license references for
one isolated renderer experiment, not new chain research.

| Source                                                                                                                                                                                                                                                 | Applicability and limits                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)                                                                                                                                                                            | Shared cube, sphere and octahedron geometry, per-instance transforms/colors, instance picking and explicit disposal. Draw-call reduction is an architectural property, not an FPS guarantee.                              |
| [Three.js InstancedBufferGeometry](https://threejs.org/docs/pages/InstancedBufferGeometry.html)                                                                                                                                                        | One instance per connection. Original vertex shader projects ribbons and arrowheads into camera space. Camera motion does not replace edge buffers.                                                                       |
| [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)                                                                                                                                                                            | Damping, orbit/pan, pointer-relative zoom and touch controls. Updates continue only while damping changes the view. The adapter supplies click/drag discrimination and persistence scheduling.                            |
| [Three.js MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE)                                                                                                                                                                            | Already installed and covered by existing dependency notices. The drawing engine remains unchanged by the Compact layout follow-up. New application code remains MIT.                                                     |
| [Babylon.js thin instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances/) ([official source](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/copies/thinInstances.md)) | Credible alternative for mostly static node batches and picking. Its documentation identifies whole-batch visibility and more costly instance insertion/removal as tradeoffs. No Babylon prototype or benchmark was made. |
| [Babylon.js Apache-2.0 license](https://github.com/BabylonJS/Babylon.js/blob/master/license.md)                                                                                                                                                        | Permissive, but introducing it would add its own notice/license obligations. It was not selected or bundled. No claim that its source can simply be relicensed MIT.                                                       |

Decision: use direct Three.js, replacing the generic force wrapper at the existing
adapter composition point. It already supplies the required low-level mechanisms
under the current license/dependency policy. The key experiment is controlled
layout, camera behavior and graph drawing; another engine would not remove those
application responsibilities. See the [experiment report](../experiments/flow-renderer-v2.md).

## Compact layout follow-up

Consulted 2026-09-08. Reuse the force calculation behind force-graph while retaining
our own renderer, picking, camera and save scheduling. No second renderer was added.

| Source                                                                                   | Applicability and limits                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [d3-force-3d API](https://github.com/vasturiano/d3-force-3d)                             | Three-dimensional link, charge and collision forces, deterministic initialization, fixed positions and manual ticks. The simulation mutates particles/links, so only private copies enter it. |
| [D3 simulation](https://d3js.org/d3-force/simulation)                                    | Stop the automatic timer, tick a finite static layout in a worker, retain fixed anchors. The cited base API is 2D; d3-force-3d supplies the 3D extension.                                     |
| [D3 link force](https://d3js.org/d3-force/link)                                          | Degree-dependent link strength keeps high-degree hubs from overpowering every neighbor. Links remain individual observations, not merged or inferred ownership.                               |
| [d3-force-3d MIT license](https://github.com/vasturiano/d3-force-3d/blob/master/LICENSE) | Pin the already-installed transitive version 3.0.6 as a direct dependency. Existing generated dependency notices include its attribution and license. No other dependency was added.          |

Decision: use 180 manual ticks with link distance, charge, radius-aware collision
and weak centering. This recovers rounded hubs and compact sparse paths without a
continuously moving force graph. Anchors prevent edits/filtering/expansion from
shuffling the investigation. There is no global layout-quality or FPS claim.

## Incremental Compact follow-up

Rechecked 2026-09-08: [D3 simulation and custom forces](https://d3js.org/d3-force/simulation)
and [Three.js InstancedMesh count/capacity](https://threejs.org/docs/pages/InstancedMesh.html).
Only additions are integrated. Original MIT application code supplies fixed-link
tethers and a static collision grid; all visible fixed obstacles remain in that
index, and all nodes/connections remain in drawing. No external spatial-index
implementation was copied. The stopped 180-tick fresh layout remains unchanged.
Node and edge capacity grows geometrically, with explicit disposal when replacing
GPU buffers. These mechanisms motivated measured CPU/browser checks; documentation
alone does not establish speed. Directed was removed after usability review.
