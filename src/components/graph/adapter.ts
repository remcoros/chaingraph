/** Renderer-only contract. No workspace objects or mutable renderer objects cross it. */
export interface RenderNode {
  id: string;
  /** Display text for engines that draw labels; has no entity semantics. */
  text?: string;
  shape: 'box' | 'sphere' | 'octahedron';
  color: string;
  radius: number;
  highlight: boolean;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}
export interface RenderLink {
  id: string;
  source: string;
  target: string;
  color: string;
  width: number;
  arrowLength: number;
}
export interface GraphFrame {
  nodes: readonly RenderNode[];
  links: readonly RenderLink[];
  dimensions: 2 | 3;
  background: string;
}
export type GraphHit = { type: 'node' | 'link'; id: string };
export interface GraphPointer {
  /** CSS pixels relative to the adapter container, including for background events. */
  x: number;
  y: number;
  pointerType: string;
}
export interface GraphPointerEvent {
  hit?: GraphHit;
  point: GraphPointer;
}
export interface GraphAdapterEvents {
  hover(event: GraphPointerEvent): void;
  select(event: GraphPointerEvent): void;
  dismiss(): void;
  error(): void;
  /** A recoverable renderer has restored its graphics context. */
  recovered?(): void;
}
export interface GraphAdapter {
  readonly canvas: HTMLCanvasElement;
  update(frame: GraphFrame): void;
  resize(width: number, height: number): void;
  focus(id: string): void;
  fit(): void;
  dispose(): void;
}
export type GraphAdapterFactory = (
  container: HTMLElement,
  events: GraphAdapterEvents,
) => GraphAdapter;
