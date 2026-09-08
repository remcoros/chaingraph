import { Vector3 } from 'three';
import type { RenderNode } from './adapter';

type Point = { x: number; y: number; z: number };
export function nodeBoundsRadius(node: Pick<RenderNode, 'radius' | 'shape'>): number {
  return (
    node.radius *
    (node.shape === 'box' ? Math.sqrt(3) * 0.8 : node.shape === 'octahedron' ? 1.4 : 1)
  );
}

/** Frame actual mesh bounds in the current viewing direction, independently of world origin. */
export function frameCamera(
  nodes: readonly RenderNode[],
  options: {
    dimensions: 2 | 3;
    position: Point;
    orbitTarget: Point;
    up: Point;
    fov: number;
    width: number;
    height: number;
    padding: number;
    target?: Point;
  },
): { position: Point; target: Point } | undefined {
  if (!(options.width > 0 && options.height > 0)) return;
  const positioned = nodes.filter(
    (node) =>
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      (options.dimensions === 2 || Number.isFinite(node.z)),
  );
  if (!positioned.length) return;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const node of positioned) {
    const center = new Vector3(node.x!, node.y!, options.dimensions === 2 ? 0 : node.z!);
    const radius = nodeBoundsRadius(node);
    min.min(center.clone().addScalar(-radius));
    max.max(center.clone().addScalar(radius));
  }
  const target = options.target
    ? new Vector3(options.target.x, options.target.y, options.target.z)
    : min.add(max).multiplyScalar(0.5);
  const backward =
    options.dimensions === 2
      ? new Vector3(0, 0, 1)
      : new Vector3(
          options.position.x - options.orbitTarget.x,
          options.position.y - options.orbitTarget.y,
          options.position.z - options.orbitTarget.z,
        );
  if (backward.lengthSq() < 1e-12) backward.set(0, 0, 1);
  backward.normalize();
  const up = new Vector3(options.up.x, options.up.y, options.up.z).normalize();
  if (Math.abs(up.dot(backward)) > 0.999 || up.lengthSq() === 0)
    up.set(Math.abs(backward.y) < 0.9 ? 0 : 1, Math.abs(backward.y) < 0.9 ? 1 : 0, 0);
  const right = new Vector3().crossVectors(up, backward).normalize();
  up.crossVectors(backward, right).normalize();
  const fov =
    Number.isFinite(options.fov) && options.fov > 0 && options.fov < 180 ? options.fov : 50;
  const tanY = Math.tan((fov * Math.PI) / 360);
  const usableY = tanY * Math.max(0.25, 1 - (2 * options.padding) / options.height);
  const usableX =
    ((tanY * options.width) / options.height) *
    Math.max(0.25, 1 - (2 * options.padding) / options.width);
  // A small local scene should still leave navigation context around its nodes.
  let distance = 40;
  for (const node of positioned) {
    const offset = new Vector3(node.x!, node.y!, options.dimensions === 2 ? 0 : node.z!).sub(
      target,
    );
    const radius = nodeBoundsRadius(node);
    distance = Math.max(
      distance,
      offset.dot(backward) +
        radius +
        Math.max(
          (Math.abs(offset.dot(right)) + radius) / usableX,
          (Math.abs(offset.dot(up)) + radius) / usableY,
        ),
    );
  }
  return {
    target: { x: target.x, y: target.y, z: target.z },
    position: {
      x: target.x + backward.x * distance,
      y: target.y + backward.y * distance,
      z: target.z + backward.z * distance,
    },
  };
}
