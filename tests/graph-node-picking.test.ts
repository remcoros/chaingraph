import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  createNodePickMesh,
  intersectNodes,
  syncNodePickMesh,
} from '../src/App/Workspace/Workbenches/Graph/Renderer/nodePicking';

const ray = (x: number) => new Raycaster(new Vector3(x, 0, 10), new Vector3(0, 0, -1));

describe('node hover and selection padding', () => {
  it.each([
    ['box', () => new BoxGeometry(1.6, 1.6, 1.6), 0.8],
    ['sphere', () => new SphereGeometry(1, 16, 12), 1],
    ['address', () => new OctahedronGeometry(1.4), 1.4],
  ] as const)(
    'adds a bounded margin around %s without changing its visible geometry',
    (_name, geometry, extent) => {
      const mesh = new InstancedMesh(geometry(), new MeshBasicMaterial(), 1);
      mesh.setMatrixAt(0, new Matrix4().makeTranslation(4, 0, 0));
      const before = Array.from(mesh.instanceMatrix.array);
      const pickMesh = createNodePickMesh(mesh);
      const near = ray(4 + extent * 1.1);
      expect(near.intersectObject(mesh)).toHaveLength(0);
      expect(intersectNodes(near, [{ mesh, pickMesh }])).toMatchObject({
        object: pickMesh,
        instanceId: 0,
      });
      expect(intersectNodes(ray(4 + extent * 1.3), [{ mesh, pickMesh }])).toBeUndefined();
      expect(Array.from(mesh.instanceMatrix.array)).toEqual(before);
      expect(pickMesh.geometry).not.toBe(mesh.geometry);
      expect(pickMesh.parent).toBeNull();
      mesh.geometry.dispose();
      pickMesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
      pickMesh.dispose();
    },
  );

  it('prefers an actual node over another node’s nearer padding and refreshes moved/shrunk batches', () => {
    const mesh = new InstancedMesh(new BoxGeometry(1.6, 1.6, 1.6), new MeshBasicMaterial(), 2);
    mesh.setMatrixAt(0, new Matrix4());
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(1.7, 0, 3));
    const pickMesh = createNodePickMesh(mesh);
    const batches = [{ mesh, pickMesh }];
    expect(ray(0.75).intersectObject(pickMesh)[0].instanceId).toBe(1);
    expect(intersectNodes(ray(0.75), batches)).toMatchObject({ object: mesh, instanceId: 0 });

    mesh.count = 1;
    mesh.setMatrixAt(0, new Matrix4().makeScale(2, 2, 2).setPosition(8, 0, 0));
    mesh.computeBoundingSphere();
    syncNodePickMesh(mesh, pickMesh);
    expect(intersectNodes(ray(9.8), batches)).toMatchObject({ object: pickMesh, instanceId: 0 });
    expect(intersectNodes(ray(0.75), batches)).toBeUndefined();
    mesh.count = 0;
    syncNodePickMesh(mesh, pickMesh);
    expect(intersectNodes(ray(9.8), batches)).toBeUndefined();
    mesh.geometry.dispose();
    pickMesh.geometry.dispose();
    mesh.material.dispose();
    mesh.dispose();
    pickMesh.dispose();
  });
});
