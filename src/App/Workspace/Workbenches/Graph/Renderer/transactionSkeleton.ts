import type { LayoutNode, Position } from './flowLayout';
import { dot, flowFrame, normalized, scaled, subtract } from './flowOrientation';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const GOLDEN_ANGLE = 2.399963229728653;
const MAX_BRANCH_ANGLE = (82 * Math.PI) / 180;
const MIN_CAUSAL_X = 0.08;
const TEMPORAL_BAND_GAP = 24;

export interface TransactionSkeletonNode {
  id: string;
  /** Retained coordinates are immutable anchors during incremental expansion. */
  position?: Position;
  /** False only for a tentative position chosen while opening this transaction. */
  retained?: boolean;
  chronology?: LayoutNode['chronology'];
  incomingExtent: number;
  outgoingExtent: number;
  transverseExtent: number;
  /** Visible local geometry. Descendant mass is accumulated inside this module. */
  localMass: number;
}

export interface TransactionSkeletonEdge {
  source: string;
  target: string;
  gap: number;
  /** Number of visible outpoints connecting the same transaction pair. */
  weight: number;
}

export interface TransactionSkeleton {
  positions: Map<string, Position>;
}

type Branch = { id: string; mass: number; direction?: Position; angularRadius: number };

const hash = (id: string) => {
  let value = 2166136261;
  for (const character of id) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
};

const angleBetween = (a: Position, b: Position) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

const clearance = (node: TransactionSkeletonNode) =>
  Math.max(node.incomingExtent, node.outgoingExtent, node.transverseExtent);

function causalDirection(
  value: Position,
  flat: boolean,
  fallback: Position = { x: 1, y: 0, z: 0 },
) {
  const direction = normalized(value, flat, fallback);
  return direction.x >= MIN_CAUSAL_X
    ? direction
    : normalized({ x: MIN_CAUSAL_X, y: direction.y, z: direction.z }, flat, fallback);
}

function branchCandidates(id: string, forward: Position, flat: boolean) {
  const frame = flowFrame(forward, flat);
  const candidates = [frame.forward];
  if (flat) {
    const sign = hash(id) < 0.5 ? -1 : 1;
    for (let step = 1; step <= 20; step++)
      for (const side of [sign, -sign]) {
        const angle = (MAX_BRANCH_ANGLE * step * side) / 20;
        candidates.push({
          x: frame.forward.x * Math.cos(angle) + frame.across.x * Math.sin(angle),
          y: frame.forward.y * Math.cos(angle) + frame.across.y * Math.sin(angle),
          z: 0,
        });
      }
    return candidates;
  }
  const count = 192;
  const rotation = hash(id) * Math.PI * 2;
  for (let index = 0; index < count; index++) {
    // Equal solid-angle samples across a forward hemisphere. The stable rotation
    // changes only which deterministic sector an otherwise tied branch receives.
    const amount = (index + 1) / count;
    const cosine = 1 - amount * (1 - Math.cos(MAX_BRANCH_ANGLE));
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
    const azimuth = rotation + index * GOLDEN_ANGLE;
    candidates.push({
      x:
        frame.forward.x * cosine +
        frame.across.x * sine * Math.cos(azimuth) +
        frame.depth.x * sine * Math.sin(azimuth),
      y:
        frame.forward.y * cosine +
        frame.across.y * sine * Math.cos(azimuth) +
        frame.depth.y * sine * Math.sin(azimuth),
      z:
        frame.forward.z * cosine +
        frame.across.z * sine * Math.cos(azimuth) +
        frame.depth.z * sine * Math.sin(azimuth),
    });
  }
  return candidates;
}

