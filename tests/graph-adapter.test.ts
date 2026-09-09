import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MOUSE, PerspectiveCamera, Raycaster, Scene, TOUCH, Vector3 } from 'three';
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
  const controls = Object.assign(new EventTarget(), { target: new Vector3() });
  const cameraObject = { up: new Vector3(0, 1, 0), getEffectiveFOV: () => 50 };
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const scene = new Scene();
  const graph: any = {
    scene: () => scene,
    renderer: () => ({ domElement: canvas, setPixelRatio: vi.fn(), getPixelRatio: () => 1 }),
    controls: () => controls,
    camera: () => cameraObject,
    cameraPosition: vi.fn((position, target) => {
      if (!position) return camera;
      camera = position;
      if (target) controls.target.set(target.x, target.y, target.z);
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
    'nodeVal',
    'nodeResolution',
    'nodeOpacity',
    'linkOpacity',
    'linkDirectionalArrowRelPos',
    'linkDirectionalArrowResolution',
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
  // Match the pinned three-forcegraph numDimensions onChange behavior.
  graph.numDimensions = vi.fn((dimensions: number) => {
    if (dimensions === 2)
      data.nodes.forEach((node: any) => {
        delete node.z;
        delete node.vz;
      });
    return graph;
  });
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
    snapshot: vi.fn(),
    activity: vi.fn(),
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
const cameraMoves = (graph: any) =>
  graph.cameraPosition.mock.calls.filter((args: unknown[]) => args.length);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('force adapter contract', () => {
  it('captures a manual camera before settlement for quick lock/switch, while automatic framing waits', () => {
    const untouched = setup();
    untouched.adapter.update(frame(3));
    for (let tick = 0; tick < 3; tick++) untouched.callbacks.onEngineTick();
    untouched.controls.dispatchEvent(new Event('end'));
    expect(untouched.events.snapshot).not.toHaveBeenCalled();
    untouched.adapter.dispose();
    expect(untouched.events.snapshot).not.toHaveBeenCalled();

    const manual = setup();
    manual.adapter.update(frame(3));
    for (let tick = 0; tick < 3; tick++) manual.callbacks.onEngineTick();
    manual.pointer('pointerdown');
    manual.graph.cameraPosition({ x: 80, y: -15, z: 250 }, { x: 30, y: -15, z: 0 }, 0);
    manual.pointer('pointerup');
    manual.controls.dispatchEvent(new Event('end'));
    expect(manual.events.snapshot).not.toHaveBeenCalled();
    manual.adapter.flushSnapshot?.();
    expect(manual.events.snapshot).toHaveBeenCalledTimes(1);
    expect(vi.mocked(manual.events.snapshot!).mock.calls[0][0].camera).toMatchObject({
      position: { x: 80, y: -15, z: 250 },
      target: { x: 30, y: -15, z: 0 },
    });
    // Neither path has received onEngineStop. A switch still flushes the latest
    // visible camera; a lock already has the completed gesture's earlier snapshot.
    manual.graph.cameraPosition({ x: 90, y: -25, z: 240 }, { x: 40, y: -25, z: 0 }, 0);
    manual.adapter.dispose();
    expect(manual.events.snapshot).toHaveBeenCalledTimes(2);
    expect(vi.mocked(manual.events.snapshot!).mock.calls[1][0].camera.position).toEqual({
      x: 90,
      y: -25,
      z: 240,
    });
  });
  it('frames new geometry early and finally at settlement unless a gesture takes over', () => {
    const { adapter, callbacks, graph, pointer } = setup();
    adapter.update(frame(3));
    callbacks.onEngineTick();
    callbacks.onEngineTick();
    expect(cameraMoves(graph)).toHaveLength(0);
    callbacks.onEngineTick();
    expect(cameraMoves(graph).at(-1)?.[2]).toBe(0);
    expect(cameraMoves(graph)).toHaveLength(1);
    callbacks.onEngineTick();
    expect(cameraMoves(graph)).toHaveLength(1);
    pointer('wheel');
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(1);
    adapter.dispose();
    const untouched = setup();
    untouched.adapter.update(frame(3));
    for (let tick = 0; tick < 3; tick++) untouched.callbacks.onEngineTick();
    untouched.callbacks.onEngineStop();
    expect(cameraMoves(untouched.graph)).toHaveLength(2);
    untouched.adapter.dispose();
    const requested = setup();
    requested.adapter.update(frame(3));
    requested.adapter.fit();
    for (let tick = 0; tick < 3; tick++) requested.callbacks.onEngineTick();
    expect(cameraMoves(requested.graph)).toHaveLength(2);
    expect(cameraMoves(requested.graph).at(-1)?.[2]).toBe(0);
    requested.adapter.dispose();
  });
  it('finishes an explicit fit against settled geometry but lets a manual gesture cancel that final move', () => {
    for (const cancel of [false, true]) {
      const { adapter, graph, callbacks, pointer } = setup();
      const data = frame(3);
      adapter.update({
        ...data,
        nodes: data.nodes.map((item, index) => ({ ...item, x: index * 30, y: index * 40, z: 0 })),
      });
      callbacks.onEngineStop();
      // A topology change starts another layout. Fit must use its eventual
      // coordinates, not only the positions visible at the time of the click.
      adapter.update({ ...data, nodes: [...data.nodes, { ...data.nodes[0], id: 'arriving' }] });
      adapter.resize(900, 350, 90);
      adapter.fit();
      const initial = cameraMoves(graph).at(-1)!;
      const count = cameraMoves(graph).length;
      const moving = graph.graphData().nodes[1];
      moving.y = 450;
      moving.z = 80;
      for (let tick = 0; tick < 10; tick++) callbacks.onEngineTick();
      expect(cameraMoves(graph)).toHaveLength(count);
      if (cancel) pointer('wheel');
      callbacks.onEngineStop();
      expect(cameraMoves(graph)).toHaveLength(count + (cancel ? 0 : 1));
      if (!cancel) {
        const [position, target] = cameraMoves(graph).at(-1)!;
        expect(position).not.toEqual(initial[0]);
        const camera = new PerspectiveCamera(50, 900 / 350, 0.1, 1e8);
        camera.position.set(position.x, position.y, position.z);
        camera.lookAt(target.x, target.y, target.z);
        camera.updateMatrixWorld();
        const top = new Vector3(moving.x, moving.y + moving.radius, moving.z).project(camera);
        expect(((1 - top.y) * 350) / 2).toBeGreaterThanOrEqual(90);
      }
      callbacks.onEngineStop();
      expect(cameraMoves(graph)).toHaveLength(count + (cancel ? 0 : 1));
      adapter.dispose();
    }
  });
  it('cancels early framing on a gesture and preserves the pending fit while hidden', () => {
    const moved = setup();
    moved.adapter.update(frame(3));
    moved.pointer('pointerdown');
    for (let tick = 0; tick < 3; tick++) moved.callbacks.onEngineTick();
    moved.callbacks.onEngineStop();
    expect(cameraMoves(moved.graph)).toHaveLength(0);
    moved.adapter.dispose();
    const hidden = setup();
    hidden.adapter.resize(0, 0);
    hidden.adapter.update(frame(3));
    for (let tick = 0; tick < 3; tick++) hidden.callbacks.onEngineTick();
    expect(cameraMoves(hidden.graph)).toHaveLength(0);
    hidden.adapter.resize(900, 600);
    expect(cameraMoves(hidden.graph).at(-1)?.[2]).toBe(0);
    hidden.adapter.dispose();
  });
  it('restores positions and camera without first-data fit or a conflicting flat-view tween', () => {
    const { adapter, graph, callbacks } = setup();
    const snapshot = {
      version: 1 as const,
      dimensions: 2 as const,
      camera: {
        position: { x: 40, y: -20, z: 550 },
        target: { x: 40, y: -20, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [
        { id: 'a', x: -42, y: 17, z: 0 },
        { id: 'b', x: 65, y: -12, z: 0 },
      ],
    };
    adapter.restoreSnapshot?.(snapshot);
    adapter.update(frame());
    expect(
      graph.graphData().nodes.map(({ id, x, y, z }: any) => ({ id, x, y, z: z ?? 0 })),
    ).toEqual(snapshot.nodes);
    expect(graph.graphData().nodes.every((node: any) => node.z === undefined)).toBe(true);
    expect(graph.cooldownTicks).toHaveBeenLastCalledWith(0);
    expect(graph.cameraPosition.mock.calls.filter((args: any[]) => args.length)).toEqual([
      [snapshot.camera.position, snapshot.camera.target, 0],
    ]);
    for (let tick = 0; tick < 5; tick++) callbacks.onEngineTick();
    expect(cameraMoves(graph)).toHaveLength(1);
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(1);
    adapter.dispose();
  });
  it('emits settled snapshots once, debounces camera motion, and releases pending work', () => {
    vi.useFakeTimers();
    const { adapter, graph, callbacks, events, controls } = setup();
    adapter.update(frame());
    controls.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(1500);
    expect(events.snapshot).not.toHaveBeenCalled();
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    expect(events.snapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dimensions: 2,
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'a', x: 20, y: 30, z: 0 })]),
      }),
    );
    // Saving or annotating produces a presentation update, not a new camera snapshot.
    adapter.update(frame());
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    graph.cameraPosition({ x: 70, y: -20, z: 450 }, { x: 70, y: -20, z: 0 }, 0);
    controls.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(300);
    controls.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(300);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(events.snapshot).toHaveBeenCalledTimes(2);
    graph.graphData().nodes[0].x = 999;
    expect(vi.mocked(events.snapshot!).mock.calls[0][0].nodes[0].x).toBe(20);
    controls.dispatchEvent(new Event('change'));
    adapter.dispose();
    expect(events.snapshot).toHaveBeenCalledTimes(3);
    expect(vi.mocked(events.snapshot!).mock.calls[2][0].nodes[0].x).toBe(999);
    vi.advanceTimersByTime(1500);
    controls.dispatchEvent(new Event('end'));
    expect(events.snapshot).toHaveBeenCalledTimes(3);
  });
  it('captures omitted Flat depth as zero while rejecting invalid 3D depth', () => {
    vi.useFakeTimers();
    const { adapter, graph, callbacks, events } = setup();
    adapter.update(frame(2));
    expect(graph.graphData().nodes.every((node: any) => node.z === undefined)).toBe(true);
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    expect(vi.mocked(events.snapshot!).mock.calls[0][0].nodes.every((node) => node.z === 0)).toBe(
      true,
    );
    adapter.update(frame(3));
    graph.graphData().nodes[0].z = NaN;
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });
  it('discards a saved mode mismatch and resumes normal physics after a restored mode changes', () => {
    const saved = {
      version: 1 as const,
      dimensions: 3 as const,
      camera: {
        position: { x: 40, y: -20, z: 550 },
        target: { x: 40, y: -20, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [
        { id: 'a', x: -42, y: 17, z: 23 },
        { id: 'b', x: 65, y: -12, z: -29 },
      ],
    };
    const mismatch = setup();
    mismatch.adapter.restoreSnapshot?.(saved);
    mismatch.adapter.update(frame(2));
    mismatch.callbacks.onEngineStop();
    expect(cameraMoves(mismatch.graph)).toHaveLength(2);
    expect(mismatch.graph.graphData().nodes[0].x).toBe(20);
    mismatch.adapter.dispose();
    const matching = setup();
    matching.adapter.restoreSnapshot?.(saved);
    matching.adapter.update(frame(3));
    expect(matching.graph.cooldownTicks).toHaveBeenLastCalledWith(0);
    matching.callbacks.onEngineStop();
    matching.adapter.update(frame(2));
    expect(matching.graph.cooldownTicks).toHaveBeenLastCalledWith(120);
    matching.adapter.dispose();
  });
  it('rejects invalid restored geometry and retains coordinates across temporary filtering', () => {
    vi.useFakeTimers();
    const { adapter, graph, callbacks } = setup();
    adapter.restoreSnapshot?.({
      version: 1,
      dimensions: 2,
      camera: {
        position: { x: NaN, y: 0, z: 1 },
        target: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [],
    });
    adapter.update(frame());
    graph.graphData().nodes[1].x = 450;
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    adapter.update({ ...frame(), nodes: [frame().nodes[0]], links: [] });
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    adapter.update(frame());
    expect(graph.graphData().nodes[1].x).toBe(450);
    expect(graph.cooldownTicks).toHaveBeenLastCalledWith(120);
    adapter.dispose();
  });
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
    expect(cameraMoves(graph)).toHaveLength(1);
    adapter.fit();
    adapter.update(frame());
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(2);
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(2);
    adapter.dispose();
  });
  it('defers first-data fit and focus while hidden and keeps the last real viewport', () => {
    const { adapter, graph, callbacks } = setup();
    adapter.resize(0, 0);
    adapter.update(frame());
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(1);
    expect(graph.width).toHaveBeenLastCalledWith(900);
    adapter.resize(390, 600);
    expect(cameraMoves(graph)).toHaveLength(2);
    adapter.resize(0, 0);
    adapter.focus('a');
    const count = graph.cameraPosition.mock.calls.length;
    adapter.resize(390, 600);
    expect(graph.cameraPosition.mock.calls.length).toBeGreaterThan(count);
    expect(graph.cameraPosition.mock.calls.at(-1)?.[1]).toEqual({ x: 20, y: 30, z: 0 });
    adapter.dispose();
  });
  it('focuses a newly arriving node once and never fits or refocuses after parent merges and settlement', () => {
    const { adapter, graph, callbacks } = setup();
    adapter.focus('a');
    expect(graph.cameraPosition.mock.calls.filter((args: unknown[]) => args.length)).toHaveLength(
      0,
    );
    adapter.update(frame(3));
    const focused = graph.cameraPosition.mock.calls.filter((args: unknown[]) => args.length);
    expect(focused).toHaveLength(1);
    expect(focused[0][1]).toEqual({ x: 20, y: 30, z: 40 });
    const original = frame(3);
    adapter.update({
      ...original,
      nodes: [...original.nodes, { ...original.nodes[0], id: 'parent' }],
    });
    for (let tick = 0; tick < 4; tick++) callbacks.onEngineTick();
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(1);
    expect(graph.cameraPosition.mock.calls.filter((args: unknown[]) => args.length)).toHaveLength(
      1,
    );
    adapter.dispose();
  });
  it('waits for finite coordinates and cancels initial fitting while a focus is pending', () => {
    const { adapter, graph, callbacks } = setup();
    adapter.update(frame(3));
    const target = graph.graphData().nodes[0];
    target.x = undefined;
    target.z = NaN;
    adapter.focus('a');
    for (let tick = 0; tick < 4; tick++) callbacks.onEngineTick();
    expect(graph.cameraPosition.mock.calls.filter((args: unknown[]) => args.length)).toHaveLength(
      0,
    );
    expect(cameraMoves(graph)).toHaveLength(0);
    target.x = 123;
    target.z = -456;
    callbacks.onEngineTick();
    expect(graph.cameraPosition.mock.calls.at(-1)?.[1]).toEqual({ x: 123, y: 30, z: -456 });
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(1);
    expect(graph.cameraPosition.mock.calls.filter((args: unknown[]) => args.length)).toHaveLength(
      1,
    );
    adapter.dispose();
  });
  it('lets a manual gesture or explicit fit cancel a focus waiting for its node', () => {
    for (const cancel of ['gesture', 'fit']) {
      const { adapter, graph, callbacks, pointer } = setup();
      adapter.update(frame(3));
      adapter.focus('later');
      if (cancel === 'gesture') pointer('wheel');
      else adapter.fit();
      const original = frame(3);
      adapter.update({
        ...original,
        nodes: [...original.nodes, { ...original.nodes[0], id: 'later' }],
      });
      callbacks.onEngineTick();
      callbacks.onEngineStop();
      expect(cameraMoves(graph)).toHaveLength(cancel === 'gesture' ? 0 : 2);
      if (cancel === 'gesture') expect(cameraMoves(graph)).toHaveLength(0);
      else expect(cameraMoves(graph).length).toBeGreaterThan(0);
      adapter.dispose();
    }
  });
  it('focuses the immediate neighborhood without including distant branches or moving again during edits', () => {
    const { adapter, graph, callbacks } = setup();
    const data = frame(3);
    const nodes = [
      { ...data.nodes[0], x: 1000, y: 500, z: 100, radius: 12 },
      { ...data.nodes[1], x: 1020, y: 500, z: 250, radius: 20 },
      { ...data.nodes[0], id: 'distant', x: 1000000, y: 0, z: 0 },
    ];
    adapter.update({ ...data, nodes });
    adapter.focus('a');
    const [position, target] = cameraMoves(graph).at(-1)!;
    expect(target).toEqual({ x: 1000, y: 500, z: 100 });
    expect(position.x).toBe(target.x);
    expect(position.y).toBe(target.y);
    expect(position.z - target.z).toBeGreaterThan(200);
    expect(position.z - target.z).toBeLessThan(1000);
    adapter.update({ ...data, nodes: nodes.map((item) => ({ ...item, color: '#abc123' })) });
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(1);
    adapter.fit();
    expect(cameraMoves(graph).at(-1)![1].x).toBeGreaterThan(400000);
    adapter.dispose();
  });
  it('reframes a fitted viewport on resize but preserves gestures and restored camera positions', () => {
    const { adapter, graph, pointer } = setup();
    const data = frame(3);
    adapter.update({
      ...data,
      nodes: data.nodes.map((item, index) => ({ ...item, x: index * 100, y: index * 80, z: 0 })),
    });
    adapter.fit();
    const fitted = cameraMoves(graph).length;
    adapter.resize(600, 250, 70);
    expect(cameraMoves(graph)).toHaveLength(fitted + 1);
    pointer('wheel');
    graph.cameraPosition({ x: 50, y: 25, z: 600 }, { x: 50, y: 25, z: 0 }, 0);
    const moved = cameraMoves(graph).length;
    adapter.resize(900, 600, 50);
    expect(cameraMoves(graph)).toHaveLength(moved);
    expect(graph.cameraPosition()).toEqual({ x: 50, y: 25, z: 600 });
    adapter.fit();
    adapter.restoreSnapshot?.({
      version: 1,
      dimensions: 3,
      camera: {
        position: { x: 20, y: 10, z: 500 },
        target: { x: 20, y: 10, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      nodes: [],
    });
    adapter.update(data);
    const restored = cameraMoves(graph).length;
    adapter.resize(700, 500, 80);
    expect(cameraMoves(graph)).toHaveLength(restored);
    expect(graph.cameraPosition()).toEqual({ x: 20, y: 10, z: 500 });
    adapter.dispose();
  });
  it('keeps arrow bounds aligned with actual custom mesh sizes without moving the layout or camera', () => {
    const { adapter, graph } = setup();
    adapter.update(frame(3));
    const radius = (node: GraphFrame['nodes'][number]) =>
      Math.cbrt(graph.nodeVal.mock.calls[0][0](node)) * 3.2;
    expect(radius({ ...frame(3).nodes[0], radius: 10 })).toBeCloseTo(Math.sqrt(3) * 8);
    expect(radius({ ...frame(3).nodes[1], radius: 10 })).toBeCloseTo(10);
    expect(radius({ ...frame(3).nodes[0], shape: 'octahedron', radius: 10 })).toBeCloseTo(14);
    const node = graph.graphData().nodes[1];
    const originalPosition = { x: node.x, y: node.y, z: node.z };
    const originalCamera = graph.cameraPosition();
    const graphWrites = graph.graphData.mock.calls.filter((args: unknown[]) => args.length).length;
    adapter.update({
      ...frame(3),
      nodes: frame(3).nodes.map((item) => ({ ...item, radius: 13.3 })),
    });
    expect(graph.graphData().nodes[1]).toBe(node);
    expect(radius(node)).toBeCloseTo(13.3);
    expect(node).toMatchObject(originalPosition);
    expect(graph.cameraPosition()).toEqual(originalCamera);
    expect(graph.graphData.mock.calls.filter((args: unknown[]) => args.length)).toHaveLength(
      graphWrites,
    );
    expect(graph.linkOpacity).toHaveBeenCalledWith(0.46);
    expect(graph.linkDirectionalArrowResolution).toHaveBeenCalledWith(4);
    adapter.dispose();
  });
  it('preserves 2D pan and 3D orbit mappings, resize, focus and explicit fit', () => {
    const { adapter, graph, controls, callbacks } = setup();
    adapter.update(frame());
    expect(controls.enableRotate).toBe(false);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.PAN);
    expect(controls.touches).toEqual({ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN });
    adapter.focus('a');
    expect(graph.cameraPosition.mock.calls.at(-1)?.[0]).toEqual({ x: 20, y: 30, z: 40 });
    callbacks.onEngineStop();
    expect(cameraMoves(graph)).toHaveLength(2);
    adapter.update(frame(3));
    expect(controls.enableRotate).toBe(true);
    expect(controls.mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    expect(controls.touches.ONE).toBe(TOUCH.ROTATE);
    adapter.focus('b');
    const [camera, target] = graph.cameraPosition.mock.calls.at(-1)!;
    expect(Math.hypot(camera.x - target.x, camera.y - target.y, camera.z - target.z)).toBeCloseTo(
      40,
    );
    adapter.resize(900, 600);
    expect(graph.width).toHaveBeenLastCalledWith(900);
    expect(graph.height).toHaveBeenLastCalledWith(600);
    adapter.fit();
    expect(cameraMoves(graph).length).toBeGreaterThan(0);
    adapter.dispose();
  });
  it('emits stable node/link IDs and local pointers, suppresses touch hover and gesture selections', () => {
    const { adapter, events, pointer, callbacks } = setup();
    adapter.update(frame());
    pointer('pointermove');
    callbacks.onNodeHover({ id: 'a', x: 99 });
    expect(events.hover).toHaveBeenLastCalledWith({
      hit: { type: 'node', id: 'a' },
      point: {
        x: 50,
        y: 50,
        pointerType: 'mouse',
        modifiers: { ctrl: false, meta: false, shift: false },
      },
    });
    pointer('pointerdown');
    pointer('pointerup');
    callbacks.onLinkClick({ id: 'edge', source: {} }, { button: 0 });
    expect(events.select).toHaveBeenLastCalledWith({
      hit: { type: 'link', id: 'edge' },
      point: {
        x: 50,
        y: 50,
        pointerType: 'mouse',
        modifiers: { ctrl: false, meta: false, shift: false },
      },
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
      point: {
        x: 50,
        y: 50,
        pointerType: 'touch',
        modifiers: { ctrl: false, meta: false, shift: false },
      },
    });
    adapter.dispose();
  });
  it('does no snapshot work during wheel bursts, then publishes one camera update after quiet time', () => {
    vi.useFakeTimers();
    const { adapter, graph, controls, callbacks, events, pointer } = setup();
    adapter.update(frame(3));
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    const initialNodes = vi.mocked(events.snapshot!).mock.calls[0][0].nodes;
    vi.mocked(events.snapshot!).mockClear();
    for (let step = 0; step < 20; step++) {
      // OrbitControls dispatches start/end for every wheel event.
      controls.dispatchEvent(new Event('start'));
      graph.cameraPosition({ x: step, y: 0, z: 250 }, { x: 0, y: 0, z: 0 }, 0);
      controls.dispatchEvent(new Event('change'));
      controls.dispatchEvent(new Event('end'));
      pointer('wheel');
      vi.advanceTimersByTime(80);
    }
    expect(events.snapshot).not.toHaveBeenCalled();
    expect(events.activity).toHaveBeenCalledTimes(1);
    expect(events.activity).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(1000);
    expect(events.snapshot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    expect(events.activity).toHaveBeenLastCalledWith(false);
    const saved = vi.mocked(events.snapshot!).mock.calls[0][0];
    expect(saved.camera.position.x).toBe(19);
    expect(saved.nodes).toBe(initialNodes);
    expect(Object.isFrozen(saved.nodes)).toBe(true);
    expect(saved.nodes.every(Object.isFrozen)).toBe(true);
    adapter.dispose();
  });

  it('defers pending idle work during a held pointer and flushes a quick exit explicitly', () => {
    vi.useFakeTimers();
    const { adapter, graph, callbacks, controls, events, pointer } = setup();
    adapter.update(frame(3));
    callbacks.onEngineStop();
    pointer('pointerdown');
    graph.cameraPosition({ x: 60, y: -15, z: 250 }, { x: 20, y: -15, z: 0 }, 0);
    controls.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(5000);
    expect(events.snapshot).not.toHaveBeenCalled();
    expect(events.activity).toHaveBeenLastCalledWith(true);
    pointer('pointerup');
    adapter.flushSnapshot?.();
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    expect(vi.mocked(events.snapshot!).mock.calls[0][0].camera.position.x).toBe(60);
    expect(events.activity).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(5000);
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it('cancels a queued browser idle callback when a new gesture begins', () => {
    vi.useFakeTimers();
    const idle = vi.fn();
    const cancel = vi.fn();
    Object.assign(window, { requestIdleCallback: idle, cancelIdleCallback: cancel });
    idle.mockReturnValue(73);
    const { adapter, callbacks, events, pointer } = setup();
    adapter.update(frame(3));
    callbacks.onEngineStop();
    vi.advanceTimersByTime(1500);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(events.snapshot).not.toHaveBeenCalled();
    pointer('pointerdown');
    expect(cancel).toHaveBeenCalledWith(73);
    pointer('pointerup');
    vi.advanceTimersByTime(1500);
    idle.mock.calls.at(-1)![0]();
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    adapter.dispose();
  });

  it('suppresses connection hover while preserving deliberate connection selection', () => {
    const { adapter, events, pointer, callbacks } = setup();
    adapter.update(frame());
    pointer('pointermove');
    callbacks.onNodeHover({ id: 'a' });
    callbacks.onNodeHover(undefined);
    callbacks.onLinkHover({ id: 'edge' });
    expect(events.hover).toHaveBeenLastCalledWith({
      hit: undefined,
      point: {
        x: 50,
        y: 50,
        pointerType: 'mouse',
        modifiers: { ctrl: false, meta: false, shift: false },
      },
    });
    pointer('pointerdown');
    pointer('pointerup');
    callbacks.onLinkClick({ id: 'edge' }, { button: 0 });
    expect(events.select).toHaveBeenLastCalledWith(
      expect.objectContaining({ hit: { type: 'link', id: 'edge' } }),
    );
    adapter.dispose();
  });
  it('shares caption resources, changes text without resetting positions, and disposes hidden text', () => {
    const drawing = {
      font: '',
      textAlign: '',
      textBaseline: '',
      fillStyle: '',
      measureText: (text: string) => ({ width: text.length * 12 }),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      fillText: vi.fn(),
    };
    const createElement = vi.fn(() => ({ getContext: () => drawing, width: 0, height: 0 }));
    vi.stubGlobal('document', { createElement });
    const { adapter, graph, callbacks } = setup();
    const annotated = {
      ...frame(),
      nodes: frame().nodes.map((node) => ({ ...node, text: '🏦 Deposit\n#Exchange' })),
    };
    adapter.update(annotated);
    expect(createElement).toHaveBeenCalledTimes(1);
    const firstNode = graph.graphData().nodes[0];
    firstNode.x = 125;
    const mesh = callbacks.nodeThreeObject(firstNode) as any;
    const sprite = mesh.children[0];
    expect(sprite.isSprite).toBe(true);
    const hits: any[] = [];
    sprite.raycast(new Raycaster(), hits);
    expect(hits).toEqual([]);
    const textureDispose = vi.spyOn(sprite.material.map, 'dispose');
    const materialDispose = vi.spyOn(sprite.material, 'dispose');
    adapter.update(frame());
    expect(mesh.children).toHaveLength(0);
    expect(firstNode.x).toBe(125);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    adapter.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(1);
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
