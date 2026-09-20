import { Sphere, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  OUTPUT_GROUP_BOUND_RADIUS,
  OUTPUT_GROUP_CENTER_RADIUS,
  OUTPUT_GROUP_SATELLITE_OFFSETS,
  OUTPUT_GROUP_SATELLITE_RADIUS,
} from './outputGroupGlyph';

/** One central output with three smaller outputs around it, bounded by a unit sphere. */
export function createOutputGroupGeometry(): BufferGeometry {
  const parts = [
    new SphereGeometry(OUTPUT_GROUP_CENTER_RADIUS, 14, 10),
    ...OUTPUT_GROUP_SATELLITE_OFFSETS.map(([x, y, z]) =>
      new SphereGeometry(OUTPUT_GROUP_SATELLITE_RADIUS, 10, 8).translate(x, y, z),
    ),
  ];
  const geometry = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  geometry.scale(
    1 / OUTPUT_GROUP_BOUND_RADIUS,
    1 / OUTPUT_GROUP_BOUND_RADIUS,
    1 / OUTPUT_GROUP_BOUND_RADIUS,
  );
  geometry.boundingSphere = new Sphere(new Vector3(), 1);
  return geometry;
}
