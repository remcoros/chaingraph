import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  MOUSE,
  OctahedronGeometry,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  GraphAdapter,
  GraphAdapterEvents,
  GraphFrame,
  GraphHit,
  RenderNode,
  RenderLink,
} from './adapter';
import {
  graphSnapshotSchema,
  GRAPH_SNAPSHOT_NODE_LIMIT,
  type GraphSnapshot,
} from '../../domain/graphSnapshot';
import { frameCamera } from './cameraFraming';
import type { LayoutRequest, LayoutResult, Position } from './flowLayout';
import { compactLayout } from './compactLayout';
import { makeFlowEdges } from './flowEdges';
import './flowRenderer.css';

const shapes = ['box', 'sphere', 'octahedron'] as const;
const vector = (p: Position) => new Vector3(p.x, p.y, p.z);
const point = (p: Vector3) => ({
  x: Math.round(p.x * 1000) / 1000,
  y: Math.round(p.y * 1000) / 1000,
  z: Math.round(p.z * 1000) / 1000,
});

/** Renderer-only state. Frames are immutable; shared GraphView owns all entity actions. */
export class FlowRenderer implements GraphAdapter {
  readonly renderer = new WebGLRenderer({ antialias: true });
  readonly canvas = this.renderer.domElement;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 1e8);
  readonly controls: OrbitControls;
  private edges = makeFlowEdges();
  private geometries = {
    box: new BoxGeometry(1.6, 1.6, 1.6),
    sphere: new SphereGeometry(1, 16, 12),
    octahedron: new OctahedronGeometry(1.4),
  };
  private material = new MeshLambertMaterial();
  private batches: {
    mesh: InstancedMesh<BufferGeometry, MeshLambertMaterial>;
    nodes: RenderNode[];
  }[] = [];
  private nodes: RenderNode[] = [];
  private links: RenderLink[] = [];
  private positions = new Map<string, Position>();
  private cache = new Map<string, Position>();
  private snapshotNodes?: GraphSnapshot['nodes'];
  private snapshotSignature = '';
  private topology = '';
  private revision = 0;
  private worker?: Worker;
  private pending?: LayoutRequest;
  private dimensions: 2 | 3 = 3;
  private modes = new Map<
    number,
    { positions: Map<string, Position>; camera: GraphSnapshot['camera'] }
  >();
  private workerRevision?: number;
  private width = 0;
  private height = 0;
  private inset = 0;
  private firstFit = true;
  private pendingFit = false;
  private pendingFocus?: string;
  private lastFrame?: { id?: string };
  private dead = false;
  private lost = false;
  private active = false;
  private raf = 0;
  private pickRaf = 0;
  private quiet?: ReturnType<typeof setTimeout>;
  private idle?: number;
  private pointers = new Set<number>();
  private down?: { id: number; x: number; y: number };
  private hovered?: string;
  private raycaster = new Raycaster();
  private labels: HTMLDivElement;
  private labelPool: HTMLSpanElement[] = [];
  private cleanups: (() => void)[] = [];
  private settingCamera = false;
  private recovery?: ReturnType<typeof setTimeout>;
  private contextExtension: WEBGL_lose_context | null;

  constructor(
    private container: HTMLElement,
    private events: GraphAdapterEvents,
  ) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.contextExtension = this.renderer.getContext().getExtension('WEBGL_lose_context');
    container.append(this.canvas);
    this.labels = document.createElement('div');
    this.labels.className = 'flow-renderer-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    container.append(this.labels);
    this.camera.position.set(260, 140, 1000);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.dampingFactor = 0.18;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 1e7;
    this.controls.listenToKeyEvents(this.canvas);
    this.controls.addEventListener('change', this.changed);
    this.controls.addEventListener('start', this.begin);
    this.controls.addEventListener('end', this.schedule);
    const light = new DirectionalLight(0xffffff, 2);
    light.position.set(-250, 400, 800);
    this.scene.add(new AmbientLight(0xffffff, 1.8), light, this.edges.mesh);
    try {
      this.worker = new Worker(new URL('./flowLayout.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<LayoutResult>) => {
        this.workerRevision = undefined;
        this.accept(e.data);
        this.dispatchLayout();
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.worker?.terminate();
        this.worker = undefined;
        this.workerRevision = undefined;
        if (this.pending) this.accept(compactLayout(this.pending));
      };
    } catch {
      /* Bounded synchronous fallback uses the same layout. */
    }
    const listen = (name: string, fn: EventListener, options?: AddEventListenerOptions) => {
      this.canvas.addEventListener(name, fn, options);
      this.cleanups.push(() => this.canvas.removeEventListener(name, fn, options));
    };
    listen(
      'pointerdown',
      ((e: PointerEvent) => {
        this.begin();
        this.pointers.add(e.pointerId);
        this.down =
          this.pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : undefined;
        this.canvas.focus({ preventScroll: true });
      }) as EventListener,
      { capture: true },
    );
    listen('pointermove', ((e: PointerEvent) => {
      if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5)
        this.down = undefined;
      if (this.pointers.size || e.pointerType === 'touch') return;
      cancelAnimationFrame(this.pickRaf);
      this.pickRaf = requestAnimationFrame(() => {
        this.pickRaf = 0;
        if (this.dead) return;
        const hit = this.pick(e.clientX, e.clientY);
        const hovered = hit?.type === 'node' ? hit.id : undefined;
        if (this.hovered !== hovered) {
          this.hovered = hovered;
          this.invalidate();
        }
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        this.events.hover({
          hit: hovered ? { type: 'node', id: hovered } : undefined,
          point: this.pointer(e),
        });
      });
    }) as EventListener);
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      const down = this.down;
      this.down = undefined;
      if (
        e.type === 'pointerup' &&
        e.button === 0 &&
        down?.id === e.pointerId &&
        !this.pointers.size &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5
      )
        this.events.select({ hit: this.pick(e.clientX, e.clientY), point: this.pointer(e) });
      this.schedule();
    };
    listen('pointerup', release as EventListener);
    listen('pointercancel', release as EventListener);
    listen('lostpointercapture', ((e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.down = undefined;
      this.schedule();
    }) as EventListener);
    listen('pointerleave', ((e: PointerEvent) => {
      cancelAnimationFrame(this.pickRaf);
      this.hovered = undefined;
      if (e.pointerType !== 'touch') this.events.hover({ point: this.pointer(e) });
      this.invalidate();
    }) as EventListener);
    listen('wheel', this.begin, { capture: true, passive: true });
    listen(
      'keydown',
      ((e: KeyboardEvent) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'f'].includes(e.key))
          this.begin();
        if (e.key === 'f') {
          e.preventDefault();
          this.fit();
        }
        if (['+', '=', '-'].includes(e.key)) {
          e.preventDefault();
          this.camera.position
            .sub(this.controls.target)
            .multiplyScalar(e.key === '-' ? 1.18 : 1 / 1.18)
            .add(this.controls.target);
          this.controls.update();
          this.changed();
        }
      }) as EventListener,
      { capture: true },
    );
    listen('webglcontextlost', ((e: Event) => {
      e.preventDefault();
      this.lost = true;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      cancelAnimationFrame(this.pickRaf);
      this.pointers.clear();
      this.down = undefined;
      this.cancelQuiet();
      this.setActive(false);
      this.labels.hidden = true;
      this.events.dismiss();
      this.events.error();
      this.recovery = setTimeout(() => {
        if (!this.dead) this.contextExtension?.restoreContext();
      }, 500);
    }) as EventListener);
    listen('webglcontextrestored', (() => {
      if (this.dead) return;
      clearTimeout(this.recovery);
      this.contextExtension = this.renderer.getContext().getExtension('WEBGL_lose_context');
      this.lost = false;
      this.labels.hidden = false;
      this.refresh();
      this.events.recovered?.();
      this.schedule();
    }) as EventListener);
  }
  private pointer(e: PointerEvent) {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, pointerType: e.pointerType };
  }
  private setActive(active: boolean) {
    if (this.active !== active) {
      this.active = active;
      this.events.activity?.(active);
    }
  }
  private cancelQuiet() {
    clearTimeout(this.quiet);
    if (this.idle !== undefined) window.cancelIdleCallback?.(this.idle);
    this.idle = undefined;
  }
  private begin = () => {
    if (this.dead || this.lost) return;
    this.cancelQuiet();
    this.firstFit = false;
    this.pendingFit = false;
    this.pendingFocus = undefined;
    this.lastFrame = undefined;
    this.hovered = undefined;
    cancelAnimationFrame(this.pickRaf);
    this.events.dismiss();
    this.setActive(true);
    this.invalidate();
    this.schedule();
  };
  private changed = () => {
    if (this.dead || this.lost) return;
    this.invalidate();
    if (!this.settingCamera) {
      this.setActive(true);
      this.schedule();
    }
  };
  private schedule = () => {
    if (this.dead || this.lost) return;
    this.cancelQuiet();
    this.quiet = setTimeout(() => {
      if (this.pointers.size) return;
      const publish = () => {
        this.idle = undefined;
        if (this.dead || this.pointers.size || this.pending) return;
        this.flushSnapshot();
      };
      if (window.requestIdleCallback)
        this.idle = window.requestIdleCallback(publish, { timeout: 2000 });
      else publish();
    }, 1200);
  };
  private invalidate = () => {
    if (this.raf || this.dead || this.lost || !this.width || !this.height) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
      if (moving) this.invalidate();
    });
  };
  private cameraRecord(): GraphSnapshot['camera'] {
    return {
      position: point(this.camera.position),
      target: point(this.controls.target),
      up: point(this.camera.up),
    };
  }
  private stopDamping() {
    // Discard residual movement before explicit focus/restore/flush. The checkpoint
    // is exactly the current visible view, not an unseen future damping endpoint.
    const position = this.camera.position.clone(),
      target = this.controls.target.clone();
    const damping = this.controls.enableDamping;
    this.settingCamera = true;
    this.controls.enableDamping = false;
    this.controls.update();
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.settingCamera = false;
  }
  flushSnapshot = () => {
    if (this.dead) return;
    this.stopDamping();
    // Explicit workspace transitions cannot wait on a layout worker reply.
    if (this.pending) this.accept(compactLayout(this.pending));
    this.cancelQuiet();
    if (this.positions.size && !this.pending) {
      if (!this.snapshotNodes) {
        this.snapshotNodes = [...this.positions].map(([id, p]) =>
          Object.freeze({ id, ...p, z: this.dimensions === 2 ? 0 : p.z }),
        );
        Object.freeze(this.snapshotNodes);
      }
      const camera = this.cameraRecord();
      const signature = JSON.stringify([this.dimensions, camera, this.revision]);
      if (signature !== this.snapshotSignature) {
        this.snapshotSignature = signature;
        this.events.snapshot?.({
          version: 1,
          dimensions: this.dimensions,
          camera,
          nodes: this.snapshotNodes,
        });
      }
    }
    if (!this.pointers.size) this.setActive(false);
  };
  restoreSnapshot(snapshot: GraphSnapshot) {
    const parsed = graphSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) return;
    this.modes.clear();
    this.topology = '';
    this.dimensions = parsed.data.dimensions;
    this.cache = new Map(parsed.data.nodes.map(({ id, ...p }) => [id, p]));
    this.firstFit = false;
    this.configureDimensions();
    this.restoreCamera(parsed.data.camera);
  }
  private restoreCamera(pose: GraphSnapshot['camera']) {
    this.stopDamping();
    this.settingCamera = true;
    this.camera.position.copy(vector(pose.position));
    this.camera.up.copy(vector(pose.up));
    this.controls.target.copy(vector(pose.target));
    this.controls.update();
    this.settingCamera = false;
    this.invalidate();
  }
  private configureDimensions() {
    this.controls.enableRotate = this.dimensions === 3;
    this.controls.mouseButtons.LEFT = this.dimensions === 2 ? MOUSE.PAN : MOUSE.ROTATE;
    this.controls.touches.ONE = this.dimensions === 2 ? TOUCH.PAN : TOUCH.ROTATE;
    this.controls.touches.TWO = TOUCH.DOLLY_PAN;
  }
  private rememberMode() {
    if (!this.pending)
      this.modes.set(this.dimensions, {
        positions: new Map(this.cache),
        camera: this.cameraRecord(),
      });
  }
  repack = () => {
    if (this.dead) return;
    this.stopDamping();
    this.cache.clear();
    this.modes.clear();
    this.topology = '';
    this.firstFit = false;
    this.pendingFocus = undefined;
    this.lastFrame = undefined;
    this.pendingFit = true;
    this.events.dismiss();
    this.hovered = undefined;
    this.update({
      nodes: this.nodes,
      links: this.links,
      dimensions: this.dimensions,
      background: `#${this.renderer.getClearColor(new Color()).getHexString()}`,
    });
  };
  zoom = (factor: number) => {
    if (this.dead || !Number.isFinite(factor) || factor <= 0) return;
    this.begin();
    this.stopDamping();
    const distance = this.camera.position.distanceTo(this.controls.target);
    const next = Math.max(
      this.controls.minDistance,
      Math.min(this.controls.maxDistance, distance * factor),
    );
    this.camera.position
      .sub(this.controls.target)
      .multiplyScalar(next / Math.max(distance, 0.001))
      .add(this.controls.target);
    this.controls.update();
    this.changed();
  };
  private dispatchLayout() {
    if (this.dead || !this.pending) return;
    if (!this.worker) {
      this.accept(compactLayout(this.pending));
      return;
    }
    // One running request and one latest replacement, never a queue of obsolete layouts.
    if (this.workerRevision !== undefined) return;
    this.workerRevision = this.pending.revision;
    this.worker.postMessage(this.pending);
  }
  update(frame: GraphFrame) {
    if (this.dead) return;
    this.nodes = frame.nodes.map((n) => ({ ...n }));
    const ids = new Set(this.nodes.map((n) => n.id));
    this.links = frame.links
      .filter((l) => ids.has(l.source) && ids.has(l.target))
      .map((l) => ({ ...l }));
    this.renderer.setClearColor(frame.background);
    if (this.dimensions !== frame.dimensions) {
      this.stopDamping();
      this.rememberMode();
      this.dimensions = frame.dimensions;
      this.configureDimensions();
      const saved = this.modes.get(this.dimensions);
      if (saved) {
        this.cache = new Map(saved.positions);
        this.topology = '';
        this.restoreCamera(saved.camera);
      } else {
        this.cache.clear();
        this.topology = '';
        this.pendingFit = true;
        const distance = this.camera.position.distanceTo(this.controls.target);
        const target = point(this.controls.target);
        target.z = 0;
        const p = vector(target).add(
          new Vector3(this.dimensions === 3 ? 0.26 : 0, this.dimensions === 3 ? 0.14 : 0, 1)
            .normalize()
            .multiplyScalar(distance),
        );
        this.restoreCamera({ position: point(p), target, up: { x: 0, y: 1, z: 0 } });
      }
      this.snapshotNodes = undefined;
    }
    const signature = JSON.stringify([
      this.nodes.map((n) => [n.id, n.shape, n.fx ?? n.x, n.fy ?? n.y, n.fz ?? n.z]).sort(),
      this.links.map((l) => [l.source, l.target]).sort(),
    ]);
    if (signature === this.topology) {
      this.refresh();
      this.schedule();
      return;
    }
    this.topology = signature;
    const request: LayoutRequest = {
      revision: ++this.revision,
      dimensions: this.dimensions,
      nodes: this.nodes.map(({ id, shape, radius, x, y, z, fx, fy, fz }) => ({
        id,
        shape,
        radius,
        x,
        y,
        z,
        fx,
        fy,
        fz,
      })),
      links: this.links.map(({ source, target }) => ({ source, target })),
      previous: [...this.cache],
    };
    this.pending = request;
    this.canvas.setAttribute('aria-busy', 'true');
    this.dispatchLayout();
  }
  private accept(result: LayoutResult) {
    if (this.dead || !this.pending || result.revision !== this.revision) return;
    this.pending = undefined;
    this.canvas.setAttribute('aria-busy', 'false');
    this.positions = new Map(result.positions);
    this.snapshotNodes = undefined;
    for (const [id, p] of result.positions) {
      this.cache.delete(id);
      this.cache.set(id, p);
    }
    while (this.cache.size > GRAPH_SNAPSHOT_NODE_LIMIT)
      this.cache.delete(this.cache.keys().next().value!);
    this.batches = shapes.map((shape, index) => {
      const nodes = this.nodes.filter((n) => n.shape === shape);
      let mesh = this.batches[index]?.mesh;
      const capacity = mesh?.instanceMatrix.count ?? 0;
      if (!mesh || nodes.length > capacity || (capacity > 4 && nodes.length < capacity / 4)) {
        if (mesh) {
          this.scene.remove(mesh);
          mesh.dispose();
        }
        const size = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, nodes.length))));
        mesh = new InstancedMesh(this.geometries[shape], this.material, size);
        this.scene.add(mesh);
      }
      mesh.count = nodes.length;
      return { mesh, nodes };
    });
    this.refresh();
    this.fulfillCamera();
    this.schedule();
  }
  private refresh() {
    if (this.pending) return;
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const matrix = new Matrix4();
    const tint = new Color();
    for (const batch of this.batches) {
      batch.nodes = batch.nodes.map((n) => byId.get(n.id)!);
      batch.nodes.forEach((n, i) => {
        const p = this.positions.get(n.id)!;
        matrix
          .makeScale(n.radius, n.radius, n.radius)
          .setPosition(p.x, p.y, this.dimensions === 2 ? 0 : p.z);
        batch.mesh.setMatrixAt(i, matrix);
        batch.mesh.setColorAt(i, tint.set(n.color));
      });
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      batch.mesh.computeBoundingSphere();
    }
    this.edges.update(this.links, byId, this.positions, this.dimensions);
    this.invalidate();
  }
  resize(width: number, height: number, topInset = 0) {
    if (this.dead) return;
    const changed = this.width !== width || this.height !== height || this.inset !== topInset;
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.inset = topInset;
    if (!width || !height) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.renderer.setSize(width, height);
    this.edges.resize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (changed && this.lastFrame && !this.pointers.size) this.frameNodes(this.lastFrame.id);
    this.fulfillCamera();
    this.invalidate();
  }
  private fulfillCamera() {
    if (this.pending || !this.width || !this.height || !this.positions.size) return;
    if (this.pendingFocus) {
      // Selection may arrive before the frame containing a new watched address.
      // Retain that intent until final geometry exists; begin() cancels it on input.
      if (!this.positions.has(this.pendingFocus)) return;
      const id = this.pendingFocus;
      this.pendingFocus = undefined;
      this.firstFit = false;
      this.pendingFit = false;
      this.frameNodes(id);
    } else if (this.firstFit || this.pendingFit) {
      this.firstFit = false;
      this.pendingFit = false;
      this.frameNodes();
    }
  }
  fit() {
    if (this.dead) return;
    this.pendingFit = true;
    this.pendingFocus = undefined;
    this.events.dismiss();
    this.fulfillCamera();
  }
  focus(id: string) {
    if (this.dead) return;
    this.pendingFocus = id;
    this.events.dismiss();
    this.fulfillCamera();
  }
  private frameNodes(id?: string) {
    if (id && !this.positions.has(id)) return;
    const neighbors = new Set([id]);
    for (const l of this.links) {
      if (l.source === id) neighbors.add(l.target);
      if (l.target === id) neighbors.add(l.source);
    }
    const nodes = this.nodes
      .filter((n) => !id || neighbors.has(n.id))
      .map((n) => ({ ...n, ...this.positions.get(n.id) }));
    const pose = frameCamera(nodes, {
      dimensions: this.dimensions,
      position: this.camera.position,
      orbitTarget: this.controls.target,
      up: this.camera.up,
      fov: this.camera.fov,
      width: this.width,
      height: this.height,
      padding: Math.min(46, this.height * 0.2),
      topInset: this.inset + 24,
      target: id ? this.positions.get(id) : undefined,
    });
    if (pose) {
      this.restoreCamera({ ...pose, up: point(this.camera.up) });
      this.lastFrame = { id };
      this.schedule();
    }
  }
  private project(p: Position) {
    return new Vector3(p.x, p.y, this.dimensions === 2 ? 0 : p.z).project(this.camera);
  }
  private pick(x: number, y: number): GraphHit | undefined {
    if (this.lost || this.pending || !this.width || !this.height) return;
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(
      new Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2),
      this.camera,
    );
    const hits = this.raycaster.intersectObjects(
      this.batches.map((b) => b.mesh),
      false,
    );
    if (hits.length) {
      const h = hits[0],
        b = this.batches.find((b) => b.mesh === h.object)!;
      return { type: 'node', id: b.nodes[h.instanceId!].id };
    }
    let best = 25,
      hit: GraphHit | undefined;
    for (const l of this.links) {
      const a = this.project(this.positions.get(l.source)!),
        b = this.project(this.positions.get(l.target)!);
      if (Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue;
      const ax = rect.left + ((a.x + 1) * rect.width) / 2,
        ay = rect.top + ((1 - a.y) * rect.height) / 2,
        dx = ((b.x - a.x) * rect.width) / 2,
        dy = ((a.y - b.y) * rect.height) / 2;
      const t = Math.max(
        0,
        Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)),
      );
      const distance = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (distance < best) {
        best = distance;
        hit = { type: 'link', id: l.id };
      }
    }
    return hit;
  }
  private placeLabels() {
    const candidates = this.nodes
      .map((n) => {
        const p = this.positions.get(n.id);
        if (!p) return undefined;
        const world = new Vector3(p.x, p.y, this.dimensions === 2 ? 0 : p.z);
        const view = world.clone().applyMatrix4(this.camera.matrixWorldInverse);
        const projected = world.project(this.camera);
        return {
          n,
          p: projected,
          radius:
            (n.radius * this.height) /
            (2 * Math.tan((this.camera.fov * Math.PI) / 360) * Math.max(0.1, -view.z)),
        };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v) && Math.abs(v!.p.z) <= 1)
      .sort(
        (a, b) =>
          Number(b.n.selected) - Number(a.n.selected) ||
          Number(b.n.id === this.hovered) - Number(a.n.id === this.hovered) ||
          Number(b.n.highlight) - Number(a.n.highlight) ||
          Number(b.n.shape === 'box') - Number(a.n.shape === 'box') ||
          b.radius - a.radius,
      );
    let count = 0;
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const append = (
      text: string,
      x: number,
      y: number,
      w: number,
      h: number,
      className: string,
      color: string,
    ) => {
      const el = this.labelPool[count] ?? document.createElement('span');
      if (!this.labelPool[count]) {
        this.labelPool.push(el);
        this.labels.append(el);
      }
      count++;
      el.hidden = false;
      if (el.textContent !== text) el.textContent = text;
      el.className = className;
      el.style.transform = `translate(${x}px,${y}px)`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.setProperty('--node-tint', color);
    };
    // Selection brackets and restrained glow remain visible even with all text off.
    for (const { n, p, radius } of candidates) {
      if (!n.selected && !n.highlight && n.id !== this.hovered) continue;
      const r = Math.max(7, radius * 1.5 + 3);
      append(
        '',
        ((p.x + 1) * this.width) / 2 - r,
        ((1 - p.y) * this.height) / 2 - r,
        r * 2,
        r * 2,
        `flow-node-ring${n.selected ? ' selected' : ''}${n.highlight ? ' glow' : ''}`,
        n.color,
      );
    }
    let captions = 0;
    const repeats = new Set<string>();
    for (const { n, p, radius } of candidates) {
      if (captions >= 48) break;
      if (!n.text) continue;
      if (!n.selected && n.id !== this.hovered && repeats.has(n.text)) continue;
      const priority = n.selected || n.id === this.hovered || n.highlight;
      if (!priority && radius < 2.2 && n.shape !== 'box') continue;
      const lines = n.text
        .split('\n')
        .slice(0, 2)
        .map((t) => ([...t].length > 36 ? [...t].slice(0, 35).join('') + '…' : t));
      const text = lines.join('\n'),
        w = Math.min(238, Math.max(...lines.map((t) => t.length)) * 6.3 + 14),
        h = lines.length * 16 + 6;
      let x = ((p.x + 1) * this.width) / 2 + Math.max(8, radius * 1.5 + 4),
        y = ((1 - p.y) * this.height) / 2 - h / 2;
      if (x + w > this.width - 8)
        x = ((p.x + 1) * this.width) / 2 - Math.max(8, radius * 1.5 + 4) - w;
      if (priority) {
        x = Math.max(8, Math.min(x, this.width - w - 8));
        y = Math.max(this.inset + 4, Math.min(y, this.height - h - 8));
      }
      if (x < 4 || x + w > this.width - 4 || y < this.inset + 4 || y + h > this.height - 8)
        continue;
      if (
        boxes.some(
          (b) => x < b.x + b.w + 6 && x + w + 6 > b.x && y < b.y + b.h + 4 && y + h + 4 > b.y,
        )
      )
        continue;
      boxes.push({ x, y, w, h });
      append(text, x, y, w, h, `flow-node-caption${n.selected ? ' selected' : ''}`, n.color);
      repeats.add(n.text);
      captions++;
    }
    for (let i = count; i < this.labelPool.length; i++) this.labelPool[i].hidden = true;
  }
  dispose() {
    if (this.dead) return;
    this.flushSnapshot();
    this.dead = true;
    this.cancelQuiet();
    clearTimeout(this.recovery);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.pickRaf);
    this.worker?.terminate();
    this.controls.dispose();
    this.cleanups.forEach((fn) => fn());
    this.batches.forEach(({ mesh }) => mesh.dispose());
    Object.values(this.geometries).forEach((g) => g.dispose());
    this.material.dispose();
    this.edges.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.remove();
    this.modes.clear();
    this.cache.clear();
    this.positions.clear();
    this.setActive(false);
  }
}
