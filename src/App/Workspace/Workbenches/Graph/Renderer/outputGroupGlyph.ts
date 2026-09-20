export const OUTPUT_GROUP_CENTER_RADIUS = 0.42;
export const OUTPUT_GROUP_SATELLITE_RADIUS = 0.25;
export const OUTPUT_GROUP_SATELLITE_OFFSETS = [
  [0, 0.67, 0],
  [-0.58, -0.33, 0.16],
  [0.58, -0.33, -0.16],
] as const;

/** Outer radius and filled-volume ratio of the unscaled four-sphere glyph. */
export const OUTPUT_GROUP_BOUND_RADIUS = Math.max(
  OUTPUT_GROUP_CENTER_RADIUS,
  ...OUTPUT_GROUP_SATELLITE_OFFSETS.map(
    ([x, y, z]) => Math.hypot(x, y, z) + OUTPUT_GROUP_SATELLITE_RADIUS,
  ),
);
export const OUTPUT_GROUP_VOLUME_FILL =
  (OUTPUT_GROUP_CENTER_RADIUS ** 3 +
    OUTPUT_GROUP_SATELLITE_OFFSETS.length * OUTPUT_GROUP_SATELLITE_RADIUS ** 3) /
  OUTPUT_GROUP_BOUND_RADIUS ** 3;
