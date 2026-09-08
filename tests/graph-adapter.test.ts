import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MOUSE, Raycaster, Scene, TOUCH, Vector3 } from 'three';
import type { GraphFrame, GraphAdapterEvents } from '../src/components/graph/adapter';

const harness = vi.hoisted(() => ({ graph: undefined as any }));
vi.mock('3d-force-graph', () => ({
  default: function () {
    return harness.graph;
  },
}));
import { createForceAdapter } from '../src/components/graph/forceAdapter';

function setup() {
  const canvas = new EventTarget();
  Object.assign(canvas, { clientWidth: 900, clientHeight: 600 });
  const container = {
    replaceChildren: vi.fn(),
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  } as unknown as HTMLElement;
  let data: any = { nodes: [], links: [] };
  let camera = { x: 0, y: 0, z: 300 };
  const controls = {};
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const scene = new Scene();
  const graph: any = {
    scene: () => scene,
    renderer: () => ({ domElement: canvas, setPixelRatio: vi.fn(), getPixelRatio: () => 1 }),
    controls: () => controls,
    camera: () => ({ up: new Vector3() }),
    cameraPosition: vi.fn((position) => {
      if (!position) return camera;
      camera = position;
      return graph;
    }),
    graphData: vi.fn((next) => {
      if (!next) return data;
      data = next;
      // Model the force engine's mutation of coordinates and endpoints.
      data.nodes.forEach((node: any) => {
        node.x ??= 20;
        node.y ??= 30;
        node.z ??= 40;
        callbacks.nodeThreeObject(node);
      });
      data.links.forEach((link: any) => {
        link.source = data.nodes.find((n: any) => n.id === link.source);
        link.target = data.nodes.find((n: any) => n.id === link.target);
      });
      return graph;
    }),
  };
  for (const name of [
    'showNavInfo',
    'enableNodeDrag',
    'nodeRelSize',
    'nodeResolution',
    'nodeOpacity',
    'linkOpacity',
    'linkDirectionalArrowRelPos',
    'cooldownTicks',
    'cooldownTime',
    'd3AlphaDecay',
    'nodeLabel',
    'linkLabel',
    'linkHoverPrecision',
    'linkColor',
    'linkWidth',
    'linkDirectionalArrowLength',
    'backgroundColor',
    'numDimensions',
    'width',
    'height',
    'zoomToFit',
    'pauseAnimation',
    '_destructor',
  ])
    graph[name] = vi.fn(() => graph);
  for (const name of [
    'nodeThreeObject',
    'onNodeHover',
    'onLinkHover',
    'onNodeClick',
    'onLinkClick',
    'onBackgroundClick',
    'onEngineTick',
    'onEngineStop',
  ])
    graph[name] = (fn: any) => {
      callbacks[name] = fn;
      return graph;
    };
  harness.graph = graph;
  const events: GraphAdapterEvents = {
    hover: vi.fn(),
    select: vi.fn(),
    dismiss: vi.fn(),
    error: vi.fn(),
  };
  const adapter = createForceAdapter(container, events);
  adapter.resize(900, 600);
  const pointer = (type: string, props = {}) =>
    canvas.dispatchEvent(
      Object.assign(new Event(type), {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 60,
        clientY: 70,
        button: 0,
        ...props,
      }),
    );
  return {
    adapter,
    graph,
    controls: controls as any,
    callbacks,
    events,
    pointer,
    container,
    scene,
  };
}
const frame = (dimensions: 2 | 3 = 2): GraphFrame =>
  Object.freeze({
    dimensions,
    background: '#111a20',
    nodes: Object.freeze([
      Object.freeze({
        id: 'a',
        shape: 'box' as const,
        color: '#aabbcc',
        radius: 3.2,
        highlight: true,
      }),
      Object.freeze({
        id: 'b',
        shape: 'sphere' as const,
        color: '#abcdef',
        radius: 3.2,
        highlight: false,
      }),
    ]),
    links: Object.freeze([
      Object.freeze({
        id: 'edge',
        source: 'a',
        target: 'b',
        color: '#abcdef',
        width: 0,
        arrowLength: 0,
      }),
    ]),
  });
