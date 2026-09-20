import type { GraphLink, GraphNode } from '../../../GraphState/types';

const MINIMUM_OUTPUT_GROUP_SIZE = 3;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface OutputPresentationGroup {
  id: string;
  source: string;
  target: string;
  members: readonly GraphNode[];
  creates: readonly GraphLink[];
  spends: readonly GraphLink[];
}

export interface OutputGroupProjection {
  groups: readonly OutputPresentationGroup[];
  byMember: ReadonlyMap<string, OutputPresentationGroup>;
  groupedLinkIds: ReadonlySet<string>;
}

/**
 * Finds output-only bridges that repeat between the same visible transaction pair.
 * The returned groups are renderer presentation only. Source nodes and links remain
 * canonical and untouched for selection, evidence, filtering and persistence.
 */
export function groupParallelOutputs(
  nodes: readonly GraphNode[],
  links: readonly GraphLink[],
): OutputGroupProjection {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incident = new Map(nodes.map((node) => [node.id, [] as GraphLink[]]));
  for (const link of links) {
    incident.get(link.source)?.push(link);
    incident.get(link.target)?.push(link);
  }

  const candidates = new Map<
    string,
    {
      source: string;
      target: string;
      members: GraphNode[];
      creates: GraphLink[];
      spends: GraphLink[];
    }
  >();
  for (const node of nodes) {
    if (node.kind !== 'output') continue;
    const connections = incident.get(node.id)!;
    if (connections.length !== 2) continue;
    const creates = connections.find(
      (link) =>
        link.kind === 'creates' &&
        link.target === node.id &&
        byId.get(link.source)?.kind === 'transaction',
    );
    const spends = connections.find(
      (link) =>
        link.kind === 'spends' &&
        link.source === node.id &&
        byId.get(link.target)?.kind === 'transaction',
    );
    if (!creates || !spends || creates.source === spends.target) continue;
    const key = `${creates.source}>${spends.target}`;
    const group = candidates.get(key) ?? {
      source: creates.source,
      target: spends.target,
      members: [],
      creates: [],
      spends: [],
    };
    group.members.push(node);
    group.creates.push(creates);
    group.spends.push(spends);
    candidates.set(key, group);
  }

  const groups: OutputPresentationGroup[] = [];
  for (const candidate of candidates.values()) {
    if (candidate.members.length < MINIMUM_OUTPUT_GROUP_SIZE) continue;
    const members = [...candidate.members].sort((a, b) => compare(a.id, b.id));
    const order = new Map(members.map((member, index) => [member.id, index]));
    const byOutput = (a: GraphLink, b: GraphLink) =>
      (order.get(a.kind === 'creates' ? a.target : a.source) ?? 0) -
      (order.get(b.kind === 'creates' ? b.target : b.source) ?? 0);
    groups.push({
      id: `outputs:${candidate.source}>${candidate.target}`,
      source: candidate.source,
      target: candidate.target,
      members,
      creates: [...candidate.creates].sort(byOutput),
      spends: [...candidate.spends].sort(byOutput),
    });
  }
  groups.sort((a, b) => compare(a.id, b.id));
  const byMember = new Map<string, OutputPresentationGroup>();
  const groupedLinkIds = new Set<string>();
  for (const group of groups) {
    for (const member of group.members) byMember.set(member.id, group);
    for (const link of [...group.creates, ...group.spends]) groupedLinkIds.add(link.id);
  }
  return { groups, byMember, groupedLinkIds };
}
