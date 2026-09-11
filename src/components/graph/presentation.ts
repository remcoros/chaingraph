import type { GraphLink, GraphNode } from '../../domain/types';
import type { GraphFrame, GraphHit } from './adapter';
import type { GraphFlowContext } from './flowContext';

/** Callers interpret tags, wallets or findings and supply only visual overrides. */
export interface NodePresentation {
  color?: string;
  highlight?: boolean;
  scale?: number;
  /** Human annotation text. An empty string suppresses generated entity labels. */
  label?: string;
  icon?: string;
  tags?: readonly string[];
}
export interface GraphPalette {
  transaction: string;
  output: string;
  address: string;
  accent: string;
  muted: string;
  background: string;
  input?: string;
  flowOutput?: string;
}
export function readGraphPalette(element: HTMLElement): GraphPalette {
  const style = getComputedStyle(element);
  const color = (token: string, fallback: string) =>
    style.getPropertyValue(token).trim() || fallback;
  return {
    transaction: color('--color-tx', '#e3a54f'),
    output: color('--color-output', '#84c2ae'),
    input: color('--color-flow-input', '#83baff'),
    flowOutput: color('--color-flow-output', '#82cfaa'),
    address: color('--color-address', '#919fd1'),
    accent: color('--color-accent', '#eab66b'),
    muted: color('--color-muted', '#74818b'),
    background: color('--color-paper', '#111a20'),
  };
}
export function clusterColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 65%, 62%)`;
}
export const linkActionId = (link: GraphLink) =>
  link.kind === 'spends' ? link.source : link.target;
export function resolveGraphHit(
  hit: GraphHit,
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
) {
  const link = hit.type === 'link' ? links.find((item) => item.id === hit.id) : undefined;
  if (hit.type === 'link' && !link) return undefined;
  return nodes.find((node) => node.id === (link ? linkActionId(link) : hit.id));
}
const DEFAULT_NODE_RADIUS = 3.2;
function valueRadius(satoshis: number | undefined): number {
  if (satoshis === undefined || !Number.isFinite(satoshis) || satoshis < 0)
    return DEFAULT_NODE_RADIUS;
  // Absolute logarithmic radius exposes ordinary payment differences while
  // keeping the full Bitcoin range usable: 20k sats ~2.0, 150m sats ~5.4,
  // and 21m BTC ~11.8. Neither sphere area nor volume represents a value ratio.
  // Zero stays pickable; filtering and additions never change this scale.
  return 1.6 + 0.9 * Math.log10(1 + satoshis / 10_000);
}

/** Reusable topology for one immutable pair of graph node/link arrays. */
export interface GraphPresentationIndex {
  readonly nodes: readonly GraphNode[];
  readonly sourceLinks: readonly GraphLink[];
  readonly links: readonly GraphLink[];
  readonly bridges: ReadonlySet<string>;
  readonly degrees: ReadonlyMap<string, number>;
}

export function buildGraphPresentationIndex(
  nodes: readonly GraphNode[],
  sourceLinks: readonly GraphLink[],
): GraphPresentationIndex {
  const ids = new Set(nodes.map((node) => node.id));
  const links = sourceLinks.filter((link) => ids.has(link.source) && ids.has(link.target));
  const created = new Set<string>();
  const degrees = new Map<string, number>();
  for (const link of links) {
    if (link.kind === 'creates') created.add(link.target);
    degrees.set(link.source, (degrees.get(link.source) ?? 0) + 1);
    degrees.set(link.target, (degrees.get(link.target) ?? 0) + 1);
  }
  const bridges = new Set<string>();
  for (const link of links)
    if (link.kind === 'spends' && created.has(link.source)) bridges.add(link.source);
  return { nodes, sourceLinks, links, bridges, degrees };
}

export function presentGraph(
  input: {
    nodes: readonly GraphNode[];
    links: readonly GraphLink[];
    dimensions: 2 | 3;
    selectedId?: string;
    batchSelectedIds?: readonly string[];
    sizeBy: 'uniform' | 'value' | 'degree';
    glow: boolean;
    showLabels?: boolean;
    showTags?: boolean;
    showIcons?: boolean;
    nodePresentation?: ReadonlyMap<string, NodePresentation>;
    flowContext?: GraphFlowContext;
  },
  palette: GraphPalette,
  index?: GraphPresentationIndex,
): GraphFrame {
  const { links, bridges, degrees } =
    index?.nodes === input.nodes && index.sourceLinks === input.links
      ? index
      : buildGraphPresentationIndex(input.nodes, input.links);
  const activeIds = new Set(input.batchSelectedIds);
  if (input.selectedId) activeIds.add(input.selectedId);
  const shapes = { transaction: 'box', output: 'sphere', address: 'octahedron' } as const;
  return {
    dimensions: input.dimensions,
    background: palette.background,
    nodes: input.nodes.map((node) => {
      const override = input.nodePresentation?.get(node.id);
      const selected = node.id === input.selectedId;
      const role = input.flowContext?.nodes.get(node.id);
      const roleColor =
        role === 'input' ? (palette.input ?? '#83baff') : (palette.flowOutput ?? palette.output);
      const radius =
        input.sizeBy === 'value'
          ? valueRadius(node.value)
          : DEFAULT_NODE_RADIUS *
            Math.cbrt(
              input.sizeBy === 'degree'
                ? Math.min(14, 1 + Math.sqrt(degrees.get(node.id) || 0))
                : 1,
            );
      const scale = override?.scale;
      // Explicit coordinates are transient layout hints, never renderer-owned state.
      const fixed = node as GraphNode & { fx?: number; fy?: number; fz?: number };
      return {
        id: node.id,
        text:
          [
            [
              input.showIcons !== false ? override?.icon : undefined,
              input.showLabels !== false ? (override?.label ?? node.label) : undefined,
            ]
              .filter(Boolean)
              .join(' '),
            input.showTags !== false && override?.tags?.length
              ? override.tags.map((tag) => `#${tag}`).join(' · ')
              : undefined,
          ]
            .filter(Boolean)
            .join('\n') || undefined,
        shape: shapes[node.kind],
        captionPriority:
          (input.showTags !== false && !!override?.tags?.length) ||
          (input.showLabels !== false && !!override?.label),
        marker: role
          ? {
              shape: role === 'input' ? ('brackets' as const) : ('ring' as const),
              color: roleColor,
            }
          : undefined,
        color: selected
          ? palette.accent
          : (override?.color ??
            (node.cluster ? clusterColor(node.cluster) : role ? roleColor : palette[node.kind])),
        radius: radius * (scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : 1),
        selected,
        flowActive: activeIds.has(node.id),
        highlight: input.glow && (selected || (override?.highlight ?? Boolean(node.cluster))),
        x: node.x,
        y: node.y,
        z: node.z,
        fx: fixed.fx,
        fy: fixed.fy,
        fz: fixed.fz,
      };
    }),
    links: links.map((link) => {
      const bridge =
        (link.kind === 'creates' && bridges.has(link.target)) ||
        (link.kind === 'spends' && bridges.has(link.source));
      const selected = link.source === input.selectedId || link.target === input.selectedId;
      const role = input.flowContext?.links.get(link.id);
      const emphasized = selected || Boolean(role);
      return {
        id: link.id,
        source: link.source,
        target: link.target,
        color:
          role === 'input'
            ? (palette.input ?? '#83baff')
            : role === 'output'
              ? (palette.flowOutput ?? palette.output)
              : selected
                ? palette.accent
                : palette.muted,
        width: bridge ? 1 : emphasized ? 0.65 : 0,
        arrowLength: link.kind === 'address' ? 0 : bridge ? 5.5 : emphasized ? 4.5 : 3.6,
        directed: link.kind !== 'address',
        flowSide:
          link.kind === 'spends' ? 'incoming' : link.kind === 'creates' ? 'outgoing' : undefined,
      };
    }),
  };
}
