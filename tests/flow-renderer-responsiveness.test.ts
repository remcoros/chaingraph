import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstancedBufferGeometry, InstancedMesh, Mesh, ShaderMaterial, Vector3 } from 'three';
import type { GraphAdapterEvents, GraphFrame } from '../src/components/graph/adapter';
import type { LayoutRequest, LayoutResult } from '../src/components/graph/flowLayout';
import { cachedLayout, LayoutScheduler } from '../src/components/graph/layoutScheduler';

const harness = vi.hoisted(() => ({ element: undefined as undefined | (() => unknown) }));
vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = harness.element!();
      setPixelRatio = vi.fn();
      getContext = () => ({ getExtension: () => null });
      setClearColor = vi.fn();
      getClearColor = (color: InstanceType<typeof actual.Color>) => color.set('#112233');
      setSize = vi.fn();
      render = vi.fn();
      dispose = vi.fn();
      forceContextLoss = vi.fn();
    },
  };
});
vi.mock('three/addons/controls/OrbitControls.js', () => ({
  OrbitControls: class extends EventTarget {
    target = new Vector3();
    enableDamping = false;
    mouseButtons = {};
    touches = {};
    update = vi.fn(() => false);
    dispose = vi.fn();
    listenToKeyEvents = vi.fn();
  },
}));
import { FlowRenderer } from '../src/components/graph/FlowRenderer';

class Element extends EventTarget {
  attributes = new Map<string, string>();
  style = { setProperty: vi.fn() };
  children: unknown[] = [];
  append(...children: unknown[]) {
    this.children.push(...children);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 900, height: 600 };
  }
  focus() {}
  remove() {}
}

class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  postMessage = vi.fn<(request: LayoutRequest) => void>();
  terminate = vi.fn();
  constructor() {
    WorkerMock.instances.push(this);
  }
  reply(request = this.postMessage.mock.calls.at(-1)![0]) {
    this.onmessage?.call(
      this as unknown as Worker,
      {
        data: {
          revision: request.revision,
          positions: request.nodes.map((node, i) => [node.id, { x: i * 20, y: i * 4, z: i * 2 }]),
        },
      } as MessageEvent<LayoutResult>,
    );
  }
  fail() {
    this.onerror?.call(this as unknown as Worker, new Event('error') as ErrorEvent);
  }
}
const request = (revision: number, count = 3): LayoutRequest => ({
  revision,
  dimensions: 3,
  nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, shape: 'box' })),
  links: [],
  previous: [],
});
const frame = (count = 3): GraphFrame => ({
  dimensions: 3,
  background: '#112233',
  nodes: request(0, count).nodes.map((n) => ({
    ...n,
    color: '#aabbcc',
    radius: 3,
    highlight: false,
  })),
  links: Array.from({ length: count - 1 }, (_, i) => ({
    id: `l${i}`,
    source: `n${i}`,
    target: `n${i + 1}`,
    color: '#8899aa',
    width: 1,
    arrowLength: 4,
  })),
});

beforeEach(() => {
  vi.useFakeTimers();
  WorkerMock.instances = [];
  harness.element = () => new Element();
  vi.stubGlobal('Worker', WorkerMock);
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { createElement: () => new Element(), hidden: false }),
  );
  vi.stubGlobal('window', {});
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const events: GraphAdapterEvents = {
    hover: vi.fn(),
    select: vi.fn(),
    dismiss: vi.fn(),
    error: vi.fn(),
    snapshot: vi.fn(),
    activity: vi.fn(),
    layout: vi.fn(),
  };
  const renderer = new FlowRenderer(new Element() as unknown as HTMLElement, events);
  renderer.resize(900, 600);
  return { renderer, events };
}

