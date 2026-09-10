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
import { LayoutScheduler } from './layoutScheduler';
import { makeFlowEdges } from './flowEdges';
import { makeFlowParticles } from './flowParticles';
import { chooseFlowLinks, indexFlowLinks } from './flowSelection';
import { makeEdgePickIndex } from './flowEdgePicking';
import { createNodePickMesh, intersectNodes, syncNodePickMesh } from './nodePicking';
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
  private particles = makeFlowParticles();
  private flowIndex = indexFlowLinks([]);
  private flowNodes = new Map<string, RenderNode>();
  private flowSelected: string[] = [];
  private particleCount = 0;
  private motion = true;
  private particleRaf = 0;
  private particleTime?: number;
  private renderedTime?: number;
  private edgePick?: ReturnType<typeof makeEdgePickIndex>;
  private geometries = {
    box: new BoxGeometry(1.6, 1.6, 1.6),
    sphere: new SphereGeometry(1, 16, 12),
    octahedron: new OctahedronGeometry(1.4),
  };
  private material = new MeshLambertMaterial();
  private batches: {
    mesh: InstancedMesh<BufferGeometry, MeshLambertMaterial>;
    pickMesh: InstancedMesh;
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
  private layouts: LayoutScheduler;
  private requestedFrame?: GraphFrame;
  private displayedNodes: RenderNode[] = [];
  private displayedLinks: RenderLink[] = [];
  private displayedDimensions: 2 | 3 = 3;
  private pending?: LayoutRequest;
  private dimensions: 2 | 3 = 3;
  private modes = new Map<
    number,
    { positions: Map<string, Position>; camera: GraphSnapshot['camera'] }
  >();
  private width = 0;
  private height = 0;
  private inset = 0;
  private rightInset = 0;
  private firstFit = true;
  private pendingFit = false;
  private pendingFocus?: string;
  private lastFrame?: { id?: string };
  private selectedOutpoint?: string;
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
  private hoveredLink?: string;
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
    this.controls.enableDamping = this.motion;
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
    this.scene.add(new AmbientLight(0xffffff, 1.8), light, this.edges.mesh, this.particles.mesh);
    this.layouts = new LayoutScheduler(
      () => new Worker(new URL('./flowLayout.worker.ts', import.meta.url), { type: 'module' }),
      (result) => this.accept(result),
      (revision) => {
        if (this.dead || this.pending?.revision !== revision) return;
        const nodeCount = this.pending.nodes.length;
        this.pending = undefined;
        this.topology = '';
        this.nodes = this.displayedNodes;
        this.links = this.displayedLinks;
        this.canvas.setAttribute('aria-busy', 'false');
        this.events.layout?.({ busy: false, nodeCount, error: true });
        this.schedule();
      },
    );
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
        if (this.dead || this.lost || this.pointers.size) return;
        const hit = this.pick(e.clientX, e.clientY);
        const hovered = hit?.type === 'node' ? hit.id : undefined;
        const hoveredLink = hit?.type === 'link' ? hit.id : undefined;
        if (this.hovered !== hovered || this.hoveredLink !== hoveredLink) {
          this.hovered = hovered;
          this.hoveredLink = hoveredLink;
          this.refreshParticles();
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
      this.hoveredLink = undefined;
      this.refreshParticles();
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
      this.syncMotion();
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
      this.refresh(true);
      this.events.recovered?.();
      this.schedule();
    }) as EventListener);
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.cleanups.push(() =>
      document.removeEventListener('visibilitychange', this.visibilityChanged),
    );
  }
  private visibilityChanged = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.syncMotion();
    this.invalidate();
  };
  private refreshParticles() {
    this.particleCount = this.particles.update(
      chooseFlowLinks(
        this.flowIndex,
        this.flowSelected,
        this.hovered,
        this.hoveredLink,
        this.positions,
        this.displayedDimensions,
      ),
      this.flowNodes,
      this.positions,
      this.displayedDimensions,
    );
    this.syncMotion();
  }
  private canAnimate() {
    return (
      !this.dead &&
      !this.lost &&
      !document.hidden &&
      this.width > 0 &&
      this.height > 0 &&
      this.motion &&
      this.particleCount > 0
    );
  }
  private syncMotion() {
    this.particles.mesh.visible = this.canAnimate();
    if (!this.canAnimate()) {
      cancelAnimationFrame(this.particleRaf);
      this.particleRaf = 0;
      this.particleTime = undefined;
    } else if (!this.particleRaf) this.particleRaf = requestAnimationFrame(this.animateParticles);
  }
  private animateParticles = (time: number) => {
    this.particleRaf = 0;
    if (!this.canAnimate()) {
      this.particleTime = undefined;
      return;
    }
    if (this.particleTime !== undefined) this.particles.advance((time - this.particleTime) / 1000);
    this.particleTime = time;
    // Camera/style rendering already queued for this frame will draw the updated
    // phase. Pure flow frames never update controls, labels or persistence activity.
    if (!this.raf && this.renderedTime !== time) {
      this.renderer.render(this.scene, this.camera);
      this.renderedTime = time;
    }
    this.particleRaf = requestAnimationFrame(this.animateParticles);
  };
  setMotion = (enabled: boolean) => {
    if (this.dead || this.motion === enabled) return;
    if (!enabled) this.stopDamping();
    this.motion = enabled;
    this.controls.enableDamping = enabled;
    this.syncMotion();
    this.invalidate();
  };
  private pointer(e: PointerEvent) {
    const r = this.container.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      pointerType: e.pointerType,
      modifiers: { ctrl: Boolean(e.ctrlKey), meta: Boolean(e.metaKey), shift: Boolean(e.shiftKey) },
    };
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
    this.hoveredLink = undefined;
    this.refreshParticles();
    cancelAnimationFrame(this.pickRaf);
    this.events.dismiss();
    this.setActive(true);
    this.invalidate();
    this.schedule();
  };
  private changed = () => {
    if (this.dead || this.lost) return;
    this.edgePick = undefined;
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
    if (this.raf || this.dead || this.lost || document.hidden || !this.width || !this.height)
      return;
    this.raf = requestAnimationFrame((time) => {
      this.raf = 0;
      if (this.dead || this.lost || document.hidden || !this.width || !this.height) return;
      const moving = this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.renderedTime = time;
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
    // Persist the view actually on screen, even while its replacement is computing.
    // Lock/export must never run an unfinished force simulation on the UI thread.
    this.cancelQuiet();
    const dimensions = this.positions.size ? this.displayedDimensions : this.dimensions;
    if (!this.snapshotNodes) {
      this.snapshotNodes = [...this.positions].map(([id, p]) =>
        Object.freeze({ id, ...p, z: dimensions === 2 ? 0 : p.z }),
      );
      Object.freeze(this.snapshotNodes);
    }
    const camera = this.cameraRecord();
    const signature = JSON.stringify([dimensions, camera, this.revision]);
    if (signature !== this.snapshotSignature) {
      this.events.snapshot?.({
        version: 1,
        dimensions,
        camera,
        nodes: this.snapshotNodes,
      });
      this.snapshotSignature = signature;
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
    this.edgePick = undefined;
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
    this.hoveredLink = undefined;
    this.refreshParticles();
    this.update({
      nodes: this.requestedFrame?.nodes ?? this.nodes,
      links: this.requestedFrame?.links ?? this.links,
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
  update(frame: GraphFrame) {
    if (this.dead) return;
    const selected = frame.nodes.find((node) => node.selected);
    if (selected?.shape === 'sphere') this.selectedOutpoint = selected.id;
    else if (selected && this.cache.has(selected.id)) this.selectedOutpoint = undefined;
    this.requestedFrame = frame;
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
      this.nodes.map((n) => [n.id, n.shape, n.fx ?? n.x, n.fy ?? n.y, n.fz ?? n.z]),
      this.links.map((l) => [l.source, l.target, l.directed]),
    ]);
    if (signature === this.topology) {
      this.refresh();
      this.schedule();
      return;
    }
    this.topology = signature;
    // A completed Fit/focus described the previous graph. Later UI reflow must
    // not turn that old framing into an implicit Fit of newly added branches.
    // Explicit pending camera requests remain owned by fulfillCamera().
    if (this.positions.size) this.lastFrame = undefined;
    const anchorId = selected?.shape === 'sphere' ? selected.id : this.selectedOutpoint;
    const attached = new Set<string>();
    if (selected && anchorId && this.cache.has(anchorId))
      for (const link of this.links) {
        if (!link.directed) continue;
        if (link.source === anchorId) attached.add(link.target);
        if (link.target === anchorId) attached.add(link.source);
      }
    const opened =
      selected && attached.size
        ? this.nodes.filter(
            (node) =>
              node.shape === 'box' &&
              !this.cache.has(node.id) &&
              (selected.shape === 'sphere' || selected.id === node.id) &&
              attached.has(node.id),
          )
        : [];
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
      links: this.links.map(({ source, target, directed }) => ({ source, target, directed })),
      previous: [...this.cache],
      expansionOrigin:
        opened.length === 1 && anchorId ? { nodeId: opened[0].id, anchorId } : undefined,
    };
    this.pending = request;
    this.canvas.setAttribute('aria-busy', 'true');
    this.events.layout?.({ busy: true, nodeCount: request.nodes.length });
    this.layouts.request(request);
  }
  private accept(result: LayoutResult) {
    if (this.dead || !this.pending || result.revision !== this.revision) return;
    this.pending = undefined;
    this.positions = new Map(result.positions);
    this.displayedDimensions = this.dimensions;
    this.snapshotNodes = undefined;
    // A pending checkpoint may have saved old geometry with this request's revision.
    this.snapshotSignature = '';
    for (const [id, p] of result.positions) {
      this.cache.delete(id);
      this.cache.set(id, p);
    }
    while (this.cache.size > GRAPH_SNAPSHOT_NODE_LIMIT)
      this.cache.delete(this.cache.keys().next().value!);
    this.batches = shapes.map((shape, index) => {
      const nodes = this.nodes.filter((n) => n.shape === shape);
      let mesh = this.batches[index]?.mesh;
      let pickMesh = this.batches[index]?.pickMesh;
      const capacity = mesh?.instanceMatrix.count ?? 0;
      if (!mesh || nodes.length > capacity || (capacity > 4 && nodes.length < capacity / 4)) {
        if (mesh) {
          this.scene.remove(mesh);
          mesh.dispose();
          pickMesh?.geometry.dispose();
          pickMesh?.dispose();
        }
        const size = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, nodes.length))));
        mesh = new InstancedMesh(this.geometries[shape], this.material, size);
        pickMesh = createNodePickMesh(mesh);
        this.scene.add(mesh);
      }
      mesh.count = nodes.length;
      return { mesh, pickMesh: pickMesh!, nodes };
    });
    this.refresh(true);
    this.fulfillCamera();
    this.canvas.setAttribute('aria-busy', 'false');
    this.events.layout?.({ busy: false, nodeCount: this.nodes.length });
    this.schedule();
  }
  private refresh(geometryChanged = false) {
    if (this.pending) return;
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const matrix = new Matrix4();
    const tint = new Color();
    let radiiChanged = false;
    for (const batch of this.batches) {
      let matricesChanged = geometryChanged,
        colorsChanged = geometryChanged;
      batch.nodes = batch.nodes.map((before, i) => {
        const n = byId.get(before.id)!;
        if (geometryChanged || n.radius !== before.radius) {
          const p = this.positions.get(n.id)!;
          matrix
            .makeScale(n.radius, n.radius, n.radius)
            .setPosition(p.x, p.y, this.dimensions === 2 ? 0 : p.z);
          batch.mesh.setMatrixAt(i, matrix);
          matricesChanged = true;
          radiiChanged ||= n.radius !== before.radius;
        }
        if (geometryChanged || n.color !== before.color) {
          batch.mesh.setColorAt(i, tint.set(n.color));
          colorsChanged = true;
        }
        return n;
      });
      if (matricesChanged) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.mesh.computeBoundingSphere();
        syncNodePickMesh(batch.mesh, batch.pickMesh);
      }
      if (colorsChanged && batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
    }
    // Selection and captions often change without changing any edge geometry or style.
    const edgesChanged =
      geometryChanged ||
      radiiChanged ||
      this.links.length !== this.displayedLinks.length ||
      this.links.some((link, i) => {
        const before = this.displayedLinks[i];
        return (
          link.id !== before.id ||
          link.source !== before.source ||
          link.target !== before.target ||
          link.directed !== before.directed ||
          link.flowSide !== before.flowSide ||
          link.color !== before.color ||
          link.width !== before.width ||
          link.arrowLength !== before.arrowLength
        );
      });
    if (edgesChanged) {
      this.edges.update(this.links, byId, this.positions, this.dimensions);
      this.flowIndex = indexFlowLinks(this.links);
      this.edgePick = undefined;
    }
    this.displayedNodes = this.nodes;
    this.displayedLinks = this.links;
    this.flowNodes = byId;
    this.flowSelected = this.nodes
      .filter((node) => node.selected || node.flowActive)
      .map((node) => node.id);
    if (this.hovered && !byId.has(this.hovered)) this.hovered = undefined;
    if (this.hoveredLink && !this.links.some((link) => link.id === this.hoveredLink))
      this.hoveredLink = undefined;
    this.refreshParticles();
    this.invalidate();
  }
  resize(width: number, height: number, topInset = 0, rightInset = 0) {
    if (this.dead) return;
    const viewportChanged = this.width !== width || this.height !== height;
    const changed = viewportChanged || this.inset !== topInset || this.rightInset !== rightInset;
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.inset = topInset;
    this.rightInset = rightInset;
    if (changed) this.edgePick = undefined;
    this.syncMotion();
    if (!width || !height) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.renderer.setSize(width, height);
    this.edges.resize(width, height);
    this.particles.resize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Toolbar content can change when a transaction is opened. Retain the
    // current camera; updated overlay allowances apply to the next explicit Fit.
    if (viewportChanged && this.lastFrame && !this.pointers.size)
      this.frameNodes(this.lastFrame.id);
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
      rightInset: this.rightInset,
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
  private pick(x: number, y: number, includeLinks = true): GraphHit | undefined {
    if (this.lost || this.pending || !this.width || !this.height) return;
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(
      new Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2),
      this.camera,
    );
    const h = intersectNodes(this.raycaster, this.batches);
    if (h) {
      const b = this.batches.find((b) => b.mesh === h.object || b.pickMesh === h.object)!;
      return { type: 'node', id: b.nodes[h.instanceId!].id };
    }
    if (!includeLinks) return;
    if (!this.edgePick) {
      const projected = new Map<string, { x: number; y: number; z: number }>();
      for (const [id, point] of this.positions) {
        const p = this.project(point);
        projected.set(id, {
          x: ((p.x + 1) * rect.width) / 2,
          y: ((1 - p.y) * rect.height) / 2,
          z: p.z,
        });
      }
      this.edgePick = makeEdgePickIndex(this.links, projected, rect.width, rect.height);
    }
    const id = this.edgePick(x - rect.left, y - rect.top);
    return id ? { type: 'link', id } : undefined;
  }

  private placeLabels() {
    const candidates = this.nodes
      .map((n) => {
        if (!n.text && !n.selected && !n.highlight && !n.marker && n.id !== this.hovered)
          return undefined;
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
      .filter(
        (v): v is NonNullable<typeof v> =>
          Boolean(v) && Math.abs(v!.p.z) <= 1 && Math.abs(v!.p.x) <= 1.1 && Math.abs(v!.p.y) <= 1.1,
      )
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
    // Role markers are appearance only. They never change mesh size, picking or placement.
    for (const { n, p, radius } of candidates) {
      if (!n.marker || (radius < 3 && !n.selected && n.id !== this.hovered)) continue;
      const r = Math.max(4, radius + 1.5);
      append(
        '',
        ((p.x + 1) * this.width) / 2 - r,
        ((1 - p.y) * this.height) / 2 - r,
        r * 2,
        r * 2,
        `flow-node-marker flow-marker-${n.marker.shape}${n.selected || n.id === this.hovered ? ' active' : ''}`,
        n.marker.color,
      );
    }
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
    this.syncMotion();
    this.cancelQuiet();
    clearTimeout(this.recovery);
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.pickRaf);
    this.layouts.dispose();
    this.controls.dispose();
    this.cleanups.forEach((fn) => fn());
    this.batches.forEach(({ mesh, pickMesh }) => {
      mesh.dispose();
      pickMesh.geometry.dispose();
      pickMesh.dispose();
    });
    Object.values(this.geometries).forEach((g) => g.dispose());
    this.material.dispose();
    this.edges.dispose();
    this.particles.dispose();
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
