import type { RenderLink, RenderNode } from './adapter';
export type Position = { x: number; y: number; z: number };
export type LayoutNode = Pick<
  RenderNode,
  'id' | 'shape' | 'chronology' | 'x' | 'y' | 'z' | 'fx' | 'fy' | 'fz'
> &
  Partial<Pick<RenderNode, 'radius'>> & { weight?: number };
export interface LayoutRequest {
  revision: number;
  dimensions?: 2 | 3;
  nodes: LayoutNode[];
  links: Pick<RenderLink, 'source' | 'target' | 'directed'>[];
  previous: [string, Position][];
  /** Transient navigation preference for placing a newly opened transaction. */
  expansionOrigin?: { nodeId: string; anchorId: string };
}
export interface LayoutResult {
  revision: number;
  positions: [string, Position][];
}