beforeEach(() =>
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), devicePixelRatio: 1 }),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('force adapter contract', () => {
  it('owns mutable clones and updates presentation without restarting layout or losing positions', () => {
    const { adapter, graph } = setup();
    const input = frame();
    adapter.update(input);
    const node = graph.graphData().nodes[0];
    node.x = 123;
    const calls = graph.graphData.mock.calls.filter((args: any[]) => args.length).length;
    adapter.update({
      ...input,
      nodes: input.nodes.map((n) => ({ ...n, color: '#ff0000', highlight: false })),
      links: input.links.map((l) => ({ ...l, width: 0.65, arrowLength: 3 })),
    });
    expect(graph.graphData().nodes[0]).toBe(node);
    expect(node.x).toBe(123);
    expect(node.color).toBe('#ff0000');
    expect(graph.graphData().links[0]).toMatchObject({ width: 0.65, arrowLength: 3 });
    expect(graph.graphData.mock.calls.filter((args: any[]) => args.length)).toHaveLength(calls);
    expect(input.links[0].source).toBe('a');
    expect(input.nodes[0].x).toBeUndefined();
    adapter.dispose();
  });
  it('keeps first-data fit pending after empty stop and avoids an empty 2D camera tween', () => {
    const { adapter, callbacks, graph } = setup();
    adapter.update({ ...frame(), nodes: [], links: [] });
    expect(graph.cameraPosition.mock.calls.at(-1)?.[2]).toBe(0);
    callbacks.onEngineStop();
    expect(graph.zoomToFit).not.toHaveBeenCalled();
    adapter.fit();
    adapter.update(frame());
    callbacks.onEngineStop();
    expect(graph.zoomToFit).toHaveBeenCalledTimes(1);
    callbacks.onEngineStop();
    expect(graph.zoomToFit).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
  it('defers first-data fit and focus while hidden and keeps the last real viewport', () => {
    const { adapter, graph, callbacks } = setup();
    adapter.resize(0, 0);
    adapter.update(frame());
    callbacks.onEngineStop();
    expect(graph.zoomToFit).not.toHaveBeenCalled();
    expect(graph.width).toHaveBeenLastCalledWith(900);
    adapter.resize(390, 600);
    expect(graph.zoomToFit).toHaveBeenCalledTimes(1);
    adapter.resize(0, 0);
    adapter.focus('a');
    const count = graph.cameraPosition.mock.calls.length;
    adapter.resize(390, 600);
    expect(graph.cameraPosition.mock.calls.length).toBeGreaterThan(count);
    expect(graph.cameraPosition.mock.calls.at(-1)?.[1]).toEqual({ x: 20, y: 30, z: 0 });
    adapter.dispose();
  });
  it('preserves 2D pan and 3D orbit mappings, resize, focus and explicit fit', () => {
    const { adapter, graph, controls, callbacks } = setup();
    adapter.update(frame());
    expect(controls.enableRotate).toBe(false);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.PAN);
    expect(controls.touches).toEqual({ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN });
    adapter.focus('a');
    expect(graph.cameraPosition.mock.calls.at(-1)?.[0]).toEqual({ x: 20, y: 30, z: 180 });
    callbacks.onEngineStop();
    expect(graph.zoomToFit).not.toHaveBeenCalled();
    adapter.update(frame(3));
    expect(controls.enableRotate).toBe(true);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    expect(controls.touches.ONE).toBe(TOUCH.ROTATE);
    adapter.focus('b');
    const [camera, target] = graph.cameraPosition.mock.calls.at(-1)!;
    expect(Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z)).toBeCloseTo(
      180,
    );
    adapter.resize(900, 600);
    expect(graph.width).toHaveBeenLastCalledWith(900);
    expect(graph.height).toHaveBeenLastCalledWith(600);
    adapter.fit();
    expect(graph.zoomToFit).toHaveBeenCalled();
    adapter.dispose();
  });
  it('emits stable node/link IDs and local pointers, suppresses touch hover and gesture selections', () => {
    const { adapter, events, pointer, callbacks } = setup();
    adapter.update(frame());
    pointer('pointermove');
    callbacks.onNodeHover({ id: 'a', x: 99 });
    expect(events.hover).toHaveBeenLastCalledWith({
      hit: { type: 'node', id: 'a' },
      point: { x: 50, y: 50, pointerType: 'mouse' },
    });
    pointer('pointerdown');
    pointer('pointerup');
    callbacks.onLinkClick({ id: 'edge', source: {} }, { button: 0 });
    expect(events.select).toHaveBeenLastCalledWith({
      hit: { type: 'link', id: 'edge' },
      point: { x: 50, y: 50, pointerType: 'mouse' },
    });
    vi.mocked(events.hover).mockClear();
    vi.mocked(events.select).mockClear();
    pointer('pointerdown', { pointerType: 'touch' });
    pointer('pointermove', { pointerType: 'touch', clientX: 90 });
    callbacks.onNodeHover({ id: 'b' });
    pointer('pointerup', { pointerType: 'touch', clientX: 90 });
    callbacks.onNodeClick({ id: 'b' }, { button: 0 });
    expect(events.hover).not.toHaveBeenCalled();
    expect(events.select).not.toHaveBeenCalled();
    pointer('pointerdown');
    pointer('pointerdown', { pointerId: 2 });
    pointer('pointerup', { pointerId: 2 });
    pointer('pointerup');
    callbacks.onNodeClick({ id: 'a' }, { button: 0 });
    expect(events.select).not.toHaveBeenCalled();
    pointer('pointerdown');
    pointer('pointercancel');
    callbacks.onNodeClick({ id: 'a' }, { button: 0 });
    expect(events.select).not.toHaveBeenCalled();
    vi.spyOn(Raycaster.prototype, 'setFromCamera').mockImplementation(() => {});
    vi.spyOn(Raycaster.prototype, 'intersectObjects').mockReturnValue([
      { object: callbacks.nodeThreeObject(harness.graph.graphData().nodes[1]) },
    ] as any);
    pointer('pointerdown', { pointerType: 'touch' });
    pointer('pointerup', { pointerType: 'touch' });
    callbacks.onNodeClick({ id: 'b' }, { button: 0 });
    expect(events.select).toHaveBeenLastCalledWith({
      hit: { type: 'node', id: 'b' },
      point: { x: 50, y: 50, pointerType: 'touch' },
    });
    adapter.dispose();
  });
  it('releases resources/listeners once, reports context loss and ignores methods after disposal', () => {
    const { adapter, graph, events, pointer, scene, container, callbacks } = setup();
    adapter.update(frame());
    const halo = scene.children[0] as any;
    const geometryDispose = vi.spyOn(halo.geometry, 'dispose');
    const materialDispose = vi.spyOn(halo.material, 'dispose');
    pointer('webglcontextlost');
    expect(events.error).toHaveBeenCalledTimes(1);
    expect(graph.pauseAnimation).toHaveBeenCalledTimes(1);
    adapter.dispose();
    adapter.dispose();
    adapter.update(frame());
    adapter.fit();
    adapter.focus('a');
    expect(graph._destructor).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(container.replaceChildren).toHaveBeenCalledTimes(1);
    pointer('pointerdown');
    callbacks.onNodeHover({ id: 'late' });
    callbacks.onNodeClick({ id: 'late' }, { button: 0 });
    callbacks.onEngineStop();
    expect(events.hover).not.toHaveBeenCalled();
    expect(events.select).not.toHaveBeenCalled();
    expect(events.dismiss).not.toHaveBeenCalled();
  });
});
