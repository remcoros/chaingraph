import type { NodePresentation } from './Renderer/presentation';
import type { WalletMatch } from '../../../../Core/Workspace/Wallets/walletMatches';
import type { GraphData, GraphNode } from '../../GraphState/types';
import type { Workspace } from '../../../../Core/Workspace/workspace';
import type { WorkspaceTag } from '../../../../Core/Workspace/Annotations/annotations';

export const EMPTY_GRAPH_ANNOTATIONS: Workspace['annotations']['entities'] = {};
const EMPTY_WALLETS: Workspace['wallets']['definitions'] = [];
const sameStrings = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

interface Inputs {
  graph: GraphData;
  annotations: Workspace['annotations']['entities'];
  tags: ReadonlyMap<string, WorkspaceTag[]>;
  matches: ReadonlyMap<string, WalletMatch>;
  wallets: Workspace['wallets']['definitions'];
  mode: Workspace['view']['highlightMode'];
}
interface Metadata {
  presentation: ReadonlyMap<string, NodePresentation>;
  labeledNodes: ReadonlyMap<string, GraphNode>;
}

/** One bounded derived cache per displayed workspace. Returned maps and nodes are
 * immutable snapshots, including when React abandons or replays a render. */
export class GraphMetadataProjection {
  private previous?: Inputs;
  private nodes = new Map<string, GraphNode>();
  private value: Metadata = { presentation: new Map(), labeledNodes: new Map() };

  project(
    graph: GraphData,
    workspace:
      | {
          annotations: Pick<Workspace['annotations'], 'entities'>;
          wallets: Pick<Workspace['wallets'], 'definitions'>;
        }
      | undefined,
    tags: ReadonlyMap<string, WorkspaceTag[]>,
    matches: ReadonlyMap<string, WalletMatch>,
    mode: Workspace['view']['highlightMode'],
  ): Metadata {
    const next: Inputs = {
      graph,
      annotations: workspace?.annotations.entities ?? EMPTY_GRAPH_ANNOTATIONS,
      tags,
      matches,
      wallets: workspace?.wallets.definitions ?? EMPTY_WALLETS,
      mode,
    };
    const before = this.previous;
    const structuralChange = before?.graph !== graph;
    if (structuralChange) this.nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const candidates = new Set<string>();
    if (
      structuralChange ||
      before?.tags !== tags ||
      before.matches !== matches ||
      before.wallets !== next.wallets ||
      before.mode !== mode
    ) {
      for (const id of this.nodes.keys()) candidates.add(id);
    } else if (before.annotations !== next.annotations) {
      for (const id of new Set([
        ...Object.keys(before.annotations),
        ...Object.keys(next.annotations),
      ])) {
        const old = before.annotations[id];
        const annotation = next.annotations[id];
        if (
          (old?.label ?? '') !== (annotation?.label ?? '') ||
          (old?.icon ?? '') !== (annotation?.icon ?? '')
        )
          candidates.add(id);
      }
    }
    const previous = structuralChange
      ? {
          presentation: new Map<string, NodePresentation>(),
          labeledNodes: new Map<string, GraphNode>(),
        }
      : this.value;
    let presentation: Map<string, NodePresentation> | undefined;
    let labeledNodes: Map<string, GraphNode> | undefined;
    for (const id of candidates) {
      const node = this.nodes.get(id);
      if (!node) continue;
      const annotation = next.annotations[id];
      const nodeTags = tags.get(id) ?? [];
      const activeTags = mode === 'all' || mode === 'tags' ? nodeTags : [];
      const match = mode === 'all' || mode === 'wallets' ? matches.get(id) : undefined;
      const walletColor = match
        ? next.wallets.find((wallet) => match.walletIds.includes(wallet.id))?.color
        : undefined;
      const appearance: NodePresentation = {
        color: activeTags.length || match ? (activeTags[0]?.color ?? walletColor) : undefined,
        highlight: activeTags.length || match ? true : undefined,
        tags: nodeTags.map((tag) => tag.name),
        label: annotation?.label ?? '',
        icon: annotation?.icon ?? '',
      };
      const old = previous.presentation.get(id);
      if (
        !old ||
        old.color !== appearance.color ||
        old.highlight !== appearance.highlight ||
        old.label !== appearance.label ||
        old.icon !== appearance.icon ||
        !sameStrings(old.tags, appearance.tags)
      ) {
        presentation ??= new Map(previous.presentation);
        presentation.set(id, appearance);
      }
      const text = annotation?.label || node.label;
      const label = annotation?.icon ? `${annotation.icon} ${text}` : text;
      const oldNode = previous.labeledNodes.get(id) ?? node;
      if (oldNode.label !== label) {
        labeledNodes ??= new Map(previous.labeledNodes);
        if (label === node.label) labeledNodes.delete(id);
        else labeledNodes.set(id, { ...node, label });
      }
    }
    if (structuralChange || presentation || labeledNodes) {
      this.value = {
        presentation: presentation ?? previous.presentation,
        labeledNodes: labeledNodes ?? previous.labeledNodes,
      };
    }
    this.previous = next;
    return this.value;
  }
}
