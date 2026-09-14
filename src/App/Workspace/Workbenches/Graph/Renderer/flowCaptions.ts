import type { RenderNode } from './adapter';

export interface FlowCaptionCandidate {
  node: RenderNode;
  x: number;
  y: number;
  radius: number;
}

export interface FlowCaption {
  node: RenderNode;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CELL_SIZE = 128;
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Keep explicit captions stable without letting generated labels crowd the viewport. */
export function placeFlowCaptions(
  candidates: readonly FlowCaptionCandidate[],
  viewport: { width: number; height: number; topInset: number },
  previousVisible: ReadonlySet<string>,
  hoveredId?: string,
): FlowCaption[] {
  const { width, height, topInset } = viewport;
  if (![width, height, topInset].every(Number.isFinite) || width <= 0 || height <= 0) return [];
  const ordered = [...candidates].sort(
    (a, b) =>
      Number(Boolean(b.node.selected)) - Number(Boolean(a.node.selected)) ||
      Number(b.node.id === hoveredId) - Number(a.node.id === hoveredId) ||
      Number(Boolean(b.node.captionPriority)) - Number(Boolean(a.node.captionPriority)) ||
      Number(previousVisible.has(b.node.id)) - Number(previousVisible.has(a.node.id)) ||
      Number(b.node.highlight) - Number(a.node.highlight) ||
      Number(b.node.shape === 'box') - Number(a.node.shape === 'box') ||
      b.radius - a.radius ||
      compareId(a.node.id, b.node.id),
  );
  const placed: FlowCaption[] = [];
  const repeats = new Set<string>();
  const cells = new Map<number, Map<number, FlowCaption[]>>();
  for (const { node, x: anchorX, y: anchorY, radius } of ordered) {
    if (!node.text || ![anchorX, anchorY, radius].every(Number.isFinite)) continue;
    const priority = Boolean(node.selected || node.id === hoveredId || node.captionPriority);
    if (!priority && (placed.length >= 48 || repeats.has(node.text))) continue;
    const emphasized = priority || node.highlight;
    if (!emphasized && radius < 2.2 && node.shape !== 'box') continue;
    const lines = node.text
      .split('\n')
      .slice(0, 2)
      .map((line) => {
        const characters = [...line];
        return characters.length > 36 ? characters.slice(0, 35).join('') + '…' : line;
      });
    const captionWidth = Math.min(
      254,
      Math.ceil(Math.max(...lines.map((line) => line.length)) * 6.6) + 16,
    );
    const captionHeight = lines.length * 16 + 6;
    const gap = Math.max(8, radius * 1.5 + 4);
    let x = anchorX + gap;
    let y = anchorY - captionHeight / 2;
    if (x + captionWidth > width - 8) x = anchorX - gap - captionWidth;
    if (emphasized) {
      x = Math.max(8, Math.min(x, width - captionWidth - 8));
      y = Math.max(topInset + 4, Math.min(y, height - captionHeight - 8));
    }
    if (x < 4 || x + captionWidth > width - 4 || y < topInset + 4 || y + captionHeight > height - 8)
      continue;

    // Index accepted rectangles once; query only cells touched by the new
    // rectangle and its clearance, even when thousands of annotations fit.
    let overlaps = false;
    for (
      let cx = Math.floor((x - 6) / CELL_SIZE);
      cx <= Math.floor((x + captionWidth + 6) / CELL_SIZE) && !overlaps;
      cx++
    ) {
      const column = cells.get(cx);
      if (!column) continue;
      for (
        let cy = Math.floor((y - 4) / CELL_SIZE);
        cy <= Math.floor((y + captionHeight + 4) / CELL_SIZE) && !overlaps;
        cy++
      ) {
        overlaps = (column.get(cy) ?? []).some(
          (other) =>
            x < other.x + other.width + 6 &&
            x + captionWidth + 6 > other.x &&
            y < other.y + other.height + 4 &&
            y + captionHeight + 4 > other.y,
        );
      }
    }
    if (overlaps) continue;
    const caption = {
      node,
      text: lines.join('\n'),
      x,
      y,
      width: captionWidth,
      height: captionHeight,
    };
    placed.push(caption);
    repeats.add(node.text);
    for (
      let cx = Math.floor(x / CELL_SIZE);
      cx <= Math.floor((x + captionWidth) / CELL_SIZE);
      cx++
    ) {
      let column = cells.get(cx);
      if (!column) cells.set(cx, (column = new Map()));
      for (
        let cy = Math.floor(y / CELL_SIZE);
        cy <= Math.floor((y + captionHeight) / CELL_SIZE);
        cy++
      ) {
        const bucket = column.get(cy);
        if (bucket) bucket.push(caption);
        else column.set(cy, [caption]);
      }
    }
  }
  return placed;
}
