import { useEffect, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from '3d-force-graph';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  Color,
  Mesh,
  MeshLambertMaterial,
  OctahedronGeometry,
  Points,
  ShaderMaterial,
  SphereGeometry,
} from 'three';
import { formatSats, type GraphLink, type GraphNode, type Transaction } from '../domain/types';
import './graph.css';

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  selectedId?: string;
  onSelect: (id: string) => void;
  dimensions: 2 | 3;
  sizeBy: 'uniform' | 'value' | 'degree';
  glow: boolean;
  fitToken: number;
  transactions?: Record<string, Transaction>;
  onTrace?: (id: string) => void;
  onEdit?: (id: string) => void;
  traceDisabledReason?: string;
  busy?: boolean;
}

type SimNode = GraphNode & NodeObject;
type SimLink = Omit<GraphLink, 'source' | 'target'> & {
  source: string | SimNode;
  target: string | SimNode;
};
type Graph = ForceGraph3DInstance<SimNode, SimLink>;
const GraphConstructor = ForceGraph3D as unknown as new (
  element: HTMLElement,
  options: { controlType: 'orbit' },
) => Graph;
const endpointId = (endpoint: string | SimNode) =>
  typeof endpoint === 'string' ? endpoint : endpoint.id;
const linkActionId = (link: GraphLink | SimLink) =>
  endpointId(link.kind === 'spends' ? link.source : link.target);
type HoverCard = { type: 'node' | 'link'; id: string; x: number; y: number };

function clusterColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 65%, 62%)`;
}

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

export default function GraphView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const current = useRef(props);
  current.current = props;
  const degrees = useRef(new Map<string, number>());
  const haloNodes = useRef<SimNode[]>([]);
  const topology = useRef('');
  const needsFit = useRef(true);
  const savedDepth = useRef(new Map<string, number>());
  const refreshStyle = useRef<() => void>(() => {});
  const cardRef = useRef<HTMLElement>(null);
  const pointer = useRef({ x: 0, y: 0, touch: false });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cardEntered = useRef(false);
  const lastHit = useRef<{ type: HoverCard['type']; id: string } | undefined>(undefined);
  const [hover, setHover] = useState<HoverCard>();
  const [error, setError] = useState(false);

  function keepCardOpen() {
    clearTimeout(closeTimer.current);
  }
  function scheduleCardClose() {
    keepCardOpen();
    closeTimer.current = setTimeout(() => {
      if (!cardEntered.current && !cardRef.current?.contains(document.activeElement))
        setHover(undefined);
    }, 650);
  }
  function showCard(type: HoverCard['type'], id: string, keyboard = false) {
    if (
      !keyboard &&
      (pointer.current.touch ||
        cardEntered.current ||
        cardRef.current?.contains(document.activeElement))
    )
      return;
    keepCardOpen();
    const element = containerRef.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const widthOfCard = Math.min(320, Math.max(200, width - 24));
    const x = keyboard ? (width - widthOfCard) / 2 : pointer.current.x + 18;
    const y = keyboard ? 40 : pointer.current.y + 18;
    setHover({
      type,
      id,
      x: Math.max(12, Math.min(x, width - widthOfCard - 12)),
      y: Math.max(12, Math.min(y, height - 320)),
    });
    if (keyboard) requestAnimationFrame(() => cardRef.current?.focus());
  }
  function dismissCard(returnFocus = false) {
    keepCardOpen();
    cardEntered.current = false;
    setHover(undefined);
    if (returnFocus) graphRef.current?.renderer().domElement.focus();
  }

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let graph: Graph | undefined;
    let observer: ResizeObserver | undefined;
    let removeContextListener = () => {};
    let releaseMeshes = () => {};
    try {
      graph = new GraphConstructor(element, { controlType: 'orbit' });
      graphRef.current = graph;
      const style = getComputedStyle(element);
      const color = (token: string, fallback: string) =>
        style.getPropertyValue(token).trim() || fallback;
      const colors = {
        transaction: color('--color-tx', '#e3a54f'),
        output: color('--color-output', '#84c2ae'),
        address: color('--color-address', '#919fd1'),
        accent: color('--color-accent', '#eab66b'),
        muted: color('--color-muted', '#74818b'),
      };
      const nodeColor = (node: SimNode) =>
        node.id === current.current.selectedId
          ? colors.accent
          : node.cluster
            ? clusterColor(node.cluster)
            : colors[node.kind];
      const nodeValue = (node: SimNode) => {
        const { sizeBy } = current.current;
        if (sizeBy === 'degree')
          return Math.min(14, 1 + Math.sqrt(degrees.current.get(node.id) || 0));
        if (sizeBy === 'value')
          return Math.min(16, 1 + Math.log10(1 + Math.max(0, node.value || 0)));
        return 1;
      };
      const geometries = {
        transaction: new BoxGeometry(1.6, 1.6, 1.6),
        output: new SphereGeometry(1, 8, 8),
        address: new OctahedronGeometry(1.4),
      };
      const materials = new Map<string, MeshLambertMaterial>();
      const meshes = new Map<string, Mesh<BufferGeometry, MeshLambertMaterial>>();
      const materialFor = (color: string) => {
        let material = materials.get(color);
        if (!material) {
          material = new MeshLambertMaterial({ color });
          materials.set(color, material);
        }
        return material;
      };
      const updateMesh = (mesh: Mesh<BufferGeometry, MeshLambertMaterial>, node: SimNode) => {
        mesh.geometry = geometries[node.kind];
        mesh.material = materialFor(nodeColor(node));
        mesh.scale.setScalar(3.2 * Math.cbrt(nodeValue(node)));
      };
      releaseMeshes = () => {
        meshes.clear();
        Object.values(geometries).forEach((geometry) => geometry.dispose());
        materials.forEach((material) => material.dispose());
        materials.clear();
      };
      const isSelectedLink = (link: SimLink) =>
        endpointId(link.source) === current.current.selectedId ||
        endpointId(link.target) === current.current.selectedId;
      const halos = makeHalos();
      graph.scene().add(halos);
      const positionHalos = () => {
        const positions = halos.geometry.getAttribute('position');
        if (!positions) return;
        haloNodes.current.forEach((node, index) =>
          positions.setXYZ(index, node.x || 0, node.y || 0, node.z || 0),
        );
        positions.needsUpdate = true;
      };
      refreshStyle.current = () => {
        if (!graph) return;
        const ids = new Set(graph.graphData().nodes.map((node) => node.id));
        for (const id of meshes.keys()) if (!ids.has(id)) meshes.delete(id);
        for (const node of graph.graphData().nodes) {
          const mesh = meshes.get(node.id);
          if (mesh) updateMesh(mesh, node);
        }
        graph
          .linkColor((link) => (isSelectedLink(link) ? colors.accent : colors.muted))
          .linkWidth((link) => (isSelectedLink(link) ? 0.65 : 0))
          .linkDirectionalArrowLength((link) =>
            link.kind !== 'address' && isSelectedLink(link) ? 3 : 0,
          );
        const highlighted = graph
          .graphData()
          .nodes.filter(
            (node) =>
              current.current.glow &&
              (node.id === current.current.selectedId || Boolean(node.cluster)),
          );
        haloNodes.current = highlighted;
        const geometry = new BufferGeometry();
        geometry.setAttribute(
          'position',
          new BufferAttribute(new Float32Array(highlighted.length * 3), 3),
        );
        const haloColors = new Float32Array(highlighted.length * 3);
        const haloSizes = new Float32Array(highlighted.length);
        const tint = new Color();
        highlighted.forEach((node, index) => {
          tint.set(nodeColor(node)).toArray(haloColors, index * 3);
          haloSizes[index] = 20 * Math.cbrt(nodeValue(node));
        });
        geometry.setAttribute('haloColor', new BufferAttribute(haloColors, 3));
        geometry.setAttribute('haloSize', new BufferAttribute(haloSizes, 1));
        halos.geometry.dispose();
        halos.geometry = geometry;
        positionHalos();
      };
      graph
        .backgroundColor(color('--color-paper', '#111a20'))
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
          const mesh = new Mesh(geometries[node.kind], materialFor(nodeColor(node)));
          updateMesh(mesh, node);
          meshes.set(node.id, mesh);
          return mesh;
        })
        .nodeLabel('')
        .linkLabel('')
        .linkHoverPrecision(2)
        .onNodeHover((node) => {
          if (node) {
            lastHit.current = { type: 'node', id: node.id };
            showCard('node', node.id);
          } else {
            if (lastHit.current?.type === 'node') lastHit.current = undefined;
            scheduleCardClose();
          }
        })
        .onLinkHover((link) => {
          if (link) {
            lastHit.current = { type: 'link', id: link.id };
            showCard('link', link.id);
          } else {
            if (lastHit.current?.type === 'link') lastHit.current = undefined;
            scheduleCardClose();
          }
        })
        .onNodeClick((node) => current.current.onSelect(node.id))
        .onLinkClick((link) => current.current.onSelect(linkActionId(link)))
        .onBackgroundClick(() => dismissCard())
        .onNodeDrag(positionHalos)
        .onEngineTick(positionHalos)
        .onEngineStop(() => {
          positionHalos();
          if (needsFit.current && graph && graph.graphData().nodes.length) {
            needsFit.current = false;
            graph.zoomToFit(450, 65);
          }
        });
      graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      const resize = () => {
        if (!graph) return;
        const { width, height } = element.getBoundingClientRect();
        graph.width(Math.max(1, width)).height(Math.max(1, height));
        halos.material.uniforms.viewportScale.value = height * graph.renderer().getPixelRatio();
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(element);
      const onContextLost = (event: Event) => {
        event.preventDefault();
        graph?.pauseAnimation();
        setError(true);
      };
      const canvas = graph.renderer().domElement;
      canvas.tabIndex = 0;
      canvas.setAttribute(
        'aria-label',
        'Interactive transaction graph. Select an item using the entity list, then press Enter here for its details.',
      );
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') dismissCard();
        if ((event.key === 'Enter' || event.key === ' ') && current.current.selectedId) {
          event.preventDefault();
          showCard('node', current.current.selectedId, true);
        }
      };
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('keydown', onKeyDown);
      removeContextListener = () => {
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('keydown', onKeyDown);
      };
    } catch {
      graph?._destructor();
      releaseMeshes();
      graph = undefined;
      graphRef.current = null;
      setError(true);
    }
    return () => {
      observer?.disconnect();
      clearTimeout(closeTimer.current);
      removeContextListener();
      graphRef.current = null;
      refreshStyle.current = () => {};
      topology.current = '';
      needsFit.current = true;
      haloNodes.current = [];
      lastHit.current = undefined;
      savedDepth.current.clear();
      graph?._destructor();
      releaseMeshes();
      element.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const previous = new Map(graph.graphData().nodes.map((node) => [node.id, node]));
    const nodes = props.nodes.map((node) => {
      const existing = previous.get(node.id);
      if (!existing) {
        if (current.current.dimensions === 2) {
          savedDepth.current.set(node.id, node.z || 0);
          return { ...node, z: 0 };
        }
        return { ...node };
      }
      const { x, y, z } = existing;
      // Preserve the simulation's object identity and position, including after a label edit.
      return Object.assign(
        existing,
        {
          cluster: undefined,
          value: undefined,
          address: undefined,
          txid: undefined,
          vout: undefined,
        },
        node,
        { x, y, z },
      );
    });
    const ids = new Set(nodes.map((node) => node.id));
    for (const id of savedDepth.current.keys()) if (!ids.has(id)) savedDepth.current.delete(id);
    const links = props.links
      .filter((link) => ids.has(link.source) && ids.has(link.target))
      .map((link) => ({ ...link }));
    degrees.current = new Map();
    for (const link of links) {
      degrees.current.set(link.source, (degrees.current.get(link.source) || 0) + 1);
      degrees.current.set(link.target, (degrees.current.get(link.target) || 0) + 1);
    }
    const signature = JSON.stringify([
      nodes.map((node) => node.id),
      links.map((link) => [link.id, link.source, link.target, link.kind]),
    ]);
    if (signature !== topology.current) {
      if (!previous.size) needsFit.current = true;
      topology.current = signature;
      graph.graphData({ nodes, links });
    }
    refreshStyle.current();
  }, [props.nodes, props.links]);

  useEffect(() => {
    refreshStyle.current();
  }, [props.selectedId, props.sizeBy, props.glow]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    for (const node of graph.graphData().nodes) {
      if (props.dimensions === 2) {
        if (!savedDepth.current.has(node.id)) savedDepth.current.set(node.id, node.z || 0);
        node.z = 0;
        node.vz = 0;
      } else if (savedDepth.current.has(node.id)) {
        node.z = savedDepth.current.get(node.id);
      }
    }
    if (props.dimensions === 3) savedDepth.current.clear();
    graph.numDimensions(props.dimensions);
    const controls = graph.controls() as { enableRotate: boolean };
    controls.enableRotate = props.dimensions === 3;
    if (props.dimensions === 2) {
      const position = graph.cameraPosition();
      graph.camera().up.set(0, 1, 0);
      graph.cameraPosition(
        { x: 0, y: 0, z: Math.max(150, Math.hypot(position.x, position.y, position.z)) },
        { x: 0, y: 0, z: 0 },
        350,
      );
    }
  }, [props.dimensions]);

  useEffect(() => {
    if (props.fitToken) graphRef.current?.zoomToFit(450, 65);
  }, [props.fitToken]);

  const hoveredLink =
    hover?.type === 'link' ? props.links.find((link) => link.id === hover.id) : undefined;
  const hoveredNode = hover
    ? props.nodes.find((node) => node.id === (hoveredLink ? linkActionId(hoveredLink) : hover.id))
    : undefined;
  const linkedOutput = hoveredLink
    ? props.nodes.find(
        (node) =>
          node.kind === 'output' &&
          (node.id === hoveredLink.source || node.id === hoveredLink.target),
      )
    : undefined;
  const transaction = hoveredNode?.txid ? props.transactions?.[hoveredNode.txid] : undefined;
  const missingFunding =
    hoveredNode?.kind === 'output' &&
    (hoveredNode.value === undefined ||
      Boolean(props.transactions && hoveredNode.txid && !transaction));
  const cardTitle = hoveredLink
    ? { creates: 'Creates output', spends: 'Spends output', address: 'Address association' }[
        hoveredLink.kind
      ]
    : hoveredNode?.kind;
  const traceReason = props.busy ? 'Another operation is running.' : props.traceDisabledReason;

  useEffect(() => {
    if (hover && !hoveredNode) dismissCard();
    const card = cardRef.current;
    const container = containerRef.current;
    if (!card || !container) return;
    const clamp = () => {
      const bounds = container.getBoundingClientRect();
      const size = card.getBoundingClientRect();
      setHover((previous) => {
        if (!previous) return previous;
        const x = Math.max(12, Math.min(previous.x, bounds.width - size.width - 12));
        const y = Math.max(12, Math.min(previous.y, bounds.height - size.height - 12));
        return x === previous.x && y === previous.y ? previous : { ...previous, x, y };
      });
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(card);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hover?.id, hover?.type, Boolean(hoveredNode)]);

  return (
    <div
      className="graph-view"
      data-testid="graph-view"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        pointer.current = {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
          touch: event.pointerType === 'touch',
        };
      }}
      onPointerLeave={scheduleCardClose}
    >
      <div
        ref={containerRef}
        className="graph-canvas"
        aria-hidden={error}
        onPointerMove={() => {
          // The renderer keeps its last hit while the pointer is over a sibling
          // HTML card. Actual movement back to the same mesh must reopen details,
          // but removing the card alone must not reopen the previous hit.
          if (cardRef.current) return;
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const hit = lastHit.current;
              if (hit && !cardRef.current) showCard(hit.type, hit.id);
            }),
          );
        }}
      />
      {!error && hover && hoveredNode && (
        <section
          ref={cardRef}
          className="graph-hover-card"
          role="dialog"
          aria-label="Graph item details"
          tabIndex={-1}
          style={{ left: hover.x, top: hover.y }}
          onPointerEnter={() => {
            cardEntered.current = true;
            keepCardOpen();
          }}
          onPointerLeave={() => {
            cardEntered.current = false;
            scheduleCardClose();
          }}
          onFocus={keepCardOpen}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) scheduleCardClose();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              dismissCard(true);
            }
          }}
        >
          <div className="graph-card-heading">
            <span>{cardTitle}</span>
            <button
              type="button"
              className="graph-card-close"
              aria-label="Close graph details"
              onClick={() => dismissCard(true)}
            >
              ×
            </button>
          </div>
          <strong className="graph-card-label">{hoveredNode.label}</strong>
          {hoveredLink && (
            <p className="graph-card-explanation">
              {
                {
                  creates: 'The transaction creates this output.',
                  spends: 'This output is consumed by the linked spending transaction.',
                  address:
                    'This output pays to the address. An address association does not establish common ownership.',
                }[hoveredLink.kind]
              }
            </p>
          )}
          <dl className="graph-card-facts">
            <div>
              <dt>
                {hoveredNode.kind === 'transaction'
                  ? 'Transaction ID'
                  : hoveredNode.kind === 'output'
                    ? 'Outpoint'
                    : 'Address'}
              </dt>
              <dd className="graph-card-identifier">
                {hoveredNode.kind === 'output' && hoveredNode.txid
                  ? `${hoveredNode.txid}:${hoveredNode.vout}`
                  : hoveredNode.txid || hoveredNode.address || hoveredNode.id}
              </dd>
            </div>
            {hoveredLink?.kind === 'spends' && (
              <div>
                <dt>Spending transaction</dt>
                <dd className="graph-card-identifier">{hoveredLink.target.replace(/^tx:/, '')}</dd>
              </div>
            )}
            {hoveredLink?.kind === 'address' && linkedOutput && (
              <div>
                <dt>Output</dt>
                <dd className="graph-card-identifier">{linkedOutput.id.replace(/^out:/, '')}</dd>
              </div>
            )}
            {(hoveredNode.value !== undefined || linkedOutput?.value !== undefined) && (
              <div>
                <dt>{hoveredNode.kind === 'transaction' ? 'Total outputs' : 'Output value'}</dt>
                <dd>{formatSats(hoveredNode.value ?? linkedOutput?.value)}</dd>
              </div>
            )}
            {hoveredNode.address && hoveredNode.kind !== 'address' && (
              <div>
                <dt>Address</dt>
                <dd className="graph-card-identifier">{hoveredNode.address}</dd>
              </div>
            )}
            {transaction && hoveredNode.kind === 'transaction' && (
              <div>
                <dt>Structure</dt>
                <dd>
                  {transaction.vin.length} inputs · {transaction.vout.length} outputs
                </dd>
              </div>
            )}
            {transaction?.confirmations !== undefined && (
              <div>
                <dt>Saved confirmations</dt>
                <dd>{transaction.confirmations.toLocaleString()}</dd>
              </div>
            )}
          </dl>
          {missingFunding && (
            <p className="graph-card-explanation graph-card-missing">
              Funding transaction is not loaded. Value and address may be unknown.
            </p>
          )}
          {hoveredNode.kind === 'output' && !missingFunding && (
            <p className="graph-card-explanation">
              An output node may already be spent. Inspect its spending links to investigate.
            </p>
          )}
          <div className="graph-card-actions">
            {props.onTrace && hoveredNode.kind !== 'address' && (
              <button
                type="button"
                disabled={Boolean(traceReason)}
                title={traceReason || 'Load one previous level of funding transactions'}
                onClick={() => {
                  props.onTrace?.(hoveredNode.id);
                  dismissCard();
                }}
              >
                Load previous level
              </button>
            )}
            {props.onEdit && (
              <button
                type="button"
                onClick={() => {
                  props.onEdit?.(hoveredNode.id);
                  dismissCard();
                }}
              >
                Edit label and notes
              </button>
            )}
          </div>
          {traceReason && props.onTrace && hoveredNode.kind !== 'address' && (
            <p className="graph-card-explanation">{traceReason}</p>
          )}
        </section>
      )}
      {error && (
        <div className="graph-unavailable" role="status">
          <strong>The graph needs WebGL</strong>
          <p>
            Your workspace is still available. Use the entity list to inspect and select items, or
            reload with hardware acceleration enabled.
          </p>
        </div>
      )}
      {!error && !props.nodes.length && (
        <div className="graph-empty" aria-hidden="true">
          <span className="graph-empty-cross">+</span>
          <span>Add a transaction or address to begin</span>
        </div>
      )}
    </div>
  );
}
