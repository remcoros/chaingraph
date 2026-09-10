import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Vector3 } from 'three';
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
  vi.stubGlobal('document', { createElement: () => new Element() });
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
        i ? node : { ...node, text: 'My label', selected: true },
      ),
    });
    expect(mesh.instanceMatrix.version).toBe(version);
    expect(bounds).not.toHaveBeenCalled();
    expect(edge.geometry.getAttribute('start').version).toBe(edgeVersion);
    expect(WorkerMock.instances[0].postMessage).toHaveBeenCalledTimes(1);
    renderer.dispose();
  });
});
