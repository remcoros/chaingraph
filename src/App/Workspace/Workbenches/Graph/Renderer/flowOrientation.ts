import type { Position } from './flowLayout';

export type FlowFrame = { forward: Position; across: Position; depth: Position; flat: boolean };
export const dot = (a: Position, b: Position) => a.x * b.x + a.y * b.y + a.z * b.z;
export const subtract = (a: Position, b: Position): Position => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
export const scaled = (point: Position, scale: number): Position => ({
  x: point.x * scale,
  y: point.y * scale,
  z: point.z * scale,
});
export function normalized(
  point: Position,
  flat: boolean,
  fallback: Position = { x: 1, y: 0, z: 0 },
): Position {
  const z = flat ? 0 : point.z,
    length = Math.hypot(point.x, point.y, z);
  return length > 1e-8 && Number.isFinite(length)
    ? { x: point.x / length, y: point.y / length, z: z / length }
    : { ...fallback };
}
export function flowFrame(direction: Position, flat: boolean): FlowFrame {
  const forward = normalized(direction, flat);
  const up = Math.abs(forward.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const across = flat
    ? { x: -forward.y, y: forward.x, z: 0 }
    : normalized(subtract(up, scaled(forward, dot(up, forward))), false);
  const depth = {
    x: forward.y * across.z - forward.z * across.y,
    y: forward.z * across.x - forward.x * across.z,
    z: forward.x * across.y - forward.y * across.x,
  };
  return { forward, across, depth, flat };
}
export function worldPoint(frame: FlowFrame, origin: Position, local: Position): Position {
  return {
    x: origin.x + frame.forward.x * local.x + frame.across.x * local.y + frame.depth.x * local.z,
    y: origin.y + frame.forward.y * local.x + frame.across.y * local.y + frame.depth.y * local.z,
    z: frame.flat
      ? 0
      : origin.z + frame.forward.z * local.x + frame.across.z * local.y + frame.depth.z * local.z,
  };
}
export function localPoint(frame: FlowFrame, origin: Position, world: Position): Position {
  const delta = subtract(world, origin);
  if (frame.flat) delta.z = 0;
  return { x: dot(delta, frame.forward), y: dot(delta, frame.across), z: dot(delta, frame.depth) };
}

/** Recover an established spherical side's center without letting one radial
 * clicked output redefine the whole branch. Coordinates remain read-only. */
function sideGeometry(
  points: readonly Position[],
  flat: boolean,
): { center: Position; fitted: boolean } {
  const mean = { x: 0, y: 0, z: 0 };
  for (const point of points) {
    mean.x += point.x / points.length;
    mean.y += point.y / points.length;
    mean.z += point.z / points.length;
  }
  if (flat || points.length < 4) return { center: mean, fitted: flat && points.length >= 4 };
  const origin = points[0],
    matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const point of points.slice(1)) {
    const delta = subtract(point, origin),
      row = [delta.x * 2, delta.y * 2, delta.z * 2],
      value = dot(delta, delta);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += row[i] * row[j];
      matrix[i][3] += row[i] * value;
    }
  }
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++)
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    if (Math.abs(matrix[pivot][column]) < 1e-8) return { center: mean, fitted: false };
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    const divisor = matrix[column][column];
    for (let j = column; j < 4; j++) matrix[column][j] /= divisor;
    for (let row = 0; row < 3; row++)
      if (row !== column) {
        const factor = matrix[row][column];
        for (let j = column; j < 4; j++) matrix[row][j] -= factor * matrix[column][j];
      }
  }
  const center = {
    x: origin.x + matrix[0][3],
    y: origin.y + matrix[1][3],
    z: origin.z + matrix[2][3],
  };
  const distances = points.map((point) =>
    Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z),
  );
  const size = Math.max(...distances),
    spread = Math.max(
      ...points.map((point) => Math.hypot(point.x - mean.x, point.y - mean.y, point.z - mean.z)),
    );
  return Number.isFinite(size) && size <= spread * 2 && size - Math.min(...distances) <= size * 0.15
    ? { center, fitted: true }
    : { center: mean, fitted: false };
}
export function sideCenter(points: readonly Position[], flat: boolean): Position {
  return sideGeometry(points, flat).center;
}
/** Exit a visible group along the requested ray, rather than jumping to a remote lane. */
export function rayExit(
  origin: Position,
  direction: Position,
  center: Position,
  radius: number,
  nearby: number,
): number {
  const delta = subtract(center, origin),
    along = dot(delta, direction),
    perpendicular = dot(delta, delta) - along * along;
  const discriminant = radius * radius - perpendicular;
  if (discriminant < 0) return 0;
  const half = Math.sqrt(discriminant),
    near = along - half,
    far = along + half;
  return near <= nearby && far > 0 ? far : 0;
}
