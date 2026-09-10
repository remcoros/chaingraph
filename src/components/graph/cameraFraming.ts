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
    topInset?: number;
    rightInset?: number;
    captions?: ReadonlyMap<string, { width: number; height: number; offsetY: number }>;
    target?: Point;
    /** Preferred CSS-pixel mesh width when centering a single node. */
    nodeWidth?: number;
    /** Keep the existing camera-to-orbit distance while centering a node. */
    preserveZoom?: boolean;
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
    ? new Vector3(
        options.target.x,
        options.target.y,
        options.dimensions === 2 ? 0 : options.target.z,
      )
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
  // Project bodies and billboard captions into the current camera axes. Labels
  // rise in world Y from their parent, then face the camera at their actual size.
  const bounds: {
    left: number;
    right: number;
    bottom: number;
    top: number;
    near: number;
    far: number;
  }[] = [];
  for (const node of positioned) {
    const offset = new Vector3(node.x!, node.y!, options.dimensions === 2 ? 0 : node.z!).sub(
      target,
    );
    const radius = nodeBoundsRadius(node);
    const x = offset.dot(right),
      y = offset.dot(up),
      z = offset.dot(backward);
    bounds.push({
      left: x - radius,
      right: x + radius,
      bottom: y - radius,
      top: y + radius,
      near: z - radius,
      far: z + radius,
    });
    const caption = options.captions?.get(node.id);
    if (caption) {
      offset.y += caption.offsetY;
      const x = offset.dot(right),
        y = offset.dot(up),
        z = offset.dot(backward);
      bounds.push({
        left: x - caption.width / 2,
        right: x + caption.width / 2,
        bottom: y - caption.height / 2,
        top: y + caption.height / 2,
        near: z,
        far: z,
      });
    }
  }
  if (!options.target) {
    const limits = bounds.reduce(
      (result, b) => ({
        left: Math.min(result.left, b.left),
        right: Math.max(result.right, b.right),
        bottom: Math.min(result.bottom, b.bottom),
        top: Math.max(result.top, b.top),
        near: Math.min(result.near, b.near),
        far: Math.max(result.far, b.far),
      }),
      {
        left: Infinity,
        right: -Infinity,
        bottom: Infinity,
        top: -Infinity,
        near: Infinity,
        far: -Infinity,
      },
    );
    const x = (limits.left + limits.right) / 2,
      y = (limits.bottom + limits.top) / 2,
      z = (limits.near + limits.far) / 2;
    target.addScaledVector(right, x).addScaledVector(up, y).addScaledVector(backward, z);
    for (const b of bounds) {
      b.left -= x;
      b.right -= x;
      b.bottom -= y;
      b.top -= y;
      b.near -= z;
      b.far -= z;
    }
  }
  const fov =
    Number.isFinite(options.fov) && options.fov > 0 && options.fov < 180 ? options.fov : 50;
  const tanY = Math.tan((fov * Math.PI) / 360);
  const horizontalPadding = Math.min(options.padding, options.width * 0.375);
  const bottomPadding = Math.min(options.padding, options.height * 0.25);
  const topPadding = Math.min(
    Math.max(options.padding, options.topInset ?? 0),
    options.height * 0.5,
  );
  const tanX = (tanY * options.width) / options.height;
  const rightPadding = Math.min(
    Math.max(horizontalPadding, options.rightInset ?? 0),
    options.width * 0.5,
  );
  const leftSlope = tanX * (1 - (2 * horizontalPadding) / options.width);
  const rightSlope = tanX * (1 - (2 * rightPadding) / options.width);
  const horizontalShift = (tanX * (rightPadding - horizontalPadding)) / options.width;
  const topSlope = tanY * (1 - (2 * topPadding) / options.height);
  const bottomSlope = tanY * (1 - (2 * bottomPadding) / options.height);
  const verticalShift = (tanY * (topPadding - bottomPadding)) / options.height;
  // Shift the framed scene into the free area below navigation instead of
  // reserving that height on both sides and needlessly shrinking the graph.
  let distance = 40;
  for (const b of bounds) {
    distance = Math.max(
      distance,
      (b.right + b.far * rightSlope) / (rightSlope + horizontalShift),
      (-b.left + b.far * leftSlope) / (leftSlope - horizontalShift),
      (b.top + b.far * topSlope) / (topSlope + verticalShift),
      (-b.bottom + b.far * bottomSlope) / (bottomSlope - verticalShift),
      b.far + 1,
    );
  }
  if (positioned.length === 1 && options.nodeWidth && options.nodeWidth > 0) {
    const node = positioned[0];
    // Match the visible shape's horizontal extent in the current camera axes,
    // not its enclosing sphere. The depth allowance keeps perspective faces
    // near the requested size even when viewing a cube from an oblique angle.
    const extent =
      node.radius *
      (node.shape === 'box'
        ? 0.8 * (Math.abs(right.x) + Math.abs(right.y) + Math.abs(right.z))
        : node.shape === 'octahedron'
          ? 1.4 * Math.max(Math.abs(right.x), Math.abs(right.y), Math.abs(right.z))
          : 1);
    distance = Math.max(
      distance,
      (extent * options.height) / (options.nodeWidth * tanY) + nodeBoundsRadius(node),
    );
  }
  if (options.preserveZoom) {
    const currentDistance = new Vector3(
      options.position.x - options.orbitTarget.x,
      options.position.y - options.orbitTarget.y,
      options.position.z - options.orbitTarget.z,
    ).length();
    if (Number.isFinite(currentDistance) && currentDistance > 0) distance = currentDistance;
  }
  target.addScaledVector(up, distance * verticalShift);
  target.addScaledVector(right, distance * horizontalShift);
  return {
    target: { x: target.x, y: target.y, z: target.z },
    position: {
      x: target.x + backward.x * distance,
      y: target.y + backward.y * distance,
      z: target.z + backward.z * distance,
    },
  };
}
