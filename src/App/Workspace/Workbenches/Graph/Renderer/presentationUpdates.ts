import type { GraphNode } from '../../../../../Domain/types';
import type { GraphAdapter, GraphFrame, NodeAppearancePatch, RenderNode } from './adapter';
import {
  buildGraphPresentationIndex,
  createGraphNodePresenter,
  presentGraph,
  type GraphPalette,
  type GraphPresentationIndex,
  type GraphPresentationInput,
  type NodePresentation,
} from './presentation';

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b ||
  ((a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((value, i) => value === b?.[i]));

function sameOverride(a: NodePresentation | undefined, b: NodePresentation | undefined) {
  return (
    a === b ||
    (a?.color === b?.color &&
      a?.highlight === b?.highlight &&
      Object.is(a?.scale, b?.scale) &&
      a?.label === b?.label &&
      a?.icon === b?.icon &&
      sameList(a?.tags, b?.tags))
  );
}

function sameContext(a: GraphPresentationInput, b: GraphPresentationInput) {
  return (
    a.nodes === b.nodes &&
    a.links === b.links &&
    a.dimensions === b.dimensions &&
    a.selectedId === b.selectedId &&
    sameList(a.batchSelectedIds, b.batchSelectedIds) &&
    a.sizeBy === b.sizeBy &&
    a.glow === b.glow &&
    (a.showLabels !== false) === (b.showLabels !== false) &&
    (a.showTags !== false) === (b.showTags !== false) &&
    (a.showIcons !== false) === (b.showIcons !== false) &&
    a.flowContext === b.flowContext
  );
}

function samePalette(a: GraphPalette, b: GraphPalette) {
  return (
    a === b ||
    (a.transaction === b.transaction &&
      a.output === b.output &&
      a.address === b.address &&
      a.accent === b.accent &&
      a.muted === b.muted &&
      a.background === b.background &&
      a.input === b.input &&
      a.flowOutput === b.flowOutput)
  );
}

function sameAppearance(a: RenderNode, b: RenderNode) {
  return (
    a.text === b.text &&
    a.captionPriority === b.captionPriority &&
    a.color === b.color &&
    a.highlight === b.highlight
  );
}

/** One visible graph's current projection, with no workspace or renderer-owned state. */
export class GraphPresentationUpdates {
  private previous?: {
    adapter: GraphAdapter;
    input: GraphPresentationInput;
    palette: GraphPalette;
    frame: GraphFrame;
    nodes: Map<string, GraphNode>;
    rendered: Map<string, RenderNode>;
    index: GraphPresentationIndex;
  };

  update(
    adapter: GraphAdapter,
    input: GraphPresentationInput,
    palette: GraphPalette,
    presentationIndex?: GraphPresentationIndex,
  ): void {
    const previous = this.previous;
    if (
      !previous ||
      previous.adapter !== adapter ||
      !sameContext(previous.input, input) ||
      !samePalette(previous.palette, palette)
    ) {
      const index =
        presentationIndex?.nodes === input.nodes && presentationIndex.sourceLinks === input.links
          ? presentationIndex
          : buildGraphPresentationIndex(input.nodes, input.links);
      const frame = presentGraph(input, palette, index);
      adapter.update(frame);
      this.previous = {
        adapter,
        input,
        palette,
        frame,
        index,
        nodes: new Map(input.nodes.map((node) => [node.id, node])),
        rendered: new Map(frame.nodes.map((node) => [node.id, node])),
      };
      return;
    }

    const before = previous.input.nodePresentation;
    const after = input.nodePresentation;
    if (before === after) return;
    const changed: RenderNode[] = [];
    let needsFullFrame = !adapter.updateNodeAppearance;
    let presentNode: ReturnType<typeof createGraphNodePresenter> | undefined;
    const consider = (id: string) => {
      if (sameOverride(before?.get(id), after?.get(id))) return;
      const node = previous.nodes.get(id);
      if (!node) return;
      presentNode ??= createGraphNodePresenter(input, palette, previous.index);
      const next = presentNode(node);
      const current = previous.rendered.get(id)!;
      const radiusChanged = current.radius !== next.radius;
      if (!radiusChanged && sameAppearance(current, next)) return;
      needsFullFrame ||= radiusChanged;
      changed.push(next);
    };
    for (const id of after?.keys() ?? []) consider(id);
    for (const id of before?.keys() ?? []) if (!after?.has(id)) consider(id);

    if (changed.length) {
      // Do not replace or copy the full node array for appearance-only updates.
      if (needsFullFrame) {
        const replacements = new Map(changed.map((node) => [node.id, node]));
        const frame = {
          ...previous.frame,
          nodes: Array.from(
            previous.rendered.values(),
            (node) => replacements.get(node.id) ?? node,
          ),
        };
        adapter.update(frame);
        previous.frame = frame;
      } else {
        const patches: NodeAppearancePatch[] = changed.map(
          ({ id, text, captionPriority, color, highlight }) => ({
            id,
            text,
            captionPriority,
            color,
            highlight,
          }),
        );
        adapter.updateNodeAppearance!(patches);
      }
      for (const node of changed) previous.rendered.set(node.id, node);
    }
    previous.input = input;
    previous.palette = palette;
  }
}
