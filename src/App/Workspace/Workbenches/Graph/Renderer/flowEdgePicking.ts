import type { RenderLink } from './adapter';
/** Screen-space edge candidates, rebuilt lazily after geometry/camera changes.
 * Segment samples avoid filling huge diagonal bounding boxes with duplicates. */
export function makeEdgePickIndex(
  links: readonly RenderLink[],
  projected: ReadonlyMap<string, { x: number; y: number; z: number }>,
  width: number,
  height: number,
) {
  const size = 48,
    cells = new Map<string, number[]>(),
    segments: { id: string; ax: number; ay: number; dx: number; dy: number }[] = [];
  for (const link of links) {
    const a = projected.get(link.source),
      b = projected.get(link.target);
    if (!a || !b || Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    let near = 0,
      far = 1;
    // Clip before indexing: near-plane/offscreen coordinates can be enormous.
    for (const [p, q] of [
      [-dx, a.x + 6],
      [dx, width + 6 - a.x],
      [-dy, a.y + 6],
      [dy, height + 6 - a.y],
    ]) {
      if (p === 0) {
        if (q < 0) {
          far = -1;
          break;
        }
        continue;
      }
      const t = q / p;
      if (p < 0) near = Math.max(near, t);
      else far = Math.min(far, t);
    }
    if (near > far) continue;
    const index = segments.length;
    segments.push({ id: link.id, ax: a.x, ay: a.y, dx, dy });
    const steps = Math.max(
      1,
      Math.ceil((Math.max(Math.abs(dx), Math.abs(dy)) * (far - near)) / size),
    );
    let previous = '';
    for (let i = 0; i <= steps; i++) {
      const t = near + ((far - near) * i) / steps,
        key = `${Math.floor((a.x + dx * t) / size)},${Math.floor((a.y + dy * t) / size)}`;
      if (key === previous) continue;
      previous = key;
      const cell = cells.get(key) ?? [];
      cell.push(index);
      cells.set(key, cell);
    }
  }
  return (x: number, y: number): string | undefined => {
    const cx = Math.floor(x / size),
      cy = Math.floor(y / size),
      seen = new Set<number>();
    let best = 25,
      hit: string | undefined;
    for (let ix = cx - 1; ix <= cx + 1; ix++)
      for (let iy = cy - 1; iy <= cy + 1; iy++)
        for (const index of cells.get(`${ix},${iy}`) ?? []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const s = segments[index],
            t = Math.max(
              0,
              Math.min(
                1,
                ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / (s.dx * s.dx + s.dy * s.dy || 1),
              ),
            );
          const distance = (x - s.ax - t * s.dx) ** 2 + (y - s.ay - t * s.dy) ** 2;
          if (distance < best) {
            best = distance;
            hit = s.id;
          }
        }
    return hit;
  };
}
