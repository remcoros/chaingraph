import type { GraphLink, GraphNode } from '../../domain/types';
import type { GraphFrame, GraphHit } from './adapter';

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
}
export function readGraphPalette(element: HTMLElement): GraphPalette {
  const style = getComputedStyle(element);
  const color = (token: string, fallback: string) =>
    style.getPropertyValue(token).trim() || fallback;
  return {
    transaction: color('--color-tx', '#e3a54f'),
    output: color('--color-output', '#84c2ae'),
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
  // Apply logarithmic compression to the radius itself. A further cube root
  // made dust and hundreds of BTC look nearly identical. Keep small outputs
  // pickable and cap large ones so they do not overwhelm adjacent branches.
  return Math.min(14.4, 2.4 + 1.4 * Math.log10(1 + satoshis / 1000));
}
export function presentGraph(
  input: {
    nodes: readonly GraphNode[];
    links: readonly GraphLink[];
    dimensions: 2 | 3;
    selectedId?: string;
    sizeBy: 'uniform' | 'value' | 'degree';
    glow: boolean;
    showLabels?: boolean;
    showTags?: boolean;
    showIcons?: boolean;
    nodePresentation?: ReadonlyMap<string, NodePresentation>;
  },
  palette: GraphPalette,
): GraphFrame {
  const ids = new Set(input.nodes.map((node) => node.id));
  const links = input.links.filter((link) => ids.has(link.source) && ids.has(link.target));
  const degrees = new Map<string, number>();
  for (const link of links)
    for (const id of [link.source, link.target]) degrees.set(id, (degrees.get(id) || 0) + 1);
  const shapes = { transaction: 'box', output: 'sphere', address: 'octahedron' } as const;
  return {
    dimensions: input.dimensions,
    background: palette.background,
    nodes: input.nodes.map((node) => {
      const override = input.nodePresentation?.get(node.id);
      const selected = node.id === input.selectedId;
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
        color: selected
          ? palette.accent
          : (override?.color ?? (node.cluster ? clusterColor(node.cluster) : palette[node.kind])),
        radius: radius * (scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : 1),
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
      const selected = link.source === input.selectedId || link.target === input.selectedId;
      return {
        id: link.id,
        source: link.source,
        target: link.target,
        color: selected ? palette.accent : palette.muted,
        width: selected ? 0.65 : 0,
        arrowLength: selected && link.kind !== 'address' ? 3.6 : 0,
      };
    }),
  };
}
