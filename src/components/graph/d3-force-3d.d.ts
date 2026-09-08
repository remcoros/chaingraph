// Narrow declarations for the MIT d3-force-3d API used by the layout worker.
// The upstream package does not ship TypeScript declarations.
declare module 'd3-force-3d' {
  export interface SimulationNode {
    id: string;
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number;
    fy?: number;
    fz?: number;
  }
  export interface SimulationLink<N extends SimulationNode> {
    source: string | N;
    target: string | N;
  }
  export interface Force<N extends SimulationNode> {
    (alpha: number): void;
    initialize?: (nodes: N[], random: () => number, dimensions: number) => void;
  }
  export function forceSimulation<N extends SimulationNode>(
    nodes: N[],
    dimensions: number,
  ): {
    stop(): ReturnType<typeof forceSimulation<N>>;
    force(name: string, force: Force<N>): ReturnType<typeof forceSimulation<N>>;
    tick(iterations: number): ReturnType<typeof forceSimulation<N>>;
  };
  export function forceLink<N extends SimulationNode>(
    links: SimulationLink<N>[],
  ): Force<N> & {
    id(accessor: (node: N) => string): ReturnType<typeof forceLink<N>>;
    distance(accessor: (link: SimulationLink<N>) => number): ReturnType<typeof forceLink<N>>;
  };
  export function forceManyBody<N extends SimulationNode>(): Force<N> & {
    strength(value: number): ReturnType<typeof forceManyBody<N>>;
  };
  export function forceCollide<N extends SimulationNode>(radius: (node: N) => number): Force<N>;
  export function forceX<N extends SimulationNode>(
    target: (node: N) => number,
  ): Force<N> & { strength(value: number): ReturnType<typeof forceX<N>> };
  export function forceY<N extends SimulationNode>(
    target: (node: N) => number,
  ): Force<N> & { strength(value: number): ReturnType<typeof forceY<N>> };
  export function forceZ<N extends SimulationNode>(
    target: (node: N) => number,
  ): Force<N> & { strength(value: number): ReturnType<typeof forceZ<N>> };
}
