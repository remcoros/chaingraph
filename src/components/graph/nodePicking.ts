import { InstancedMesh, type Intersection, type Raycaster } from 'three';

/** A modest shape-preserving margin, shared by hover, mouse clicks and taps. */
const HIT_SCALE = 1.25;

export function createNodePickMesh(visible: InstancedMesh): InstancedMesh {
  // This mesh is never added to the scene or uploaded for rendering.
  const geometry = visible.geometry.clone().scale(HIT_SCALE, HIT_SCALE, HIT_SCALE);
  const pick = new InstancedMesh(geometry, visible.material, 0);
  syncNodePickMesh(visible, pick);
  return pick;
}

export function syncNodePickMesh(visible: InstancedMesh, pick: InstancedMesh) {
  pick.instanceMatrix = visible.instanceMatrix;
  pick.count = visible.count;
  pick.computeBoundingSphere();
}

export function intersectNodes(
  raycaster: Raycaster,
  batches: readonly { mesh: InstancedMesh; pickMesh: InstancedMesh }[],
): Intersection | undefined {
  // A real node surface wins over a neighboring node's invisible margin.
  const direct = raycaster.intersectObjects(
    batches.map((batch) => batch.mesh),
    false,
  )[0];
  if (direct) return direct;
  for (const batch of batches) batch.pickMesh.matrixWorld.copy(batch.mesh.matrixWorld);
  return raycaster.intersectObjects(
    batches.map((batch) => batch.pickMesh),
    false,
  )[0];
}
