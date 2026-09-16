import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from '3d-force-graph';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  MOUSE,
  OctahedronGeometry,
  Points,
  type PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TOUCH,
} from 'three';
import { frameCamera, nodeBoundsRadius } from './cameraFraming';
import type {
  GraphAdapterFactory,
  GraphFrame,
  RenderNode,
  RenderLink,
  GraphHit,
  GraphPointer,
} from './adapter';
import {
  GRAPH_SNAPSHOT_NODE_LIMIT,
  graphSnapshotSchema,
  type GraphSnapshot,
} from '../../../GraphState/graphSnapshot';

// One draw call for all halos; the ordinary node meshes retain graph picking.
function makeHalos() {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { viewportScale: { value: 500 } },
    vertexShader: `attribute vec3 haloColor; attribute float haloSize;
      uniform float viewportScale; varying vec3 color;
      void main() { color = haloColor;
        vec4 pos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(haloSize * viewportScale / max(1.0, -pos.z), 1.0, 160.0);
        gl_Position = projectionMatrix * pos; }`,
    fragmentShader: `varying vec3 color;
      void main() { float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (radius > 1.0) discard;
        float alpha = pow(1.0 - radius, 2.0) * 0.65;
        gl_FragColor = vec4(color, alpha); }`,
  });
  const points = new Points(new BufferGeometry(), material);
  points.frustumCulled = false;
  points.raycast = () => {};
  return points;
}

type SimNode = RenderNode & NodeObject;
type SimLink = Omit<RenderLink, 'source' | 'target'> & {
  source: string | SimNode;
  target: string | SimNode;
};
type Graph = ForceGraph3DInstance<SimNode, SimLink>;
const GraphConstructor = ForceGraph3D as unknown as new (
  element: HTMLElement,
  options: { controlType: 'orbit' },
) => Graph;
const duration = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);