function denseBranchCandidate(
  id: string,
  forward: Position,
  flat: boolean,
  index: number,
  count: number,
) {
  const frame = flowFrame(forward, flat);
  if (flat) {
    const amount = (index + 0.5) / count;
    const angle = -MAX_BRANCH_ANGLE + amount * MAX_BRANCH_ANGLE * 2;
    return normalized(
      {
        x: frame.forward.x * Math.cos(angle) + frame.across.x * Math.sin(angle),
        y: frame.forward.y * Math.cos(angle) + frame.across.y * Math.sin(angle),
        z: 0,
      },
      true,
      frame.forward,
    );
  }
  const amount = (index + 0.5) / count;
  const cosine = 1 - amount * (1 - Math.cos(MAX_BRANCH_ANGLE));
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  const azimuth = hash(id) * Math.PI * 2 + index * GOLDEN_ANGLE;
  return normalized(
    {
      x:
        frame.forward.x * cosine +
        frame.across.x * sine * Math.cos(azimuth) +
        frame.depth.x * sine * Math.sin(azimuth),
      y:
        frame.forward.y * cosine +
        frame.across.y * sine * Math.cos(azimuth) +
        frame.depth.y * sine * Math.sin(azimuth),
      z:
        frame.forward.z * cosine +
        frame.across.z * sine * Math.cos(azimuth) +
        frame.depth.z * sine * Math.sin(azimuth),
    },
    false,
    frame.forward,
  );
}

function allocateBranchDirections(
  parentId: string,
  forward: Position,
  branches: Branch[],
  flat: boolean,
  chronologySide: -1 | 1,
) {
  const occupied = branches
    .filter((branch) => branch.direction)
    .map((branch) => ({
      direction: normalized(branch.direction!, flat, forward),
      radius: branch.angularRadius,
    }));
  const candidates = branchCandidates(parentId, forward, flat);
  const pending = branches
    .filter((item) => !item.direction)
    .sort((a, b) => b.mass - a.mass || compare(a.id, b.id));
  const choose = (
    branch: Branch,
    options: readonly Position[],
    obstacles: readonly { direction: Position; radius: number }[],
  ) => {
    const eligible = options.filter((candidate) => candidate.x * chronologySide >= MIN_CAUSAL_X);
    let chosen =
        eligible[0] ?? normalized({ x: chronologySide, y: forward.y, z: forward.z }, flat, forward),
      best = -Infinity;
    for (const candidate of eligible) {
      const available = obstacles.length
        ? Math.min(
            ...obstacles.map(
              (other) =>
                angleBetween(candidate, other.direction) - other.radius - branch.angularRadius,
            ),
          )
        : Infinity;
      // Once separation is comparable, keep the largest branch closest to the
      // established forward direction. This preserves a readable continuation
      // while other substantial subtrees receive distinct solid-angle sectors.
      const score = available + dot(candidate, forward) * 0.015;
      if (score > best) {
        best = score;
        chosen = candidate;
      }
    }
    return normalized(chosen, flat, forward);
  };
  // Spend the expensive cone-packing search only on the largest subtrees. The
  // numerous small tails use a deterministic solid-angle sequence, scored
  // against the major cones and a short local history. This keeps high fan-in
  // transactions bounded without weakening separation of their major branches.
  const detailedCount = Math.min(32, pending.length);
  for (const branch of pending.slice(0, detailedCount)) {
    branch.direction = choose(branch, candidates, occupied);
    occupied.push({ direction: branch.direction, radius: branch.angularRadius });
  }
  const major = [...occupied].sort((a, b) => b.radius - a.radius).slice(0, 64);
  const tail = pending.slice(detailedCount);
  for (let index = 0; index < tail.length; index++) {
    const branch = tail[index];
    const options = Array.from({ length: 8 }, (_, phase) =>
      denseBranchCandidate(
        parentId,
        forward,
        flat,
        index + phase * tail.length,
        Math.max(1, tail.length * 8),
      ),
    );
    const recent = occupied.slice(-12);
    branch.direction = choose(branch, options, [...major, ...recent]);
    occupied.push({ direction: branch.direction, radius: branch.angularRadius });
  }
}

/**
 * Place transaction hubs as a deterministic, mass-aware branching skeleton.
 *
 * The hierarchy below is spatial only. Every factual graph edge remains with the
 * caller, and a transaction is never duplicated when DAG paths reconnect.
 */
