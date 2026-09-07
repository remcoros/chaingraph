import { useEffect, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance, type NodeObject } from '3d-force-graph';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from 'three';
import type { GraphLink, GraphNode } from '../domain/types';
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
  const [error, setError] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let graph: Graph | undefined;
    let observer: ResizeObserver | undefined;
    let removeContextListener = () => {};
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
        graph
          .nodeColor((node) => nodeColor(node))
          .nodeVal((node) => nodeValue(node))
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
        .nodeLabel((node) => {
          const tooltip = document.createElement('div');
          tooltip.className = 'graph-node-tooltip';
          tooltip.textContent = `${node.kind} · ${node.label || node.id}`;
          return tooltip;
        })
        .onNodeClick((node) => current.current.onSelect(node.id))
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
      canvas.setAttribute(
        'aria-label',
        'Interactive transaction graph. Use the entity list to select nodes with a keyboard.',
      );
      canvas.addEventListener('webglcontextlost', onContextLost);
      removeContextListener = () => canvas.removeEventListener('webglcontextlost', onContextLost);
    } catch {
      graph?._destructor();
      graph = undefined;
      graphRef.current = null;
      setError(true);
    }
    return () => {
      observer?.disconnect();
      removeContextListener();
      graphRef.current = null;
      refreshStyle.current = () => {};
      topology.current = '';
      needsFit.current = true;
      haloNodes.current = [];
      savedDepth.current.clear();
      graph?._destructor();
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

  return (
    <div className="graph-view" data-testid="graph-view">
      <div ref={containerRef} className="graph-canvas" aria-hidden={error} />
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