export const createForceAdapter: GraphAdapterFactory = (element, events) => {
  const graph = new GraphConstructor(element, { controlType: 'orbit' });
  const canvas = graph.renderer().domElement;
  const geometries = {
    box: new BoxGeometry(1.6, 1.6, 1.6),
    sphere: new SphereGeometry(1, 8, 8),
    octahedron: new OctahedronGeometry(1.4),
  };
  const materials = new Map<string, MeshLambertMaterial>();
  const meshes = new Map<string, Mesh<BufferGeometry, MeshLambertMaterial>>();
  const savedDepth = new Map<string, number>();
  // Textures are shared for repeated tags/labels and released when their last node disappears.
  const textMaterials = new Map<
    string,
    { material: SpriteMaterial; width: number; height: number }
  >();
  const nodeText = new Map<string, { sprite: Sprite; text: string }>();
  const halos = makeHalos();
  let haloNodes: SimNode[] = [];
  let topology = '';
  let dimensions: 2 | 3 | undefined;
  let needsFit = true;
  let visible = false;
  let fitPadding = 40;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let navigationInset = 0;
  let lastFraming: { nodeId?: string; preserveZoom?: boolean } | undefined;
  let settled = false;
  let earlyFitPending = false;
  let earlyFitTicks = 0;
  let pendingFocus: { id: string; preserveZoom?: boolean } | undefined;
  let dead = false;
  let initialSnapshot: GraphSnapshot | undefined;
  const retainedPositions = new Map<string, GraphSnapshot['nodes'][number]>();
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSnapshot = '';
  let idleSnapshot: number | undefined;
  let interactionActive = false;
  let positionsDirty = true;
  let cachedPositions: GraphSnapshot['nodes'] | undefined;
  let layoutRevision = 0;
  let hit: GraphHit | undefined;
  let point: GraphPointer = { x: 0, y: 0, pointerType: 'mouse' };
  const pointers = new Set<number>();
  let down: { id: number; x: number; y: number } | undefined;
  let selectable = false;
  const raycaster = new Raycaster();
  const cleanups: (() => void)[] = [];
  const cancelSnapshot = () => {
    clearTimeout(snapshotTimer);
    if (idleSnapshot !== undefined) window.cancelIdleCallback?.(idleSnapshot);
    idleSnapshot = undefined;
  };
  const setActivity = (active: boolean) => {
    if (interactionActive === active) return;
    interactionActive = active;
    events.activity?.(active);
  };
  const beginInteraction = () => {
    if (dead) return;
    pendingFocus = undefined;
    lastFraming = undefined;
    needsFit = false;
    earlyFitPending = false;
    cancelSnapshot();
    if (!interactionActive) events.dismiss();
    setActivity(true);
  };
  const emitSnapshot = () => {
    cancelSnapshot();
    // Explicit flush can capture a manual view before layout settlement. Ordinary
    // gestures wait for quiet time; initial automatic framing still waits to settle.
    if (dead || (!settled && needsFit) || !dimensions || !events.snapshot) return;
    const data = graph.graphData().nodes;
    if (!data.length) return;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const point = (value: { x: number; y: number; z: number }) => ({
      x: round(value.x),
      y: round(value.y),
      z: round(value.z),
    });
    const controls = graph.controls() as { target: Vector3 };
    const camera = graphSnapshotSchema.shape.camera.safeParse({
      position: point(graph.cameraPosition()),
      target: point(controls.target),
      up: point(graph.camera().up),
    });
    if (!camera.success) return;
    if (positionsDirty || !cachedPositions) {
      const positions = graphSnapshotSchema.shape.nodes.safeParse(
        data
          .map((node) => ({
            id: node.id,
            ...point({ x: node.x!, y: node.y!, z: dimensions === 2 ? 0 : node.z! }),
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      if (!positions.success) return;
      cachedPositions = positions.data;
      // Frozen node records can safely share identity across camera-only updates.
      cachedPositions.forEach(Object.freeze);
      Object.freeze(cachedPositions);
      positionsDirty = false;
      layoutRevision++;
      for (const node of cachedPositions) retainedPositions.set(node.id, node);
      while (retainedPositions.size > GRAPH_SNAPSHOT_NODE_LIMIT)
        retainedPositions.delete(retainedPositions.keys().next().value!);
    }
    const signature = JSON.stringify([dimensions, camera.data, layoutRevision]);
    if (signature === lastSnapshot) return;
    lastSnapshot = signature;
    events.snapshot({ version: 1, dimensions, camera: camera.data, nodes: cachedPositions });
  };
  const flushSnapshot = () => {
    // An explicit checkpoint captures the current geometry even before settlement.
    positionsDirty = true;
    try {
      emitSnapshot();
    } finally {
      if (!pointers.size) setActivity(false);
    }
  };
  const scheduleSnapshot = () => {
    if (dead) return;
    cancelSnapshot();
    snapshotTimer = setTimeout(() => {
      if (dead || pointers.size) return;
      const publish = () => {
        idleSnapshot = undefined;
        if (dead || pointers.size) return;
        try {
          emitSnapshot();
        } finally {
          setActivity(false);
        }
      };
      if (window.requestIdleCallback)
        idleSnapshot = window.requestIdleCallback(publish, { timeout: 2000 });
      else snapshotTimer = setTimeout(publish, 0);
    }, 1200);
  };
  const listen = <K extends keyof (HTMLElementEventMap & { webglcontextlost: Event })>(
    name: K,
    fn: (event: (HTMLElementEventMap & { webglcontextlost: Event })[K]) => void,
  ) => {
    canvas.addEventListener(name, fn as EventListener);
    cleanups.push(() => canvas.removeEventListener(name, fn as EventListener));
  };
  const materialFor = (color: string) => {
    let material = materials.get(color);
    if (!material) {
      material = new MeshLambertMaterial({ color });
      materials.set(color, material);
    }
    return material;
  };
  const textMaterialFor = (text: string) => {
    const cached = textMaterials.get(text);
    if (cached) return cached;
    const surface = document.createElement('canvas');
    const context = surface.getContext('2d');
    if (!context) return undefined;
    const lines = text
      .split('\n')
      .slice(0, 2)
      .map((line) => {
        const points = [...line];
        return points.length > 54 ? `${points.slice(0, 53).join('')}…` : line;
      });
    context.font = '500 22px sans-serif';
    const width = Math.min(
      640,
      Math.ceil(Math.max(...lines.map((line) => context.measureText(line).width))) + 20,
    );
    surface.width = width;
    surface.height = lines.length * 30 + 12;
    context.font = '500 22px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // A small opaque backing keeps the caption legible over crossing links.
    context.fillStyle = '#111a20e8';
    context.beginPath();
    context.roundRect(0, 0, width, surface.height, 8);
    context.fill();
    lines.forEach((line, index) => {
      context.fillStyle = index === 0 ? '#e7eeeb' : '#aabbb6';
      context.fillText(line, width / 2, 21 + index * 30, width - 16);
    });
    const texture = new CanvasTexture(surface);
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    const material = new SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const entry = { material, width: width / 5, height: surface.height / 5 };
    textMaterials.set(text, entry);
    return entry;
  };
  const updateMesh = (mesh: Mesh<BufferGeometry, MeshLambertMaterial>, node: SimNode) => {
    mesh.geometry = geometries[node.shape];
    mesh.material = materialFor(node.color);
    mesh.scale.setScalar(node.radius);
    const existing = nodeText.get(node.id);
    if (existing && (existing.text !== node.text || existing.sprite.parent !== mesh)) {
      existing.sprite.removeFromParent();
      nodeText.delete(node.id);
    }
    if (!node.text) return;
    let caption = nodeText.get(node.id);
    if (!caption) {
      const resource = textMaterialFor(node.text);
      if (!resource) return;
      const sprite = new Sprite(resource.material);
      // Caption pixels are visual only. Only the node's geometric body is selectable.
      sprite.raycast = () => {};
      mesh.add(sprite);
      caption = { sprite, text: node.text };
      nodeText.set(node.id, caption);
    }
    const resource = textMaterials.get(node.text)!;
    caption.sprite.scale.set(resource.width / node.radius, resource.height / node.radius, 1);
    caption.sprite.position.set(0, 1.7 + resource.height / node.radius / 2, 0);
  };
  const positionHalos = () => {
    const positions = halos.geometry.getAttribute('position');
    if (!positions) return;
    haloNodes.forEach((node, index) =>
      positions.setXYZ(index, node.x || 0, node.y || 0, node.z || 0),
    );
    positions.needsUpdate = true;
  };
  const frameNodes = (
    nodes: readonly SimNode[],
    transition: number,
    target?: { x: number; y: number; z: number },
    focusId?: string,
    preserveZoom?: boolean,
  ) => {
    if (!dimensions) return;
    const camera = graph.camera() as PerspectiveCamera;
    const pose = frameCamera(nodes, {
      dimensions,
      position: graph.cameraPosition(),
      orbitTarget: (graph.controls() as { target: Vector3 }).target,
      up: camera.up,
      fov: camera.getEffectiveFOV(),
      width: viewportWidth,
      height: viewportHeight,
      padding: Math.max(fitPadding, Math.min(60, viewportHeight * 0.16)),
      topInset: navigationInset,
      captions: new Map(
        nodes.flatMap((node) => {
          const resource = node.text ? textMaterials.get(node.text) : undefined;
          return resource
            ? [
                [
                  node.id,
                  {
                    width: resource.width,
                    height: resource.height,
                    offsetY: 1.7 * node.radius + resource.height / 2,
                  },
                ] as const,
              ]
            : [];
        }),
      ),
      target,
      preserveZoom,
    });
    if (pose) {
      graph.cameraPosition(pose.position, pose.target, transition);
      lastFraming = { nodeId: focusId, preserveZoom };
    }
  };
  const tryEarlyFit = () => {
    if (dead || !earlyFitPending || earlyFitTicks > 0 || !needsFit || !visible) return;
    const nodes = graph.graphData().nodes;
    if (
      !nodes.length ||
      nodes.some(
        (node) =>
          !Number.isFinite(node.x) ||
          !Number.isFinite(node.y) ||
          (dimensions === 3 && !Number.isFinite(node.z)),
      )
    )
      return;
    earlyFitPending = false;
    // Give new graphs a useful frame after three simulation ticks. Keep needsFit
    // until settlement, unless a gesture or explicit focus takes over the camera.
    frameNodes(graph.graphData().nodes, 0);
  };
  const refreshStyle = () => {
    const nodes = graph.graphData().nodes;
    const ids = new Set(nodes.map((node) => node.id));
    for (const id of meshes.keys())
      if (!ids.has(id)) {
        nodeText.get(id)?.sprite.removeFromParent();
        nodeText.delete(id);
        meshes.delete(id);
      }
    for (const node of nodes) {
      const mesh = meshes.get(node.id);
      if (mesh) updateMesh(mesh, node);
    }
    graph
      .linkColor((link) => link.color)
      .linkWidth((link) => link.width)
      .linkDirectionalArrowLength((link) => link.arrowLength);
    haloNodes = nodes.filter((node) => node.highlight);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(haloNodes.length * 3), 3),
    );
    const colors = new Float32Array(haloNodes.length * 3);
    const sizes = new Float32Array(haloNodes.length);
    const tint = new Color();
    haloNodes.forEach((node, index) => {
      tint.set(node.color).toArray(colors, index * 3);
      sizes[index] = (20 * node.radius) / 3.2;
    });
    geometry.setAttribute('haloColor', new BufferAttribute(colors, 3));
    geometry.setAttribute('haloSize', new BufferAttribute(sizes, 1));
    halos.geometry.dispose();
    halos.geometry = geometry;
    positionHalos();
    const usedTexts = new Set(nodes.map((node) => node.text));
    for (const [text, resource] of textMaterials)
      if (!usedTexts.has(text)) {
        resource.material.map?.dispose();
        resource.material.dispose();
        textMaterials.delete(text);
      }
    const usedColors = new Set(nodes.map((node) => node.color));
    for (const [color, material] of materials)
      if (!usedColors.has(color)) {
        material.dispose();
        materials.delete(color);
      }
  };
  const fit = () => {
    if (dead) return;
    // Keep a pending request while empty. Engine stop must not consume it.
    needsFit = true;
    pendingFocus = undefined;
    if (visible && graph.graphData().nodes.length) frameNodes(graph.graphData().nodes, duration());
    scheduleSnapshot();
  };
  const emitHover = () => {
    if (!dead && !pointers.size && point.pointerType !== 'touch')
      events.hover({ hit: hit?.type === 'node' ? hit : undefined, point: { ...point } });
  };
  const pickTouch = (): GraphHit | undefined => {
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return undefined;
    graph.scene().updateMatrixWorld(true);
    raycaster.setFromCamera(
      new Vector2((point.x / width) * 2 - 1, 1 - (point.y / height) * 2),
      graph.camera(),
    );
    const picked = raycaster.intersectObjects([...meshes.values()], false)[0]?.object;
    if (picked) for (const [id, mesh] of meshes) if (mesh === picked) return { type: 'node', id };
    let closest: { id: string; distance: number } | undefined;
    for (const link of graph.graphData().links) {
      if (typeof link.source === 'string' || typeof link.target === 'string') continue;
      const a = new Vector3(link.source.x || 0, link.source.y || 0, link.source.z || 0).project(
        graph.camera(),
      );
      const b = new Vector3(link.target.x || 0, link.target.y || 0, link.target.z || 0).project(
        graph.camera(),
      );
      // Do not select a segment projected from behind the camera or beyond its clip planes.
      if (Math.abs(a.z) > 1 || Math.abs(b.z) > 1) continue;
      a.set(((a.x + 1) * width) / 2, ((1 - a.y) * height) / 2, 0);
      b.set(((b.x + 1) * width) / 2, ((1 - b.y) * height) / 2, 0);
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
      );
      const distance = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
      if (distance <= 5 && (!closest || distance < closest.distance))
        closest = { id: link.id, distance };
    }
    return closest ? { type: 'link', id: closest.id } : undefined;
  };
  const select = (selected?: GraphHit, event?: MouseEvent) => {
    if (dead || point.pointerType === 'touch' || (event && event.button !== 0)) return;
    if (!selectable) return;
    selectable = false;
    events.select({ hit: selected, point: { ...point } });
  };
  const dispose = () => {
    if (dead) return;
    // Deliver the final settled camera before releasing this workspace's adapter.
    flushSnapshot();
    setActivity(false);
    dead = true;
    cancelSnapshot();
    cleanups.forEach((cleanup) => cleanup());
    graph.scene().remove(halos);
    halos.geometry.dispose();
    halos.material.dispose();
    graph._destructor();
    Object.values(geometries).forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    materials.clear();
    meshes.clear();
    savedDepth.clear();
    for (const resource of textMaterials.values()) {
      resource.material.map?.dispose();
      resource.material.dispose();
    }
    textMaterials.clear();
    nodeText.clear();
    element.replaceChildren();
  };
  try {
    graph.scene().add(halos);
    graph
      .showNavInfo(false)
      .enableNodeDrag(false)
      .nodeRelSize(3.2)
      // Arrow placement still uses the engine's sphere bounds even with custom
      // meshes. Match their bounding radii so arrows do not end inside a whale.
      .nodeVal((node) => Math.pow(nodeBoundsRadius(node) / 3.2, 3))
      .nodeResolution(8)
      .nodeOpacity(0.95)
      .linkOpacity(0.46)
      .linkDirectionalArrowRelPos(0.7)
      // Every flow link has an arrow. Four sides keep dense graphs economical.
      .linkDirectionalArrowResolution(4)
      .cooldownTicks(120)
      .cooldownTime(6000)
      .d3AlphaDecay(0.035)
      .nodeThreeObject((node) => {
        const mesh = new Mesh(geometries[node.shape], materialFor(node.color));
        updateMesh(mesh, node);
        meshes.set(node.id, mesh);
        return mesh;
      })
      .nodeLabel('')
      .linkLabel('')
      .linkHoverPrecision(2)
      .onNodeHover((node) => {
        if (node) hit = { type: 'node', id: node.id };
        else if (hit?.type === 'node') hit = undefined;
        emitHover();
      })
      .onLinkHover((link) => {
        if (link) hit = undefined;
        emitHover();
      })
      .onNodeClick((node, event) => select({ type: 'node', id: node.id }, event))
      .onLinkClick((link, event) => select({ type: 'link', id: link.id }, event))
      .onBackgroundClick((event) => select(undefined, event))
      .onEngineTick(() => {
        positionsDirty = true;
        positionHalos();
        if (pendingFocus) focus(pendingFocus.id, pendingFocus);
        if (earlyFitTicks > 0) earlyFitTicks--;
        tryEarlyFit();
      })
      .onEngineStop(() => {
        if (dead) return;
        positionHalos();
        settled = true;
        if (pendingFocus) focus(pendingFocus.id, pendingFocus);
        earlyFitPending = false;
        if (visible && needsFit && graph.graphData().nodes.length) {
          needsFit = false;
          frameNodes(graph.graphData().nodes, duration());
        }
        scheduleSnapshot();
      });
    graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const orbit = graph.controls() as unknown as {
      zoomToCursor: boolean;
      screenSpacePanning: boolean;
      enableDamping: boolean;
      dampingFactor: number;
      addEventListener(type: string, listener: () => void): void;
      removeEventListener(type: string, listener: () => void): void;
    };
    orbit.zoomToCursor = true;
    orbit.screenSpacePanning = true;
    orbit.enableDamping = duration() !== 0;
    orbit.dampingFactor = 0.18;
    orbit.addEventListener('start', beginInteraction);
    orbit.addEventListener('change', scheduleSnapshot);
    orbit.addEventListener('end', scheduleSnapshot);
    cleanups.push(() => {
      orbit.removeEventListener('start', beginInteraction);
      orbit.removeEventListener('change', scheduleSnapshot);
      orbit.removeEventListener('end', scheduleSnapshot);
    });
    const track = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        pointerType: event.pointerType,
        modifiers: {
          ctrl: Boolean(event.ctrlKey),
          meta: Boolean(event.metaKey),
          shift: Boolean(event.shiftKey),
        },
      };
    };
    listen('pointerdown', (event) => {
      beginInteraction();
      track(event);
      needsFit = false;
      selectable = false;
      pointers.add(event.pointerId);
      down =
        pointers.size === 1
          ? { id: event.pointerId, x: event.clientX, y: event.clientY }
          : undefined;
      events.dismiss();
    });
    listen('pointermove', (event) => {
      track(event);
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down = undefined;
      emitHover();
    });
    listen('pointerup', (event) => {
      track(event);
      selectable = Boolean(
        down &&
        down.id === event.pointerId &&
        pointers.size === 1 &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 5,
      );
      pointers.delete(event.pointerId);
      scheduleSnapshot();
      down = undefined;
      // Forcegraph's asynchronous click callback can see the previous RAF pick
      // when touch-down/up occur between frames. Resolve taps at their coordinates.
      if (selectable && event.pointerType === 'touch') {
        selectable = false;
        events.select({ hit: pickTouch(), point: { ...point } });
      }
    });
    listen('pointercancel', (event) => {
      pointers.delete(event.pointerId);
      scheduleSnapshot();
      down = undefined;
      selectable = false;
      hit = undefined;
    });
    listen('pointerleave', () => {
      // Forcegraph retains its pick across canvas leave and can omit the next
      // hover callback when returning to that same object. Keep the stable hit.
      events.hover({ point: { ...point } });
    });
    listen('wheel', () => {
      beginInteraction();
      scheduleSnapshot();
      needsFit = false;
    });
    listen('webglcontextlost', (event) => {
      event.preventDefault();
      graph.pauseAnimation();
      events.error();
    });
  } catch (error) {
    dispose();
    throw error;
  }
  function focus(id: string, options?: { preserveZoom?: boolean }, transition = duration()) {
    if (dead) return;
    // An explicit request owns the next camera move even when its frame has not
    // arrived yet. Never substitute the origin for uninitialized coordinates.
    pendingFocus = { id, preserveZoom: options?.preserveZoom };
    needsFit = false;
    earlyFitPending = false;
    if (!visible) return;
    const node = graph.graphData().nodes.find((node) => node.id === id);
    if (
      !node ||
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y) ||
      (dimensions === 3 && !Number.isFinite(node.z))
    )
      return;
    pendingFocus = undefined;
    const target = { x: node.x!, y: node.y!, z: dimensions === 2 ? 0 : node.z! };
    const neighbors = new Set([id]);
    for (const link of graph.graphData().links) {
      const source = typeof link.source === 'string' ? link.source : link.source.id;
      const destination = typeof link.target === 'string' ? link.target : link.target.id;
      if (source === id) neighbors.add(destination);
      if (destination === id) neighbors.add(source);
    }
    frameNodes(
      graph.graphData().nodes.filter((item) => neighbors.has(item.id)),
      transition,
      target,
      id,
      options?.preserveZoom,
    );
    scheduleSnapshot();
  }
  return {
    canvas,
    flushSnapshot,
    restoreSnapshot(snapshot) {
      if (dead) return;
      const parsed = graphSnapshotSchema.safeParse(snapshot);
      if (!parsed.success) return;
      initialSnapshot = parsed.data;
      lastFraming = undefined;
      pendingFocus = undefined;
      earlyFitPending = false;
      for (const node of parsed.data.nodes) retainedPositions.set(node.id, node);
      needsFit = false;
    },
    update(frame: GraphFrame) {
      if (dead) return;
      if (initialSnapshot && initialSnapshot.dimensions !== frame.dimensions) {
        // The mode preference may have reached storage before its new layout settled.
        initialSnapshot = undefined;
        retainedPositions.clear();
        needsFit = true;
      }
      const previous = new Map(graph.graphData().nodes.map((node) => [node.id, node]));
      const nodes = frame.nodes.map((node): SimNode => {
        const existing = previous.get(node.id);
        if (!existing) {
          const position = retainedPositions.get(node.id);
          if (frame.dimensions === 2) savedDepth.set(node.id, node.z || 0);
          return { ...node, ...position, z: frame.dimensions === 2 ? 0 : (position?.z ?? node.z) };
        }
        const { x, y, z } = existing;
        return Object.assign(existing, node, { x, y, z, text: node.text });
      });
      const ids = new Set(nodes.map((node) => node.id));
      for (const id of savedDepth.keys()) if (!ids.has(id)) savedDepth.delete(id);
      const links = frame.links
        .filter((link) => ids.has(link.source) && ids.has(link.target))
        .map((link) => ({ ...link }));
      const signature = JSON.stringify([
        nodes.map((node) => node.id),
        links.map((link) => [link.id, link.source, link.target]),
      ]);
      if (signature !== topology) {
        const restoredLayout =
          !previous.size &&
          initialSnapshot?.dimensions === frame.dimensions &&
          nodes.every((node) => retainedPositions.has(node.id));
        if (!previous.size && nodes.length && !initialSnapshot && !pendingFocus) {
          needsFit = true;
          earlyFitPending = true;
          earlyFitTicks = 3;
        }
        topology = signature;
        positionsDirty = true;
        settled = false;
        graph.cooldownTicks(restoredLayout ? 0 : 120);
        graph.graphData({ nodes, links });
      } else {
        const styles = new Map(links.map((link) => [link.id, link]));
        for (const link of graph.graphData().links) {
          const style = styles.get(link.id)!;
          link.color = style.color;
          link.width = style.width;
          link.arrowLength = style.arrowLength;
        }
      }
      graph.backgroundColor(frame.background);
      if (dimensions !== frame.dimensions) {
        positionsDirty = true;
        if (dimensions !== undefined) {
          // Initial restoration suppresses simulation; subsequent mode changes must not.
          settled = false;
          graph.cooldownTicks(120);
        }
        dimensions = frame.dimensions;
        for (const node of nodes) {
          if (dimensions === 2) {
            if (!savedDepth.has(node.id)) savedDepth.set(node.id, node.z || 0);
            node.z = 0;
            node.vz = 0;
          } else if (savedDepth.has(node.id)) node.z = savedDepth.get(node.id);
        }
        if (dimensions === 3) savedDepth.clear();
        graph.numDimensions(dimensions);
        const controls = graph.controls() as {
          enableRotate: boolean;
          mouseButtons: { LEFT: MOUSE; MIDDLE: MOUSE; RIGHT: MOUSE };
          touches: { ONE: TOUCH; TWO: TOUCH };
        };
        controls.enableRotate = dimensions === 3;
        controls.mouseButtons = {
          LEFT: dimensions === 2 ? MOUSE.PAN : MOUSE.ROTATE,
          MIDDLE: MOUSE.DOLLY,
          RIGHT: MOUSE.PAN,
        };
        controls.touches = {
          ONE: dimensions === 2 ? TOUCH.PAN : TOUCH.ROTATE,
          TWO: TOUCH.DOLLY_PAN,
        };
        if (dimensions === 2 && initialSnapshot?.dimensions !== 2) {
          const camera = graph.cameraPosition();
          graph.camera().up.set(0, 1, 0);
          // No tween on an empty scene: a pending mode tween can overwrite first-data fit.
          graph.cameraPosition(
            { x: 0, y: 0, z: Math.max(150, Math.hypot(camera.x, camera.y, camera.z)) },
            { x: 0, y: 0, z: 0 },
            nodes.length && duration() ? 350 : 0,
          );
        }
      }
      refreshStyle();
      if (initialSnapshot && nodes.length) {
        const snapshot = initialSnapshot;
        initialSnapshot = undefined;
        if (snapshot.dimensions === dimensions) {
          lastFraming = undefined;
          // Apply after dimensions, whose default camera reset must not overwrite restoration.
          graph.camera().up.set(snapshot.camera.up.x, snapshot.camera.up.y, snapshot.camera.up.z);
          graph.cameraPosition(snapshot.camera.position, snapshot.camera.target, 0);
          needsFit = false;
        }
      }
      if (pendingFocus) focus(pendingFocus.id, pendingFocus);
    },
    resize(width, height, topInset = 0) {
      if (dead) return;
      visible = width > 0 && height > 0;
      if (!visible) return;
      // A fixed margin can exhaust a short canvas below the transaction panel.
      // Reserve at most 10% per side, including on narrow phone viewports.
      fitPadding = Math.min(40, width * 0.1, height * 0.1);
      const changed =
        width !== viewportWidth || height !== viewportHeight || topInset !== navigationInset;
      viewportWidth = width;
      viewportHeight = height;
      navigationInset = Number.isFinite(topInset) ? Math.max(0, topInset) : 0;
      graph.width(width).height(height);
      halos.material.uniforms.viewportScale.value = height * graph.renderer().getPixelRatio();
      const previousFraming = lastFraming;
      tryEarlyFit();
      if (pendingFocus) focus(pendingFocus.id, pendingFocus, 0);
      else if (needsFit && settled && graph.graphData().nodes.length) {
        needsFit = false;
        frameNodes(graph.graphData().nodes, duration());
        scheduleSnapshot();
      } else if (changed && lastFraming && lastFraming === previousFraming) {
        if (lastFraming.nodeId) focus(lastFraming.nodeId, lastFraming, 0);
        else frameNodes(graph.graphData().nodes, 0);
        scheduleSnapshot();
      }
    },
    focus,
    fit,
    dispose,
  };
};
