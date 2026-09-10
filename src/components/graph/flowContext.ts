import type { GraphLink, GraphNode } from '../../domain/types';

export type FlowRole = 'input' | 'output';
export interface GraphFlowContext {
  /** Canonical transaction node ID. This is a view context, never an ownership claim. */
  transactionId: string;
  nodes: ReadonlyMap<string, FlowRole>;
  links: ReadonlyMap<string, FlowRole>;
}

/** Index loaded relationships once, independently of selection and canvas filters. */
export function indexGraphFlow(graph: { nodes: GraphNode[]; links: GraphLink[] }) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const contexts = new Map<
    string,
    {
      transactionId: string;
      nodes: Map<string, FlowRole>;
      links: Map<string, FlowRole>;
    }
  >();
  const related = new Map<string, string[]>();
  const spenders = new Map<string, string[]>();
  for (const node of graph.nodes)
    if (node.kind === 'transaction')
      contexts.set(node.id, { transactionId: node.id, nodes: new Map(), links: new Map() });
  for (const link of graph.links) {
    if (link.kind === 'address') continue;
    const input = link.kind === 'spends';
    const transactionId = input ? link.target : link.source;
    const outputId = input ? link.source : link.target;
    const context = contexts.get(transactionId);
    if (!context || nodes.get(outputId)?.kind !== 'output') continue;
    const role = input ? 'input' : 'output';
    context.nodes.set(outputId, role);
    context.links.set(link.id, role);
    const candidates = related.get(outputId) ?? [];
    if (input) {
      candidates.push(transactionId);
      const ids = spenders.get(outputId) ?? [];
      ids.push(transactionId.slice(3));
      spenders.set(outputId, ids);
    } else candidates.unshift(transactionId);
    related.set(outputId, candidates);
  }
  return {
    /** Reuse observed relationships for bounded scans without rescanning workspace payloads. */
    spenders: spenders as ReadonlyMap<string, readonly string[]>,
    resolve(selectedId?: string, preferredTxid?: string): GraphFlowContext | undefined {
      if (!selectedId) return undefined;
      const selected = nodes.get(selectedId);
      if (selected?.kind === 'transaction') return contexts.get(selectedId);
      if (selected?.kind !== 'output') return undefined;
      const candidates = related.get(selectedId) ?? [];
      const preferred = preferredTxid ? `tx:${preferredTxid}` : undefined;
      return contexts.get(preferred && candidates.includes(preferred) ? preferred : candidates[0]);
    },
  };
}