describe('latest graph layout scheduling', () => {
  it('terminates obsolete expansion and immediately restores a fully cached subset', () => {
    const accept = vi.fn(),
      fail = vi.fn();
    const scheduler = new LayoutScheduler(() => new WorkerMock(), accept, fail);
    const expansion = request(1, 10_000);
    scheduler.request(expansion);
    const obsolete = WorkerMock.instances[0];
    const delayedReply = obsolete.onmessage!;
    const subset = request(2);
    subset.previous = subset.nodes.map((node, i) => [node.id, { x: i, y: 0, z: 0 }]);
    scheduler.request(subset);
    expect(obsolete.terminate).toHaveBeenCalledOnce();
    expect(WorkerMock.instances).toHaveLength(1);
    expect(accept).toHaveBeenCalledExactlyOnceWith({ revision: 2, positions: subset.previous });
    delayedReply.call(
      obsolete as unknown as Worker,
      new MessageEvent<LayoutResult>('message', { data: { revision: 1, positions: [] } }),
    );
    expect(accept).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it('starts the latest uncached request immediately, rejects stale and duplicate worker replies', () => {
    const accept = vi.fn();
    const scheduler = new LayoutScheduler(() => new WorkerMock(), accept, vi.fn());
    scheduler.request(request(1, 10_000));
    const old = WorkerMock.instances[0];
    scheduler.request(request(2, 5));
    expect(old.terminate).toHaveBeenCalledOnce();
    const current = WorkerMock.instances[1];
    expect(current.postMessage).toHaveBeenCalledExactlyOnceWith(request(2, 5));
    old.reply();
    expect(accept).not.toHaveBeenCalled();
    current.reply();
    current.reply();
    expect(accept).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('preserves explicit anchors and refuses a partly cached graph', () => {
    const value = request(1);
    value.previous = value.nodes.map((node) => [node.id, { x: 1, y: 2, z: 3 }]);
    value.nodes[0] = { ...value.nodes[0], fx: 8, fy: 9, fz: 10 };
    expect(cachedLayout(value)?.positions[0]).toEqual(['n0', { x: 8, y: 9, z: 10 }]);
    expect(cachedLayout({ ...value, previous: [] })).toBeUndefined();
  });

  it('reports creation/posting/runtime failures without doing force work on the caller thread, and can retry', () => {
    const fail = vi.fn(),
      accept = vi.fn();
    const factory = vi.fn(() => new WorkerMock());
    factory.mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    const scheduler = new LayoutScheduler(factory, accept, fail);
    scheduler.request(request(1, 10_000));
    expect(fail).toHaveBeenLastCalledWith(1);
    scheduler.request(request(2));
    WorkerMock.instances[0].fail();
    expect(fail).toHaveBeenLastCalledWith(2);
    factory.mockImplementationOnce(() => {
      const worker = new WorkerMock();
      worker.postMessage.mockImplementation(() => {
        throw new Error('cannot clone');
      });
      return worker;
    });
    scheduler.request(request(3));
    expect(fail).toHaveBeenLastCalledWith(3);
    scheduler.request(request(4));
    WorkerMock.instances[2].reply();
    expect(accept).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });
});

describe('default renderer responsiveness and snapshots', () => {
  it.each(['fit', 'focus'] as const)(
    'preserves a completed %s camera across toolbar inset changes and graph additions',
    (action) => {
      const { renderer, events } = setup();
      renderer.update(frame());
      WorkerMock.instances[0].reply();
      if (action === 'fit') renderer.fit();
      else renderer.focus('n1');
      const camera = renderer.camera.position.clone(),
        target = renderer.controls.target.clone(),
        zoom = renderer.camera.zoom;
      renderer.flushSnapshot();
      const saved = vi.mocked(events.snapshot!).mock.calls.at(-1)![0];
      renderer.resize(900, 600, 80, 110);
      expect(renderer.camera.position).toEqual(camera);
      expect(renderer.controls.target).toEqual(target);
      expect(renderer.camera.zoom).toBe(zoom);
      renderer.update(frame(7));
      WorkerMock.instances[0].reply();
      renderer.resize(900, 600, 120, 160);
      // Adding a side can also reflow inspector content by a few CSS pixels.
      // The earlier completed frame must not become an implicit expansion Fit.
      renderer.resize(900, 606.421875, 120, 160);
      expect(renderer.camera.position).toEqual(camera);
      expect(renderer.controls.target).toEqual(target);
      expect(renderer.camera.zoom).toBe(zoom);
      renderer.flushSnapshot();
      const expanded = vi.mocked(events.snapshot!).mock.calls.at(-1)![0];
      expect(expanded.camera).toEqual(saved.camera);
      expect(expanded.nodes.slice(0, 3)).toEqual(saved.nodes);
      // A deliberate Fit uses the new viewport reservations and expanded graph.
      renderer.fit();
      expect(renderer.camera.position).not.toEqual(camera);
      renderer.dispose();
    },
  );

  it('continues fitting an explicitly framed graph when the actual canvas size changes', () => {
    const { renderer } = setup();
    renderer.update(frame(20));
    WorkerMock.instances[0].reply();
    renderer.fit();
    const camera = renderer.camera.position.clone();
    renderer.resize(400, 300, 80, 100);
    expect(renderer.camera.position).not.toEqual(camera);
    renderer.dispose();
  });

  it.each(['transaction', 'outpoint'])(
    'passes the chosen outpoint as an expansion origin while selecting the %s',
    (selection) => {
      const { renderer } = setup();
      const original = frame(2);
      original.nodes = original.nodes.map((node) => ({ ...node, shape: 'sphere' }));
      original.links = [];
      renderer.update(original);
      WorkerMock.instances[0].reply();
      const requests = WorkerMock.instances[0].postMessage.mock.calls.length;
      const camera = renderer.camera.position.clone();
      const chosen = {
        ...original,
        nodes: original.nodes.map((node) => ({ ...node, selected: node.id === 'n1' })),
      };
      renderer.update(chosen);
      expect(WorkerMock.instances[0].postMessage).toHaveBeenCalledTimes(requests);
      expect(renderer.camera.position).toEqual(camera);

      const opened = frame(3);
      opened.nodes = opened.nodes.map((node) => ({
        ...node,
        shape: node.id === 'n2' ? 'box' : 'sphere',
        selected: node.id === (selection === 'transaction' ? 'n2' : 'n1'),
      }));
      opened.links = opened.links.map((link, index) => ({
        ...link,
        source: `n${index}`,
        target: 'n2',
        directed: true,
      }));
      renderer.update(opened);
      const request = WorkerMock.instances[0].postMessage.mock.calls.at(-1)![0];
      expect(request.expansionOrigin).toEqual({ nodeId: 'n2', anchorId: 'n1' });
      expect(request.previous).toHaveLength(2);
      WorkerMock.instances[0].reply();
      renderer.repack();
      expect(
        WorkerMock.instances[0].postMessage.mock.calls.at(-1)![0].expansionOrigin,
      ).toBeUndefined();
      renderer.dispose();
    },
  );

  it('does not use an unrelated selected outpoint as an expansion origin', () => {
    const { renderer } = setup();
    const original = frame(1);
    original.nodes = original.nodes.map((node) => ({ ...node, shape: 'sphere', selected: true }));
    renderer.update(original);
    WorkerMock.instances[0].reply();
    const opened = frame(2);
    opened.nodes = opened.nodes.map((node) => ({ ...node, selected: node.id === 'n1' }));
    opened.links = [];
    renderer.update(opened);
    expect(
      WorkerMock.instances[0].postMessage.mock.calls.at(-1)![0].expansionOrigin,
    ).toBeUndefined();
    renderer.dispose();
  });

  it('reverses a pending 10,000-node expansion to the displayed subset and ignores its late result', () => {
    const { renderer, events } = setup();
    renderer.update(frame());
    WorkerMock.instances[0].reply();
    renderer.flushSnapshot();
    const original = vi.mocked(events.snapshot!).mock.calls.at(-1)![0].nodes;
    renderer.update(frame(10_000));
    const obsolete = WorkerMock.instances[0];
    renderer.update(frame());
    expect(obsolete.terminate).toHaveBeenCalledOnce();
    expect(renderer.canvas.getAttribute('aria-busy')).toBe('false');
    expect(events.layout).toHaveBeenLastCalledWith({ busy: false, nodeCount: 3 });
    obsolete.reply();
    renderer.flushSnapshot();
    expect(vi.mocked(events.snapshot!).mock.calls.at(-1)![0].nodes).toEqual(original);
    expect(
      renderer.scene.children
        .filter((child) => child instanceof InstancedMesh)
        .reduce((sum, child) => sum + (child as InstancedMesh).count, 0),
    ).toBe(3);
    renderer.dispose();
  });

  it('defers snapshots throughout a camera gesture and flushes the visible camera while a large layout is pending', () => {
    const { renderer, events } = setup();
    renderer.update(frame());
    WorkerMock.instances[0].reply();
    renderer.flushSnapshot();
    const original = vi.mocked(events.snapshot!).mock.calls.at(-1)![0].nodes;
    vi.mocked(events.snapshot!).mockClear();
    renderer.canvas.dispatchEvent(
      Object.assign(new Event('pointerdown'), { pointerId: 1, clientX: 20, clientY: 30 }),
    );
    renderer.camera.position.set(90, 80, 70);
    renderer.update(frame(10_000));
    vi.advanceTimersByTime(3000);
    expect(events.snapshot).not.toHaveBeenCalled();
    renderer.flushSnapshot();
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(events.snapshot!).mock.calls[0][0];
    expect(saved.camera.position).toEqual({ x: 90, y: 80, z: 70 });
    expect(saved.nodes).toBe(original);
    expect(renderer.canvas.getAttribute('aria-busy')).toBe('true');
    expect(events.activity).toHaveBeenLastCalledWith(true);
    renderer.dispose();
    expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
    expect(events.activity).toHaveBeenLastCalledWith(false);
  });

  it('publishes newly settled geometry after a pending checkpoint without a camera change, then deduplicates unchanged flushes', () => {
    const { renderer, events } = setup();
    renderer.update(frame());
    WorkerMock.instances[0].reply();
    renderer.flushSnapshot();
    const initial = vi.mocked(events.snapshot!).mock.calls.at(-1)![0];
    vi.mocked(events.snapshot!).mockClear();

    renderer.update(frame(7));
    renderer.flushSnapshot();
    expect(events.snapshot).toHaveBeenCalledTimes(1);
    const pending = vi.mocked(events.snapshot!).mock.calls[0][0];
    expect(pending.nodes).toBe(initial.nodes);
    expect(pending.nodes).toHaveLength(3);
    expect(pending.camera).toEqual(initial.camera);
    expect(renderer.canvas.getAttribute('aria-busy')).toBe('true');

    // A pending checkpoint already used this request's revision. Accepting its
    // result must publish the changed geometry even if the camera has not moved.
    WorkerMock.instances[0].reply();
    expect(events.layout).toHaveBeenLastCalledWith({ busy: false, nodeCount: 7 });
    renderer.flushSnapshot();
    expect(events.snapshot).toHaveBeenCalledTimes(2);
    const settled = vi.mocked(events.snapshot!).mock.calls[1][0];
    expect(settled.camera).toEqual(pending.camera);
    expect(settled.nodes.map((node) => node.id)).toEqual([
      'n0',
      'n1',
      'n2',
      'n3',
      'n4',
      'n5',
      'n6',
    ]);
    expect(settled.nodes.slice(0, 3)).toEqual(pending.nodes);
    expect(settled.nodes).not.toBe(pending.nodes);

    renderer.flushSnapshot();
    expect(events.snapshot).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });

  it('captures the camera before the first layout completes without inventing positions', () => {
    const { renderer, events } = setup();
    renderer.update(frame(10_000));
    renderer.camera.position.set(10, 20, 30);
    renderer.flushSnapshot();
    expect(events.snapshot).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        camera: expect.objectContaining({ position: { x: 10, y: 20, z: 30 } }),
        nodes: [],
      }),
    );
    expect(events.layout).toHaveBeenLastCalledWith({ busy: true, nodeCount: 10_000 });
    renderer.dispose();
  });

  it('retains visible geometry after a worker failure and retries the requested graph', () => {
    const { renderer, events } = setup();
    renderer.update(frame());
    WorkerMock.instances[0].reply();
    renderer.update(frame(1000));
    WorkerMock.instances[0].fail();
    expect(events.layout).toHaveBeenLastCalledWith({ busy: false, nodeCount: 1000, error: true });
    expect(events.error).not.toHaveBeenCalled();
    renderer.flushSnapshot();
    expect(vi.mocked(events.snapshot!).mock.calls.at(-1)![0].nodes).toHaveLength(3);
    renderer.repack();
    expect(WorkerMock.instances[1].postMessage.mock.calls[0][0].nodes).toHaveLength(1000);
    WorkerMock.instances[1].reply();
    expect(events.layout).toHaveBeenLastCalledWith({ busy: false, nodeCount: 1000 });
    renderer.dispose();
  });

  it('allows retrying a failed snapshot publication without losing the visible view', () => {
    const { renderer, events } = setup();
    renderer.update(frame());
    WorkerMock.instances[0].reply();
    renderer.camera.position.set(44, 55, 66);
    vi.mocked(events.snapshot!).mockImplementationOnce(() => {
      throw new Error('save failed');
    });
    expect(() => renderer.flushSnapshot()).toThrow('save failed');
    renderer.flushSnapshot();
    expect(events.snapshot).toHaveBeenCalledTimes(2);
    expect(vi.mocked(events.snapshot!).mock.calls[1][0].camera.position).toEqual({
      x: 44,
      y: 55,
      z: 66,
    });
    renderer.dispose();
  });

  it('does not rebuild node matrices, bounds or edge buffers for a caption/selection-only edit', () => {
    const { renderer } = setup();
    const original = frame(1000);
    renderer.update(original);
    WorkerMock.instances[0].reply();
    const mesh = renderer.scene.children.find(
      (child) => child instanceof InstancedMesh,
    ) as InstancedMesh;
    const bounds = vi.spyOn(mesh, 'computeBoundingSphere');
    const version = mesh.instanceMatrix.version;
    const edge = renderer.scene.children.find(
      (child) => 'geometry' in child && !(child instanceof InstancedMesh),
    ) as unknown as { geometry: { getAttribute(name: string): { version: number } } };
    const edgeVersion = edge.geometry.getAttribute('start').version;
    renderer.update({
      ...original,
      nodes: original.nodes.map((node, i) =>
        i
          ? node
          : {
              ...node,
              text: 'My label',
              selected: true,
              marker: { shape: 'brackets', color: '#83baff' },
            },
      ),
    });
    expect(mesh.instanceMatrix.version).toBe(version);
    expect(bounds).not.toHaveBeenCalled();
    expect(edge.geometry.getAttribute('start').version).toBe(edgeVersion);
    expect(WorkerMock.instances[0].postMessage).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });

  it('keeps contextual marker changes out of pending layout jobs and preserves the settled camera and positions', () => {
    const { renderer, events } = setup();
    const original = frame(100);
    renderer.update(original);
    const worker = WorkerMock.instances[0];
    const contextual = (shape: 'brackets' | 'ring'): GraphFrame => ({
      ...original,
      nodes: original.nodes.map((n, i) =>
        i ? n : { ...n, selected: true, marker: { shape, color: '#83baff' } },
      ),
      links: original.links.map((l) => ({ ...l, color: '#83baff' })),
    });
    renderer.update(contextual('brackets'));
    renderer.update(contextual('ring'));
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.reply();
    renderer.camera.position.set(44, 55, 66);
    renderer.flushSnapshot();
    const saved = vi.mocked(events.snapshot!).mock.calls.at(-1)![0];
    vi.mocked(events.layout!).mockClear();
    renderer.update(contextual('brackets'));
    renderer.flushSnapshot();
    expect(events.layout).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(renderer.camera.position.toArray()).toEqual([44, 55, 66]);
    expect(vi.mocked(events.snapshot!).mock.calls.at(-1)![0]).toEqual(saved);
    renderer.dispose();
  });
});

function animationHarness() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.mocked(requestAnimationFrame).mockImplementation((callback) => {
    const id = ++next;
    callbacks.set(id, callback);
    return id;
  });
  vi.mocked(cancelAnimationFrame).mockImplementation((id) => {
    callbacks.delete(id);
  });
  return {
    callbacks,
    step(time: number) {
      const pending = [...callbacks];
      for (const [id, callback] of pending) if (callbacks.delete(id)) callback(time);
    },
  };
}
function particleMesh(renderer: FlowRenderer) {
  return renderer.scene.getObjectByName('flow-particles') as Mesh<
    InstancedBufferGeometry,
    ShaderMaterial
  >;
}
function directedFrame(selected = true): GraphFrame {
  const graph = frame();
  graph.nodes = graph.nodes.map((node, index) => ({
    ...node,
    flowActive: selected && index === 0,
  }));
  graph.links = graph.links.map((link) => ({ ...link, directed: true }));
  return graph;
}
describe('flow motion stays independent of graph persistence and layout', () => {
  it('animates selected/batch flow without camera updates, node/edge uploads, activity or snapshots', () => {
    const animation = animationHarness(),
      { renderer, events } = setup();
    renderer.update(directedFrame());
    WorkerMock.instances[0].reply();
    animation.step(0);
    renderer.flushSnapshot();
    const camera = renderer.camera.position.clone();
    const node = renderer.scene.children.find(
      (child) => child instanceof InstancedMesh,
    ) as InstancedMesh;
    const version = node.instanceMatrix.version;
    const edges = renderer.scene.children.find(
      (child) =>
        child instanceof Mesh &&
        child.name !== 'flow-particles' &&
        !(child instanceof InstancedMesh),
    ) as Mesh;
    const start = edges.geometry.getAttribute('start');
    const before = Array.from(start.array);
    const particles = particleMesh(renderer),
      phase = particles.material.uniforms.phase.value;
    vi.mocked(renderer.controls.update).mockClear();
    vi.mocked(events.snapshot!).mockClear();
    vi.mocked(events.activity!).mockClear();
    vi.mocked(renderer.renderer.render).mockClear();
    for (let i = 1; i <= 12; i++) animation.step(i * 16);
    expect(renderer.renderer.render).toHaveBeenCalledTimes(12);
    expect(particles.geometry.instanceCount).toBe(4);
    expect(particles.material.uniforms.phase.value).toBeGreaterThan(phase);
    expect(renderer.controls.update).not.toHaveBeenCalled();
    expect(node.instanceMatrix.version).toBe(version);
    expect(Array.from(start.array)).toEqual(before);
    expect(renderer.camera.position).toEqual(camera);
    expect(events.snapshot).not.toHaveBeenCalled();
    expect(events.activity).not.toHaveBeenCalled();
    expect(WorkerMock.instances[0].postMessage).toHaveBeenCalledTimes(1);
    renderer.dispose();
    expect(animation.callbacks.size).toBe(0);
  });

  it('uses the explicit motion toggle, stops idle/hidden/lost work and still completes layouts when paused', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const animation = animationHarness(),
      { renderer, events } = setup();
    expect(renderer.controls.enableDamping).toBe(true);
    renderer.update(directedFrame());
    WorkerMock.instances[0].reply();
    animation.step(0);
    animation.step(16);
    const particles = particleMesh(renderer),
      camera = renderer.camera.position.clone();
    renderer.setMotion(false);
    animation.step(32);
    expect(particles.visible).toBe(false);
    expect(renderer.controls.enableDamping).toBe(false);
    expect(animation.callbacks.size).toBe(0);
    expect(renderer.camera.position).toEqual(camera);
    const expanded = directedFrame();
    expanded.nodes = [...expanded.nodes, { ...expanded.nodes[0], id: 'extra' }];
    renderer.update(expanded);
    WorkerMock.instances[0].reply();
    animation.step(48);
    expect(events.layout).toHaveBeenLastCalledWith({ busy: false, nodeCount: 4 });
    expect(particles.visible).toBe(false);
    renderer.setMotion(true);
    animation.step(64);
    expect(particles.visible).toBe(true);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(animation.callbacks.size).toBe(0);
    const phase = particles.material.uniforms.phase.value;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    animation.step(60_000);
    expect(particles.material.uniforms.phase.value).toBe(phase);
    animation.step(60_016);
    expect(particles.material.uniforms.phase.value - phase).toBeLessThan(0.01);
    renderer.resize(0, 0);
    expect(animation.callbacks.size).toBe(0);
    renderer.resize(900, 600);
    animation.step(60_032);
    expect(particles.visible).toBe(true);
    renderer.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(animation.callbacks.size).toBe(0);
    renderer.canvas.dispatchEvent(new Event('webglcontextrestored'));
    animation.step(60_048);
    expect(particles.visible).toBe(true);
    renderer.update({
      ...expanded,
      nodes: expanded.nodes.map((node) => ({ ...node, selected: false, flowActive: false })),
    });
    animation.step(60_064);
    expect(particles.visible).toBe(false);
    expect(animation.callbacks.size).toBe(0);
    renderer.dispose();
    expect(animation.callbacks.size).toBe(0);
  });

  it('animates a hovered edge without selecting it or rebuilding projected endpoints on each pointer move', () => {
    const animation = animationHarness(),
      { renderer, events } = setup();
    renderer.update(directedFrame(false));
    WorkerMock.instances[0].reply();
    animation.step(0);
    renderer.camera.position.set(0, 0, 100);
    renderer.camera.lookAt(0, 0, 0);
    renderer.camera.updateMatrixWorld();
    (renderer.controls as unknown as EventTarget).dispatchEvent(new Event('change'));
    animation.step(16);
    const projected = new Vector3(10, 2, 1).project(renderer.camera);
    const pointer = {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: (projected.x + 1) * 450,
      clientY: (1 - projected.y) * 300,
    };
    const project = vi.spyOn(
      renderer as unknown as { project(point: unknown): Vector3 },
      'project',
    );
    renderer.canvas.dispatchEvent(Object.assign(new Event('pointermove'), pointer));
    animation.step(32);
    animation.step(48);
    expect(particleMesh(renderer).geometry.instanceCount).toBe(4);
    expect(particleMesh(renderer).visible).toBe(true);
    expect(events.select).not.toHaveBeenCalled();
    expect(events.hover).toHaveBeenLastCalledWith(expect.objectContaining({ hit: undefined }));
    const projections = project.mock.calls.length;
    expect(projections).toBe(3);
    renderer.canvas.dispatchEvent(
      Object.assign(new Event('pointermove'), { ...pointer, clientX: pointer.clientX + 1 }),
    );
    animation.step(64);
    expect(project).toHaveBeenCalledTimes(projections);
    renderer.canvas.dispatchEvent(Object.assign(new Event('pointerleave'), pointer));
    animation.step(80);
    expect(particleMesh(renderer).visible).toBe(false);
    expect(animation.callbacks.size).toBe(0);
    renderer.dispose();
  });

  it('renders at most once when animation and a camera/style frame share the same timestamp', () => {
    const animation = animationHarness(),
      { renderer } = setup();
    renderer.update(directedFrame());
    WorkerMock.instances[0].reply();
    vi.mocked(renderer.renderer.render).mockClear();
    animation.step(0);
    expect(renderer.renderer.render).toHaveBeenCalledTimes(1);
    (renderer.controls as unknown as EventTarget).dispatchEvent(new Event('change'));
    animation.step(16);
    expect(renderer.renderer.render).toHaveBeenCalledTimes(2);
    renderer.dispose();
  });
});
