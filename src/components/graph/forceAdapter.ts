import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from '3d-force-graph';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  Mesh,
  MeshLambertMaterial,
  MOUSE,
  OctahedronGeometry,
  Points,
  Raycaster,
  Vector2,
  Vector3,
  ShaderMaterial,
  SphereGeometry,
  TOUCH,
} from 'three';
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
} from '../../domain/graphSnapshot';

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
  const halos = makeHalos();
  let haloNodes: SimNode[] = [];
  let topology = '';
  let dimensions: 2 | 3 | undefined;
  let needsFit = true;
  let visible = false;
  let fitPadding = 40;
  let settled = false;
  let pendingFocus: string | undefined;
  let dead = false;
  let initialSnapshot: GraphSnapshot | undefined;
  const retainedPositions = new Map<string, GraphSnapshot['nodes'][number]>();
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSnapshot = '';
  let hit: GraphHit | undefined;
  let point: GraphPointer = { x: 0, y: 0, pointerType: 'mouse' };
  const pointers = new Set<number>();
  let down: { id: number; x: number; y: number } | undefined;
  let selectable = false;
  const raycaster = new Raycaster();
  const cleanups: (() => void)[] = [];
  const emitSnapshot = () => {
    clearTimeout(snapshotTimer);
    if (dead || !settled || !dimensions || !events.snapshot) return;
    const data = graph.graphData().nodes;
    if (!data.length) return;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const point = (value: { x: number; y: number; z: number }) => ({
      x: round(value.x),
      y: round(value.y),
      z: round(value.z),
    });
    const controls = graph.controls() as { target: Vector3 };
    const parsed = graphSnapshotSchema.safeParse({
      version: 1,
      dimensions,
      camera: {
        position: point(graph.cameraPosition()),
        target: point(controls.target),
        up: point(graph.camera().up),
      },
      nodes: data
        // three-forcegraph removes the unused z coordinate in Flat mode.
        // Canonical snapshots retain z=0; invalid 3D coordinates still fail validation.
        .map((node) => ({
          id: node.id,
          ...point({ x: node.x!, y: node.y!, z: dimensions === 2 ? 0 : node.z! }),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    if (!parsed.success) return;
    for (const node of parsed.data.nodes) retainedPositions.set(node.id, node);
    while (retainedPositions.size > GRAPH_SNAPSHOT_NODE_LIMIT)
      retainedPositions.delete(retainedPositions.keys().next().value!);
    const signature = JSON.stringify(parsed.data);
    if (signature === lastSnapshot) return;
    lastSnapshot = signature;
    events.snapshot(parsed.data);
  };
  const scheduleSnapshot = () => {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(emitSnapshot, duration() + 150);
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
  const updateMesh = (mesh: Mesh<BufferGeometry, MeshLambertMaterial>, node: SimNode) => {
    mesh.geometry = geometries[node.shape];
    mesh.material = materialFor(node.color);
    mesh.scale.setScalar(node.radius);
  };
  const positionHalos = () => {
    const positions = halos.geometry.getAttribute('position');
    if (!positions) return;
    haloNodes.forEach((node, index) =>
      positions.setXYZ(index, node.x || 0, node.y || 0, node.z || 0),
    );
    positions.needsUpdate = true;
  };
  const refreshStyle = () => {
    const nodes = graph.graphData().nodes;
    const ids = new Set(nodes.map((node) => node.id));
    for (const id of meshes.keys()) if (!ids.has(id)) meshes.delete(id);
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
    if (visible && graph.graphData().nodes.length) graph.zoomToFit(duration(), fitPadding);
    scheduleSnapshot();
  };
  const emitHover = () => {
    if (!dead && !pointers.size && point.pointerType !== 'touch')
      events.hover({ hit, point: { ...point } });
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
    emitSnapshot();
    dead = true;
    clearTimeout(snapshotTimer);
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
    element.replaceChildren();
  };
  try {
    graph.scene().add(halos);
    graph
      .showNavInfo(false)
      .enableNodeDrag(false)
      .nodeRelSize(3.2)
      .nodeResolution(8)
      .nodeOpacity(0.95)
      .linkOpacity(0.32)
      .linkDirectionalArrowRelPos(0.7)
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
        if (link) hit = { type: 'link', id: link.id };
        else if (hit?.type === 'link') hit = undefined;
        emitHover();
      })
      .onNodeClick((node, event) => select({ type: 'node', id: node.id }, event))
      .onLinkClick((link, event) => select({ type: 'link', id: link.id }, event))
      .onBackgroundClick((event) => select(undefined, event))
      .onEngineTick(positionHalos)
      .onEngineStop(() => {
        if (dead) return;
        positionHalos();
        settled = true;
        if (visible && needsFit && graph.graphData().nodes.length) {
          needsFit = false;
          graph.zoomToFit(duration(), fitPadding);
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
    orbit.addEventListener('change', scheduleSnapshot);
    orbit.addEventListener('end', emitSnapshot);
    cleanups.push(() => {
      orbit.removeEventListener('change', scheduleSnapshot);
      orbit.removeEventListener('end', emitSnapshot);
    });
    const track = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        pointerType: event.pointerType,
      };
    };
    listen('pointerdown', (event) => {
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
  const focus = (id: string) => {
    if (dead) return;
    if (!visible) {
      pendingFocus = id;
      needsFit = false;
      return;
    }
    pendingFocus = undefined;
    const node = graph.graphData().nodes.find((node) => node.id === id);
    if (!node) return;
    needsFit = false;
    const target = { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 };
    const camera = graph.cameraPosition();
    const dx = camera.x - target.x,
      dy = camera.y - target.y,
      dz = camera.z - target.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    const position =
      dimensions === 2
        ? { x: target.x, y: target.y, z: 180 }
        : {
            x: target.x + (dx / length) * 180,
            y: target.y + (dy / length) * 180,
            z: target.z + (dz / length) * 180,
          };
    graph.cameraPosition(position, target, duration());
    scheduleSnapshot();
  };
  return {
    canvas,
    restoreSnapshot(snapshot) {
      if (dead) return;
      const parsed = graphSnapshotSchema.safeParse(snapshot);
      if (!parsed.success) return;
      initialSnapshot = parsed.data;
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
        return Object.assign(existing, node, { x, y, z });
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
        if (!previous.size && nodes.length && !initialSnapshot) needsFit = true;
        topology = signature;
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
          // Apply after dimensions, whose default camera reset must not overwrite restoration.
          graph.camera().up.set(snapshot.camera.up.x, snapshot.camera.up.y, snapshot.camera.up.z);
          graph.cameraPosition(snapshot.camera.position, snapshot.camera.target, 0);
          needsFit = false;
        }
      }
    },
    resize(width, height) {
      if (dead) return;
      visible = width > 0 && height > 0;
      if (!visible) return;
      // A fixed margin can exhaust a short canvas below the transaction panel.
      // Reserve at most 10% per side, including on narrow phone viewports.
      fitPadding = Math.min(40, width * 0.1, height * 0.1);
      graph.width(width).height(height);
      halos.material.uniforms.viewportScale.value = height * graph.renderer().getPixelRatio();
      if (pendingFocus) focus(pendingFocus);
      else if (needsFit && settled && graph.graphData().nodes.length) {
        needsFit = false;
        graph.zoomToFit(duration(), fitPadding);
        scheduleSnapshot();
      }
    },
    focus,
    fit,
    dispose,
  };
};