export function layoutTransactionSkeleton(
  inputNodes: readonly TransactionSkeletonNode[],
  inputEdges: readonly TransactionSkeletonEdge[],
  dimensions: 2 | 3,
): TransactionSkeleton {
  const flat = dimensions === 2;
  const nodes = [...inputNodes].sort((a, b) => compare(a.id, b.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const combined = new Map<string, TransactionSkeletonEdge>();
  for (const edge of inputEdges) {
    if (edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    const key = JSON.stringify([edge.source, edge.target]);
    const previous = combined.get(key);
    combined.set(
      key,
      previous
        ? {
            ...previous,
            gap: Math.max(previous.gap, edge.gap),
            weight: previous.weight + edge.weight,
          }
        : { ...edge },
    );
  }
  const edges = [...combined.values()].sort(
    (a, b) => compare(a.source, b.source) || compare(a.target, b.target),
  );
  const positions = new Map<string, Position>();
  const directions = new Map<string, Position>();
  const anchored = new Set<string>();
  for (const node of nodes) {
    if (node.position && node.retained !== false) {
      positions.set(node.id, { ...node.position, z: flat ? 0 : node.position.z });
      anchored.add(node.id);
    }
  }
  const adjacent = new Map(
    nodes.map((node) => [node.id, [] as { id: string; edge: TransactionSkeletonEdge }[]]),
  );
  for (const edge of edges) {
    adjacent.get(edge.source)!.push({ id: edge.target, edge });
    adjacent.get(edge.target)!.push({ id: edge.source, edge });
  }
  for (const neighbors of adjacent.values())
    neighbors.sort(
      (a, b) =>
        b.edge.weight - a.edge.weight ||
        adjacent.get(b.id)!.length - adjacent.get(a.id)!.length ||
        byId.get(b.id)!.localMass - byId.get(a.id)!.localMass ||
        compare(a.id, b.id),
    );

  // The spatial tree is deliberately independent of edge chronology. Starting
  // at the strongest local branch point lets both fan-in and fan-out occupy
  // cones around one hub instead of leaving every upstream transaction as a
  // separate root. Every tree relation is still one real factual edge.
  const spatialParent = new Map<string, string>();
  const spatialEdge = new Map<string, TransactionSkeletonEdge>();
  const children = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const roots: TransactionSkeletonNode[] = [];
  const order: string[] = [];
  const componentSeen = new Set<string>();
  for (const start of nodes) {
    if (componentSeen.has(start.id)) continue;
    const component = [start.id];
    componentSeen.add(start.id);
    for (let index = 0; index < component.length; index++)
      for (const neighbor of adjacent.get(component[index])!)
        if (!componentSeen.has(neighbor.id)) {
          componentSeen.add(neighbor.id);
          component.push(neighbor.id);
        }
    const root = component
      .map((id) => byId.get(id)!)
      .sort(
        (a, b) =>
          Number(positions.has(b.id)) - Number(positions.has(a.id)) ||
          adjacent.get(b.id)!.length - adjacent.get(a.id)!.length ||
          b.localMass - a.localMass ||
          compare(a.id, b.id),
      )[0];
    roots.push(root);
    const queue = [root.id],
      treeSeen = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      order.push(id);
      for (const neighbor of adjacent.get(id)!) {
        if (treeSeen.has(neighbor.id)) continue;
        treeSeen.add(neighbor.id);
        spatialParent.set(neighbor.id, id);
        spatialEdge.set(neighbor.id, neighbor.edge);
        children.get(id)!.push(neighbor.id);
        queue.push(neighbor.id);
      }
    }
  }
  for (const ids of children.values()) ids.sort(compare);

  const subtreeMass = new Map(nodes.map((node) => [node.id, Math.max(1, node.localMass)]));
  for (const id of [...order].reverse()) {
    const parent = spatialParent.get(id);
    if (parent) subtreeMass.set(parent, subtreeMass.get(parent)! + subtreeMass.get(id)!);
  }

  for (const [child, parent] of spatialParent) {
    const from = positions.get(parent),
      to = positions.get(child),
      edge = spatialEdge.get(child)!;
    if (from && to && !directions.has(child)) {
      const side = edge.source === parent ? 1 : -1;
      directions.set(
        child,
        causalDirection(
          scaled(normalized(subtract(to, from), flat, directions.get(parent)), side),
          flat,
          directions.get(parent),
        ),
      );
    }
  }

  roots.sort((a, b) => subtreeMass.get(b.id)! - subtreeMass.get(a.id)! || compare(a.id, b.id));
  const occupied: { id: string; point: Position; radius: number }[] = nodes
    .filter((node) => positions.has(node.id))
    .map((node) => ({ id: node.id, point: positions.get(node.id)!, radius: clearance(node) }));
  const isFree = (id: string, point: Position, radius: number) =>
    occupied.every(
      (other) =>
        other.id === id ||
        Math.hypot(
          point.x - other.point.x,
          point.y - other.point.y,
          flat ? 0 : point.z - other.point.z,
        ) >=
          radius + other.radius + 8,
    );
  const occupy = (id: string, point: Position) => {
    positions.set(id, point);
    occupied.push({ id, point, radius: clearance(byId.get(id)!) });
  };

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
    const root = roots[rootIndex];
    directions.set(root.id, causalDirection(directions.get(root.id) ?? { x: 1, y: 0, z: 0 }, flat));
    if (positions.has(root.id)) continue;
    const spacing = Math.max(80, clearance(root) * 2 + 40);
    let point = { x: 0, y: 0, z: 0 };
    for (let attempt = 0; !isFree(root.id, point, clearance(root)); attempt++) {
      const ring = Math.floor(Math.sqrt(attempt + 1)) + 1;
      const angle = hash(root.id) * Math.PI * 2 + attempt * GOLDEN_ANGLE;
      point = {
        x: 0,
        y: Math.cos(angle) * ring * spacing,
        z: flat ? 0 : Math.sin(angle) * ring * spacing,
      };
    }
    occupy(root.id, point);
  }

  for (const parentId of order) {
    const parent = byId.get(parentId)!;
    const parentPosition = positions.get(parentId);
    if (!parentPosition) continue;
    const parentDirection = causalDirection(directions.get(parentId) ?? { x: 1, y: 0, z: 0 }, flat);
    directions.set(parentId, parentDirection);
    for (const side of [-1, 1] as const) {
      const childIds = children.get(parentId)!.filter((id) => {
        const edge = spatialEdge.get(id)!;
        return (edge.source === parentId ? 1 : -1) === side;
      });
      if (!childIds.length) continue;
      const totalMass = childIds.reduce((sum, id) => sum + Math.sqrt(subtreeMass.get(id)!), 0);
      const spatialForward = scaled(parentDirection, side);
      const branches: Branch[] = childIds.map((id) => {
        const share = Math.sqrt(subtreeMass.get(id)!) / totalMass;
        return {
          id,
          mass: subtreeMass.get(id)!,
          direction: positions.has(id)
            ? normalized(subtract(positions.get(id)!, parentPosition), flat, spatialForward)
            : directions.has(id)
              ? scaled(directions.get(id)!, side)
              : undefined,
          angularRadius: 0.1 + Math.sqrt(share) * 0.55,
        };
      });
      allocateBranchDirections(`${parentId}:${side}`, spatialForward, branches, flat, side);
      for (const branch of branches) {
        const child = byId.get(branch.id)!;
        const spatialDirection = normalized(branch.direction!, flat, spatialForward);
        directions.set(
          branch.id,
          causalDirection(scaled(spatialDirection, side), flat, parentDirection),
        );
        if (positions.has(branch.id)) continue;
        const edge = spatialEdge.get(branch.id)!;
        let distance =
          Math.max(
            side === 1 ? parent.outgoingExtent : parent.incomingExtent,
            clearance(parent) * 0.72,
          ) +
          Math.max(
            side === 1 ? child.incomingExtent : child.outgoingExtent,
            clearance(child) * 0.72,
          ) +
          edge.gap;
        const step = Math.max(16, Math.min(clearance(child), clearance(parent)) * 0.35);
        let point = {
          x: parentPosition.x + spatialDirection.x * distance,
          y: parentPosition.y + spatialDirection.y * distance,
          z: flat ? 0 : parentPosition.z + spatialDirection.z * distance,
        };
        for (
          let attempt = 0;
          !isFree(child.id, point, clearance(child)) && attempt < 128;
          attempt++
        ) {
          distance += step;
          point = {
            x: parentPosition.x + spatialDirection.x * distance,
            y: parentPosition.y + spatialDirection.y * distance,
            z: flat ? 0 : parentPosition.z + spatialDirection.z * distance,
          };
        }
        occupy(child.id, point);
      }
    }
  }

  // Cyclic malformed hints can fall outside the spatial hierarchy. Keep them
  // visible through deterministic component placement rather than force motion.
  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    const direction = directions.get(node.id) ?? { x: 1, y: 0, z: 0 };
    directions.set(node.id, direction);
    const anchor = occupied.at(-1)?.point ?? { x: 0, y: 0, z: 0 };
    let distance = clearance(node) + 80,
      point = { ...anchor };
    do {
      point = {
        x: anchor.x + direction.x * distance,
        y: anchor.y + direction.y * distance,
        z: flat ? 0 : anchor.z + direction.z * distance,
      };
      distance += 24;
    } while (!isFree(node.id, point, clearance(node)));
    occupy(node.id, point);
  }

  const incoming = new Map(nodes.map((node) => [node.id, [] as TransactionSkeletonEdge[]]));
  const remaining = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    incoming.get(edge.target)!.push(edge);
    remaining.set(edge.target, remaining.get(edge.target)! + 1);
  }
  const chronological = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
  for (let index = 0; index < chronological.length; index++)
    for (const neighbor of adjacent.get(chronological[index])!) {
      if (neighbor.edge.source !== chronological[index]) continue;
      remaining.set(neighbor.id, remaining.get(neighbor.id)! - 1);
      if (remaining.get(neighbor.id) === 0) chronological.push(neighbor.id);
    }
  const applyCausalOrder = () => {
    if (chronological.length !== nodes.length) return;
    for (const id of chronological) {
      if (anchored.has(id)) continue;
      const point = positions.get(id)!;
      const required = Math.max(
        -Infinity,
        ...incoming
          .get(id)!
          .map(
            (edge) =>
              positions.get(edge.source)!.x +
              byId.get(edge.source)!.outgoingExtent +
              byId.get(id)!.incomingExtent +
              edge.gap,
          ),
      );
      if (point.x < required) positions.set(id, { ...point, x: required });
    }
  };
  applyCausalOrder();

  // Confirmed height orders sibling events without mapping raw block gaps to
  // distance. Equal-height events share one compact X band; unknown-order and
  // mempool events share the last sibling band. Bands are branch-local, so
  // separate 3D subtrees can reuse X instead of recreating one global cigar.
  const bandOrder = (node: TransactionSkeletonNode) =>
    node.chronology?.kind === 'confirmed'
      ? node.chronology.order
      : node.chronology?.kind === 'latest'
        ? Infinity
        : undefined;
  for (const parentId of order)
    for (const side of [-1, 1] as const) {
      const siblings = children
        .get(parentId)!
        .filter((id) => {
          const edge = spatialEdge.get(id)!;
          return (
            (edge.source === parentId ? 1 : -1) === side && bandOrder(byId.get(id)!) !== undefined
          );
        })
        .sort((a, b) => bandOrder(byId.get(a)!)! - bandOrder(byId.get(b)!)! || compare(a, b));
      if (!siblings.length) continue;
      const bands: string[][] = [];
      for (const id of siblings) {
        const previous = bands.at(-1),
          key = bandOrder(byId.get(id)!)!;
        if (previous && Object.is(bandOrder(byId.get(previous[0])!)!, key)) previous.push(id);
        else bands.push([id]);
      }
      let right = -Infinity;
      for (const band of bands) {
        const incomingExtent = Math.max(...band.map((id) => byId.get(id)!.incomingExtent)),
          outgoingExtent = Math.max(...band.map((id) => byId.get(id)!.outgoingExtent)),
          center = Math.max(
            ...band.map((id) => positions.get(id)!.x),
            right + TEMPORAL_BAND_GAP + incomingExtent,
          );
        for (const id of band)
          if (!anchored.has(id)) {
            const point = positions.get(id)!;
            positions.set(id, { ...point, x: center });
          }
        right = Math.max(right, ...band.map((id) => positions.get(id)!.x + outgoingExtent));
      }
    }

  applyCausalOrder();
  for (const [child, parent] of spatialParent) {
    const edge = spatialEdge.get(child)!,
      side = edge.source === parent ? 1 : -1;
    directions.set(
      child,
      causalDirection(
        scaled(normalized(subtract(positions.get(child)!, positions.get(parent)!), flat), side),
        flat,
        directions.get(parent),
      ),
    );
  }

  return { positions };
}
