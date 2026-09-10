import type { RenderLink, RenderNode } from './adapter';
export type Position = { x: number; y: number; z: number };
export type LayoutNode = Pick<RenderNode, 'id' | 'shape' | 'x' | 'y' | 'z' | 'fx' | 'fy' | 'fz'> &
  Partial<Pick<RenderNode, 'radius'>>;
export interface LayoutRequest {
  revision: number;
  dimensions?: 2 | 3;
  nodes: LayoutNode[];
  links: Pick<RenderLink, 'source' | 'target' | 'directed'>[];
  previous: [string, Position][];
}
export interface LayoutResult {
  revision: number;
  positions: [string, Position][];
}
