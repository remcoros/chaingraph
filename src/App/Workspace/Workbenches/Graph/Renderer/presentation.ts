import type { GraphLink, GraphNode } from '../../../GraphState/types';
import type { GraphFrame, GraphHit, RenderChronology, RenderNode } from './adapter';
import type { GraphFlowContext } from './flowContext';
import { OUTPUT_GROUP_VOLUME_FILL } from './outputGroupGlyph';
import { groupParallelOutputs, type OutputGroupProjection } from './outputGroups';

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
    accent: color('--color-accent', '#f7931a'),
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

function presentationRadius(
  sizeBy: GraphPresentationInput['sizeBy'],
  value: number | undefined,
  degree: number,
) {
  return sizeBy === 'value'
    ? valueRadius(value)
    : DEFAULT_NODE_RADIUS *
        Math.cbrt(sizeBy === 'degree' ? Math.min(14, 1 + Math.sqrt(degree)) : 1);
}

/** Reusable topology for one immutable pair of graph node/link arrays. */
export interface GraphPresentationIndex {
  readonly nodes: readonly GraphNode[];
  readonly sourceLinks: readonly GraphLink[];
  readonly links: readonly GraphLink[];
  readonly bridges: ReadonlySet<string>;
  readonly degrees: ReadonlyMap<string, number>;
  readonly outputGroups: OutputGroupProjection;
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
  return {
    nodes,
    sourceLinks,
    links,
    bridges,
    degrees,
    outputGroups: groupParallelOutputs(nodes, links),
  };
}

export interface GraphPresentationInput {
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
  chronology?: ReadonlyMap<string, RenderChronology>;
  /** Renderer-only compaction for repeated output bridges. Enabled unless explicitly disabled. */
  groupOutputs?: boolean;
}

/** Build once per update, then project only the nodes whose visual overrides changed. */
export function createGraphNodePresenter(
  input: GraphPresentationInput,
  palette: GraphPalette,
  index: GraphPresentationIndex,
): (node: GraphNode) => RenderNode {
  const { degrees } = index;
  const activeIds = new Set(input.batchSelectedIds);
  if (input.selectedId) activeIds.add(input.selectedId);
  const shapes = { transaction: 'box', output: 'sphere', address: 'octahedron' } as const;
  return (node) => {
    const override = input.nodePresentation?.get(node.id);
    const selected = node.id === input.selectedId;
    const role = input.flowContext?.nodes.get(node.id);
    const roleColor =
      role === 'input' ? (palette.input ?? '#83baff') : (palette.flowOutput ?? palette.output);
    const radius = presentationRadius(input.sizeBy, node.value, degrees.get(node.id) || 0);
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
      chronology: input.chronology?.get(node.id),
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
  };
}

export function presentGraph(
  input: GraphPresentationInput,
  palette: GraphPalette,
  index?: GraphPresentationIndex,
): GraphFrame {
  const topology =
    index?.nodes === input.nodes && index.sourceLinks === input.links
      ? index
      : buildGraphPresentationIndex(input.nodes, input.links);
  const { links, bridges } = topology;
  const outputGroups =
    input.groupOutputs === false
      ? {
          groups: [],
          byMember: new Map<string, never>(),
          groupedLinkIds: new Set<string>(),
        }
      : topology.outputGroups;
  const presentNode = createGraphNodePresenter(input, palette, topology);
  const presentLink = (link: GraphLink) => {
    const bridge =
      (link.kind === 'creates' && bridges.has(link.target)) ||
      (link.kind === 'spends' && bridges.has(link.source));
    const selected = link.source === input.selectedId || link.target === input.selectedId;
    const role = input.flowContext?.links.get(link.id);
    const emphasized = selected || Boolean(role);
    const addressAssociation = link.kind === 'address';
    return {
      id: link.id,
      source: addressAssociation ? link.target : link.source,
      target: addressAssociation ? link.source : link.target,
      color:
        role === 'input'
          ? (palette.input ?? '#83baff')
          : role === 'output'
            ? (palette.flowOutput ?? palette.output)
            : selected
              ? palette.accent
              : palette.muted,
      width: bridge ? 1 : emphasized ? 0.65 : 0,
      arrowLength: addressAssociation ? 0 : bridge ? 5.5 : emphasized ? 4.5 : 3.6,
      directed: !addressAssociation,
      traceAssociation: addressAssociation,
      flowSide:
        link.kind === 'spends'
          ? ('incoming' as const)
          : link.kind === 'creates'
            ? ('outgoing' as const)
            : undefined,
    };
  };
  const groupedNodes = new Map(
    outputGroups.groups.map((group) => {
      const members = group.members.map(presentNode);
      const colors = new Set(members.map((member) => member.color));
      const markers = members.map((member) => member.marker).filter(Boolean);
      const marker =
        markers.length === members.length &&
        markers.every(
          (candidate) =>
            candidate!.shape === markers[0]!.shape && candidate!.color === markers[0]!.color,
        )
          ? markers[0]
          : undefined;
      const selected = members.some((member) => member.selected);
      // Preserve the rendered volume of the particles this glyph replaces.
      // Applying the size curve to aggregated facts would make logarithmic value
      // sizing, uniform sizing and per-node scale overrides visibly too small.
      const radius = Math.cbrt(
        members.reduce((sum, member) => sum + member.radius ** 3, 0) / OUTPUT_GROUP_VOLUME_FILL,
      );
      return [
        group.id,
        {
          id: group.id,
          shape: 'output-group' as const,
          group: {
            kind: 'multiple-outputs' as const,
            memberIds: group.members.map((member) => member.id),
          },
          color: selected ? palette.accent : colors.size === 1 ? members[0].color : palette.output,
          radius,
          selected,
          flowActive: members.some((member) => member.flowActive),
          highlight: members.some((member) => member.highlight),
          marker,
        },
      ] as const;
    }),
  );
  const renderedNodes: RenderNode[] = [];
  const insertedGroups = new Set<string>();
  for (const node of input.nodes) {
    const group = outputGroups.byMember.get(node.id);
    if (!group) renderedNodes.push(presentNode(node));
    else if (!insertedGroups.has(group.id)) {
      insertedGroups.add(group.id);
      renderedNodes.push(groupedNodes.get(group.id)!);
    }
  }
  const renderedLinks = links
    .filter((link) => !outputGroups.groupedLinkIds.has(link.id))
    .map(presentLink);
  for (const group of outputGroups.groups) {
    const creates = group.creates.map(presentLink);
    const spends = group.spends.map(presentLink);
    const combine = (
      candidates: ReturnType<typeof presentLink>[],
      id: string,
      source: string,
      target: string,
      flowSide: 'incoming' | 'outgoing',
    ) => ({
      id,
      source,
      target,
      color: candidates.some((link) => link.color === palette.accent)
        ? palette.accent
        : new Set(candidates.map((link) => link.color)).size === 1
          ? candidates[0].color
          : palette.output,
      width: Math.max(...candidates.map((link) => link.width)),
      arrowLength: Math.max(...candidates.map((link) => link.arrowLength)),
      directed: true,
      traceAssociation: false,
      flowSide,
    });
    renderedLinks.push(
      combine(creates, `${group.id}:creates`, group.source, group.id, 'outgoing'),
      combine(spends, `${group.id}:spends`, group.id, group.target, 'incoming'),
    );
  }
  return {
    dimensions: input.dimensions,
    background: palette.background,
    nodes: renderedNodes,
    links: renderedLinks,
  };
}
