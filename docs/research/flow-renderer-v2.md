# Flow renderer v2: engine references

Consulted 2026-09-08. These are primary documentation and license references for
one isolated renderer experiment, not new chain research.

| Source | Applicability and limits |
| --- | --- |
| [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) | Shared cube, sphere and octahedron geometry, per-instance transforms/colors, instance picking and explicit disposal. Draw-call reduction is an architectural property, not an FPS guarantee. |
| [Three.js InstancedBufferGeometry](https://threejs.org/docs/pages/InstancedBufferGeometry.html) | One instance per connection. Original vertex shader projects ribbons and arrowheads into camera space. Camera motion does not replace edge buffers. |
| [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) | Damping, orbit/pan, pointer-relative zoom and touch controls. Updates continue only while damping changes the view. The adapter supplies click/drag discrimination and persistence scheduling. |
| [Three.js MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE) | Already installed and covered by existing dependency notices. No new dependency or third-party implementation was imported. New application code remains MIT. |
| [Babylon.js thin instances](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances/) ([official source](https://github.com/BabylonJS/Documentation/blob/master/content/features/featuresDeepDive/mesh/copies/thinInstances.md)) | Credible alternative for mostly static node batches and picking. Its documentation identifies whole-batch visibility and more costly instance insertion/removal as tradeoffs. No Babylon prototype or benchmark was made. |
| [Babylon.js Apache-2.0 license](https://github.com/BabylonJS/Babylon.js/blob/master/license.md) | Permissive, but introducing it would add its own notice/license obligations. It was not selected or bundled. No claim that its source can simply be relicensed MIT. |

Decision: use direct Three.js, replacing the generic force wrapper at the existing
adapter composition point. It already supplies the required low-level mechanisms
under the current license/dependency policy. The key experiment is controlled
layout, camera behavior and graph drawing; another engine would not remove those
application responsibilities. See the [experiment report](../experiments/flow-renderer-v2.md).
