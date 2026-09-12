import type { GraphSnapshot } from '../../domain/graphSnapshot';
/** Renderer-only contract. No workspace objects or mutable renderer objects cross it. */
export interface RenderNode {
  id: string;
  /** Display text for engines that draw labels; has no entity semantics. */
  text?: string;
  /** Keep explicit captions per node, ahead of automatic text and independent of glow. */
  captionPriority?: boolean;
  shape: 'box' | 'sphere' | 'octahedron';
  color: string;
  radius: number;
  highlight: boolean;
  /** Selection emphasis independent of optional glow; older adapters may ignore it. */
  selected?: boolean;
  /** Active or batch selection participates in flow animation without changing focus. */
  flowActive?: boolean;
  /** Screen-space role accent, independent of physical geometry and layout. */
  marker?: { shape: 'brackets' | 'ring'; color: string };
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
  /** Stable source-to-target layout direction; independent of selection styling. */
  directed?: boolean;
  /** Stable side of transaction flow, independent of the currently hovered endpoint. */
  flowSide?: 'incoming' | 'outgoing';
}
/** Complete appearance for one existing node; undefined text/priority clears it. */
export type NodeAppearancePatch = Pick<
  RenderNode,
  'id' | 'text' | 'captionPriority' | 'color' | 'highlight'
>;
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
  /** Modifier keys held during the reported event; consumers decide their meaning. */
  modifiers?: { ctrl: boolean; meta: boolean; shift: boolean };
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
  /** Settled geometry and camera only; consumers decide where to persist it. */
  snapshot?(snapshot: GraphSnapshot): void;
  /** Lightweight activity signal; includes the quiet period before snapshot publication. */
  activity?(active: boolean): void;
  /** Geometry computation is independent of camera gestures and can fail/retry. */
  layout?(state: { busy: boolean; nodeCount: number; error?: boolean }): void;
}
export interface GraphAdapter {
  readonly canvas: HTMLCanvasElement;
  update(frame: GraphFrame): void;
  /** Update metadata appearance without replacing geometry, selection or camera state. */
  updateNodeAppearance?(patches: readonly NodeAppearancePatch[]): void;
  /** topInset reserves overlaid navigation in CSS pixels, without reducing the canvas. */
  resize(width: number, height: number, topInset?: number, rightInset?: number): void;
  /** Center a node; preserveZoom pans without changing the current camera distance. */
  focus(id: string, options?: { preserveZoom?: boolean }): void;
  /** Cancel deferred focus when navigation must preserve the current camera. */
  cancelFocus?(): void;
  fit(): void;
  /** Optional viewport zoom: factor < 1 moves closer, > 1 moves away. */
  zoom?(factor: number): void;
  /** Explicitly recompute visible node positions; never changes underlying data. */
  repack?(): void;
  /** Toggle connection animation and camera inertia; manual navigation stays available. */
  setMotion?(enabled: boolean): void;
  /** Synchronously publish the current view before an explicit save or workspace transition. */
  flushSnapshot?(): void;
  /** Optional initial view restoration; adapters without persistence remain valid. */
  restoreSnapshot?(snapshot: GraphSnapshot): void;
  dispose(): void;
}
export type GraphAdapterFactory = (
  container: HTMLElement,
  events: GraphAdapterEvents,
) => GraphAdapter;
