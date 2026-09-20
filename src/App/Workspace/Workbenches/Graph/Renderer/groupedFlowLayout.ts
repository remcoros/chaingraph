import type { LayoutNode, LayoutRequest, Position } from './flowLayout';
import {
  flowFrame,
  localPoint,
  normalized,
  rayExit,
  scaled,
  sideCenter,
  subtract,
  worldPoint,
  type FlowFrame,
} from './flowOrientation';
import { layoutTransactionSkeleton } from './transactionSkeleton';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const radius = (node: LayoutNode) => Math.max(2.4, node.radius ?? 5);
type Side = -1 | 1;
type Leaf = { node: LayoutNode; hub: string; side: Side };
type Bridge = { node: LayoutNode; source: string; target: string };
type Pack = {
  leaves: Leaf[];
  radius: number;
  outer: number;
  small?: { points: Position[]; extent: number };
};

/** Small groups need a complete balanced footprint, not a partial grid ring.
 * Keep projected glyphs apart as well as their meshes so depth cannot hide a
 * sibling in the normal flow view. Each side uses its own count and radii. */
function smallFootprint(leaves: Leaf[], flat: boolean, corridor: boolean) {
  if (!leaves.length || leaves.length > 8) return;
  const units = leaves.map((_, index): Position => {
    if (leaves.length === 1) return { x: 0, y: 0, z: 0 };
    if (leaves.length === 2) return { x: 0, y: index ? 0.5 : -0.5, z: 0 };
    const angle = (2 * Math.PI * index) / leaves.length + Math.PI / (2 * leaves.length);
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
      // Balanced depth gives small groups volume without a dominant central pole.
      z: flat ? 0 : Math.cos(2 * angle) * 0.45,
    };
  });
  let scale = 0;
  for (let i = 0; i < leaves.length; i++)
    for (let j = i + 1; j < leaves.length; j++) {
      const gap = Math.max(3, Math.min(radius(leaves[i].node), radius(leaves[j].node)) * 0.65);
      scale = Math.max(
        scale,
        (radius(leaves[i].node) + radius(leaves[j].node) + gap) /
          Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y),
      );
    }
  const points = units.map((point) => scaled(point, scale));
  if (corridor) {
    const clearance = Math.max(...leaves.map((leaf) => radius(leaf.node))) + 7;
    if (points.length === 1) points[0].y = clearance;
    else {
      // Split a small group evenly above/below its onward connection. An odd
      // count gets extra room before recentering so neither lobe blocks the path.
      const shift = clearance * (points.length % 2 ? points.length / (points.length - 1) : 1);
      for (const point of points) point.y += (point.y < 0 ? -1 : 1) * shift;
      const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      for (const point of points) point.y -= meanY;
    }
  }
  const extent = Math.max(
    ...points.map(
      (point, index) => Math.hypot(point.x, point.y, point.z) + radius(leaves[index].node),
    ),
  );
  return { points, extent };
}

/** A compact circular glyph footprint shared by rounded bridges and branch fans. */
function roundedFootprint(count: number, pitch: number) {
  const extent = Math.sqrt(count) * pitch * 0.65,
    steps = Math.ceil(extent / pitch);
  const candidates: Position[] = [];
  for (let row = -steps; row <= steps; row++)
    for (let column = -steps; column <= steps; column++) {
      const x = (column + (row % 2 ? 0.5 : 0)) * pitch,
        y = row * pitch * 0.8660254;
      if (x * x + y * y <= extent * extent) candidates.push({ x, y, z: 0 });
    }
  candidates.sort(
    (a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y || a.x - b.x || a.y - b.y,
  );
  const selected = candidates.slice(0, count);
  const cx =
    (Math.min(...selected.map((point) => point.x)) +
      Math.max(...selected.map((point) => point.x))) /
    2;
  const cy =
    (Math.min(...selected.map((point) => point.y)) +
      Math.max(...selected.map((point) => point.y))) /
    2;
  const points = selected.map((point) => ({ x: point.x - cx, y: point.y - cy, z: 0 }));
  const radius =
    Math.max(...points.map((point) => Math.hypot(point.x, point.y))) * (count < 8 ? 1.12 : 1);
  return { points, radius };
}

class Occupancy {
  private cells = new Map<string, { point: Position; radius: number }[]>();
  constructor(
    private size: number,
    private flat: boolean,
  ) {}
  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }
  add(point: Position, r: number) {
    const key = this.key(
      Math.floor(point.x / this.size),
      Math.floor(point.y / this.size),
      this.flat ? 0 : Math.floor(point.z / this.size),
    );
    const cell = this.cells.get(key) ?? [];
    cell.push({ point, radius: r });
    this.cells.set(key, cell);
  }
  free(point: Position, r: number) {
    const cx = Math.floor(point.x / this.size),
      cy = Math.floor(point.y / this.size),
      cz = this.flat ? 0 : Math.floor(point.z / this.size);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = this.flat ? 0 : cz - 1; z <= (this.flat ? 0 : cz + 1); z++)
          for (const other of this.cells.get(this.key(x, y, z)) ?? [])
            if (
              Math.hypot(
                point.x - other.point.x,
                point.y - other.point.y,
                this.flat ? 0 : point.z - other.point.z,
              ) <
              r + other.radius + 1.5
            )
              return false;
    return true;
  }
}

/** Places only recognized transaction / terminal-outpoint / bridge topology.
 * Unknown associations are left to the generic layout with these positions fixed. */
export function groupedFlowLayout(request: LayoutRequest): [string, Position][] {
  const nodes = [...request.nodes].sort((a, b) => compare(a.id, b.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incident = new Map(nodes.map((node) => [node.id, [] as LayoutRequest['links']]));
  for (const link of request.links) {
    if (!byId.has(link.source) || !byId.has(link.target)) continue;
    incident.get(link.source)!.push(link);
    incident.get(link.target)!.push(link);
  }
  const leaves: Leaf[] = [],
    bridges: Bridge[] = [];
  const hubs = new Map<string, LayoutNode>();
  for (const node of nodes) {
    if (node.shape !== 'sphere') continue;
    const links = incident.get(node.id)!.filter((link) => link.directed);
    if (links.length === 1 && links[0].directed) {
      const link = links[0],
        other = byId.get(link.source === node.id ? link.target : link.source)!;
      if (other.shape !== 'box') continue;
      hubs.set(other.id, other);
      leaves.push({ node, hub: other.id, side: link.target === node.id ? 1 : -1 });
    } else if (links.length === 2 && links.every((link) => link.directed)) {
      const incoming = links.find((link) => link.target === node.id),
        outgoing = links.find((link) => link.source === node.id);
      if (!incoming || !outgoing || incoming.source === outgoing.target) continue;
      const source = byId.get(incoming.source)!,
        target = byId.get(outgoing.target)!;
      if (source.shape !== 'box' || target.shape !== 'box') continue;
      hubs.set(source.id, source);
      hubs.set(target.id, target);
      bridges.push({ node, source: source.id, target: target.id });
    }
  }
  if (!hubs.size) return [];
  bridges.sort((a, b) => compare(a.node.id, b.node.id));
  const bridgeGroups = new Map<string, Bridge[]>();
  const pair = (source: string, target: string) => JSON.stringify([source, target]);
  for (const bridge of bridges) {
    const key = pair(bridge.source, bridge.target),
      peers = bridgeGroups.get(key) ?? [];
    peers.push(bridge);
    bridgeGroups.set(key, peers);
  }
  const bridgeGap = (source: string, target: string) => {
    const peers = bridgeGroups.get(pair(source, target))!;
    return peers.length === 1
      ? 24
      : Math.ceil(Math.sqrt(peers.length)) *
          (Math.max(...peers.map((peer) => radius(peer.node))) * 2 + 3) +
          12;
  };
  const flat = request.dimensions === 2;
  const positions = new Map(request.previous);
  for (const node of nodes) {
    const x = node.fx ?? node.x,
      y = node.fy ?? node.y,
      z = node.fz ?? node.z;
    if (Number.isFinite(x) && Number.isFinite(y))
      positions.set(node.id, { x: x!, y: y!, z: Number.isFinite(z) ? z! : 0 });
  }
  const cellSize = Math.max(8, ...nodes.map((node) => radius(node) * 2 + 2));
  let occupancy = new Occupancy(cellSize, flat);
  for (const node of nodes)
    if (positions.has(node.id)) occupancy.add(positions.get(node.id)!, radius(node));
  const packs = new Map<string, Map<Side, Pack>>();
  const corridors = new Set(
    bridges.flatMap((bridge) => [`${bridge.source}:1`, `${bridge.target}:-1`]),
  );
  for (const hub of hubs.values()) {
    const sides = new Map<Side, Pack>();
    for (const side of [-1, 1] as const) {
      const members = leaves.filter((leaf) => leaf.hub === hub.id && leaf.side === side);
      const small = smallFootprint(members, flat, corridors.has(`${hub.id}:${side}`));
      const amount = members.reduce((sum, leaf) => sum + (radius(leaf.node) + 1.2) ** 2, 0);
      const extent = small?.extent ?? (members.length ? Math.max(6, Math.sqrt(amount * 1.65)) : 0);
      sides.set(side, {
        leaves: members,
        small,
        radius: extent,
        outer: extent ? radius(hub) + 8 + extent * 2 : radius(hub) + 8,
      });
    }
    packs.set(hub.id, sides);
  }
  const neighbors = new Map(
    [...hubs.keys()].map((id) => [id, [] as { id: string; bridge: Bridge; side: Side }[]]),
  );
  for (const bridge of bridges) {
    neighbors.get(bridge.source)!.push({ id: bridge.target, bridge, side: 1 });
    neighbors.get(bridge.target)!.push({ id: bridge.source, bridge, side: -1 });
  }
  const cached = new Map(positions);
  const frames = new Map<string, FlowFrame>();
  type GroupMember = { id: string; point: Position; radius: number };
  const sphere = (members: GroupMember[]) => {
    const center = sideCenter(
      members.map((member) => member.point),
      flat,
    );
    return {
      center,
      radius:
        Math.max(
          ...members.map(
            ({ point, radius }) =>
              Math.hypot(point.x - center.x, point.y - center.y, flat ? 0 : point.z - center.z) +
              radius,
          ),
        ) + 2,
    };
  };
  const visibleGroups: {
    hubId: string;
    side: Side;
    members: Set<string>;
    center: Position;
    radius: number;
  }[] = [];
  for (const hub of hubs.values()) {
    for (const side of [-1, 1] as const) {
      const members = incident
        .get(hub.id)!
        .flatMap((link) => {
          if (!link.directed || (link.source === hub.id ? 1 : -1) !== side) return [];
          const id = link.source === hub.id ? link.target : link.source;
          const point = cached.get(id),
            node = byId.get(id);
          return point && node?.shape === 'sphere' ? [{ id, point, radius: radius(node) }] : [];
        })
        .sort((a, b) => compare(a.id, b.id));
      const remote = new Map(
        neighbors
          .get(hub.id)!
          .filter((neighbor) => cached.has(neighbor.id))
          .map((neighbor) => [neighbor.bridge.node.id, neighbor.id]),
      );
      const terminal = members.filter((member) => !remote.has(member.id));
      const terminalSphere = terminal.length ? sphere(terminal) : undefined;
      const local: GroupMember[] = [],
        peers = new Map<string, GroupMember[]>();
      for (const member of members) {
        // An outpoint promoted to a bridge stays part of its old sphere when
        // it still lies inside it. Repacked remote bridge groups stay separate.
        if (
          !remote.has(member.id) ||
          (terminalSphere &&
            Math.hypot(
              member.point.x - terminalSphere.center.x,
              member.point.y - terminalSphere.center.y,
              flat ? 0 : member.point.z - terminalSphere.center.z,
            ) <= terminalSphere.radius)
        ) {
          local.push(member);
        } else {
          const key = remote.get(member.id)!;
          const group = peers.get(key) ?? [];
          group.push(member);
          peers.set(key, group);
        }
      }
      for (const group of [local, ...peers.values()])
        if (group.length)
          visibleGroups.push({
            hubId: hub.id,
            side,
            members: new Set(group.map((member) => member.id)),
            ...sphere(group),
          });
    }
    frames.set(hub.id, flowFrame({ x: 1, y: 0, z: 0 }, flat));
  }
  const placedHubs = new Set([...hubs.keys()].filter((id) => positions.has(id)));
  const put = (id: string, point: Position) => {
    positions.set(id, point);
    occupancy.add(point, radius(byId.get(id)!));
  };
  const envelope = (id: string, point: Position) => {
    const sides = packs.get(id)!,
      frame = frames.get(id)!;
    const transverse = Math.max(
      radius(hubs.get(id)!),
      ...[...sides.values()].map((pack) => pack.radius),
    );
    const half = (sides.get(1)!.outer + sides.get(-1)!.outer) / 2;
    const center = worldPoint(frame, point, {
      x: (sides.get(1)!.outer - sides.get(-1)!.outer) / 2,
      y: 0,
      z: 0,
    });
    const extent = (axis: 'x' | 'y' | 'z') =>
      Math.abs(frame.forward[axis]) * half +
      (Math.abs(frame.across[axis]) + Math.abs(frame.depth[axis])) * transverse;
    return { center, x: extent('x'), y: extent('y'), z: extent('z') };
  };
  const groupFree = (id: string, point: Position, others: ReadonlySet<string> = placedHubs) => {
    const own = envelope(id, point);
    for (const other of others) {
      if (other === id) continue;
      const that = envelope(other, positions.get(other)!);
      if (
        Math.abs(own.center.x - that.center.x) >= own.x + that.x + 8 ||
        Math.abs(own.center.y - that.center.y) >= own.y + that.y + 8 ||
        (!flat && Math.abs(own.center.z - that.center.z) >= own.z + that.z + 8)
      )
        continue;
      return false;
    }
    return true;
  };
  const placeNear = (hub: LayoutNode, anchorId: string, side: Side) => {
    const origin = positions.get(anchorId)!;
    const neighbor = neighbors
      .get(hub.id)!
      .find((item) => item.bridge.node.id === anchorId && cached.has(item.id));
    const inherited = neighbor ? frames.get(neighbor.id)!.forward : { x: 1, y: 0, z: 0 };
    const outward = neighbor
      ? normalized(subtract(origin, cached.get(neighbor.id)!), flat, scaled(inherited, side))
      : scaled(inherited, side);
    const ray = normalized(
      {
        x: outward.x * 0.8 + inherited.x * side * 0.2,
        y: outward.y * 0.8 + inherited.y * side * 0.2,
        z: outward.z * 0.8 + inherited.z * side * 0.2,
      },
      flat,
      outward,
    );
    const rayFrame = flowFrame(ray, flat);
    frames.set(hub.id, flowFrame(scaled(ray, side), flat));
    const sourceGroup = visibleGroups.find(
      (group) => group.hubId === neighbor?.id && group.side === side && group.members.has(anchorId),
    );
    let distance = radius(hub) + radius(byId.get(anchorId)!) + 40;
    if (sourceGroup) {
      const exit = rayExit(
        { ...origin, z: flat ? 0 : origin.z },
        ray,
        { ...sourceGroup.center, z: flat ? 0 : sourceGroup.center.z },
        sourceGroup.radius,
        Infinity,
      );
      // Measure new space from the source sphere's outer boundary. Large
      // CoinJoin groups need proportional clearance, not a fixed-length nudge.
      distance = Math.max(distance, exit + Math.max(40, sourceGroup.radius) + radius(hub) + 4);
    }
    for (const group of visibleGroups)
      distance = Math.max(
        distance,
        rayExit(
          { ...origin, z: flat ? 0 : origin.z },
          ray,
          { ...group.center, z: flat ? 0 : group.center.z },
          group.radius + radius(hub) + 4,
          distance,
        ) + 6,
      );
    let fallback: Position | undefined;
    for (const extra of [0, 12, 24, 40])
      for (let attempt = 0; attempt < 13; attempt++) {
        const angle = attempt * 2.399963229728653,
          spread = attempt ? Math.min(20, distance * 0.2) * Math.sqrt(attempt / 12) : 0;
        const point = worldPoint(rayFrame, origin, {
          x: distance + extra,
          y: Math.cos(angle) * spread,
          z: flat ? 0 : Math.sin(angle) * spread,
        });
        if (!occupancy.free(point, radius(hub))) continue;
        fallback ??= point;
        if (groupFree(hub.id, point)) return point;
      }
    return fallback ?? worldPoint(rayFrame, origin, { x: distance + 52, y: 0, z: 0 });
  };
  // Previously displayed outpoints are the strongest reference when opening a hub.
  for (const hub of hubs.values()) {
    if (positions.has(hub.id)) continue;
    const attached = incident
      .get(hub.id)!
      .filter((link) => link.directed)
      .map((link) => ({
        id: link.source === hub.id ? link.target : link.source,
        side: (link.source === hub.id ? -1 : 1) as Side,
      }))
      .filter((item) => positions.has(item.id))
      .sort((a, b) => {
        const origin =
          request.expansionOrigin?.nodeId === hub.id ? request.expansionOrigin.anchorId : undefined;
        return Number(b.id === origin) - Number(a.id === origin) || compare(a.id, b.id);
      });
    if (attached.length) {
      const anchor = attached[0],
        point = placeNear(hub, anchor.id, anchor.side);
      frames.set(
        hub.id,
        flowFrame(scaled(subtract(point, positions.get(anchor.id)!), anchor.side), flat),
      );
      put(hub.id, point);
      placedHubs.add(hub.id);
    }
  }
  const skeleton = layoutTransactionSkeleton(
    [...hubs.values()].map((hub) => {
      const sides = packs.get(hub.id)!;
      return {
        id: hub.id,
        position: positions.get(hub.id),
        retained: cached.has(hub.id),
        chronology: hub.chronology,
        incomingExtent: sides.get(-1)!.outer,
        outgoingExtent: sides.get(1)!.outer,
        transverseExtent: Math.max(radius(hub), ...[...sides.values()].map((pack) => pack.radius)),
        localMass:
          1 +
          [...sides.values()].reduce((sum, pack) => sum + pack.leaves.length, 0) +
          new Set(neighbors.get(hub.id)!.map((neighbor) => neighbor.bridge.node.id)).size,
      };
    }),
    [...bridgeGroups.values()].map((peers) => ({
      source: peers[0].source,
      target: peers[0].target,
      gap: bridgeGap(peers[0].source, peers[0].target),
      weight: peers.length,
    })),
    flat ? 2 : 3,
  );
  for (const [id, point] of skeleton.positions) positions.set(id, point);
  for (const id of skeleton.positions.keys()) frames.set(id, flowFrame({ x: 1, y: 0, z: 0 }, flat));
  // Discard tentative skeleton occupancy before attaching its glyphs.
  occupancy = new Occupancy(cellSize, flat);
  for (const node of nodes)
    if (positions.has(node.id)) occupancy.add(positions.get(node.id)!, radius(node));
  // A bridge is a single canonical outpoint on the transaction connection.
  for (const peers of bridgeGroups.values()) {
    const source = positions.get(peers[0].source)!,
      target = positions.get(peers[0].target)!;
    const pitch = Math.max(...peers.map((peer) => radius(peer.node))) * 2 + 3;
    if (peers.length >= 3) {
      const delta = subtract(target, source),
        length = Math.hypot(delta.x, delta.y, flat ? 0 : delta.z);
      const frame = flowFrame(delta, flat);
      const center = {
        x: (source.x + target.x) / 2,
        y: (source.y + target.y) / 2,
        z: (source.z + target.z) / 2,
      };
      // Retain distinct projected glyph footprints, then lift them onto both
      // hemispheres. Shared outpoints remain one canonical node each.
      const { points: footprint, radius: shellRadius } = roundedFootprint(peers.length, pitch);
      const clearance =
        Math.max(radius(hubs.get(peers[0].source)!), radius(hubs.get(peers[0].target)!)) +
        pitch / 2 +
        3;
      const forwardScale = Math.min(1, Math.max(0, length / 2 - clearance) / shellRadius);
      for (let i = 0; i < peers.length; i++) {
        const bridge = peers[i];
        if (positions.has(bridge.node.id)) continue;
        const x = footprint[i].x,
          y = footprint[i].y;
        const depth = flat
          ? 0
          : Math.sqrt(Math.max(0, shellRadius * shellRadius - x * x - y * y)) * (i % 2 ? -1 : 1);
        const local = { x: x * forwardScale, y, z: depth };
        let point = worldPoint(frame, center, local);
        if (!occupancy.free(point, radius(bridge.node))) {
          const opposite = worldPoint(frame, center, { ...local, z: -depth });
          if (occupancy.free(opposite, radius(bridge.node))) point = opposite;
          else
            for (let attempt = 1; attempt <= 36; attempt++) {
              const angle = attempt * 2.399963229728653,
                offset = pitch * Math.sqrt(attempt);
              const candidate = worldPoint(frame, center, {
                x: local.x,
                y: local.y + Math.cos(angle) * offset,
                z: local.z + Math.sin(angle) * offset,
              });
              if (occupancy.free(candidate, radius(bridge.node))) {
                point = candidate;
                break;
              }
            }
        }
        put(bridge.node.id, point);
      }
      continue;
    }
    const frame = flowFrame(subtract(target, source), flat),
      center = {
        x: (source.x + target.x) / 2,
        y: (source.y + target.y) / 2,
        z: flat ? 0 : (source.z + target.z) / 2,
      };
    for (let i = 0; i < peers.length; i++) {
      const bridge = peers[i];
      if (positions.has(bridge.node.id)) continue;
      const offset = (i - (peers.length - 1) / 2) * pitch;
      let point = worldPoint(frame, center, { x: 0, y: offset, z: 0 });
      for (
        let attempt = 1;
        !occupancy.free(point, radius(bridge.node)) && attempt <= 36;
        attempt++
      ) {
        const angle = attempt * 2.399963229728653,
          distance = pitch * Math.sqrt(attempt);
        point = worldPoint(frame, center, {
          x: 0,
          y: offset + Math.cos(angle) * distance,
          z: flat ? 0 : Math.sin(angle) * distance,
        });
      }
      put(bridge.node.id, point);
    }
  }
  for (const [hubId, sides] of [...packs].sort(([a], [b]) => compare(a, b))) {
    const hub = positions.get(hubId)!,
      hubRadius = radius(hubs.get(hubId)!),
      frame = frames.get(hubId)!;
    for (const [side, pack] of sides) {
      const pending = pack.leaves
        .filter((leaf) => !positions.has(leaf.node.id))
        .sort((a, b) => radius(b.node) - radius(a.node) || compare(a.node.id, b.node.id));
      if (!pending.length) continue;
      if (pack.small && pending.length === pack.leaves.length) {
        const corridor = neighbors.get(hubId)!.some((neighbor) => neighbor.side === side);
        // Validate the entire group before committing any member. If an anchored
        // branch obstructs it, the existing collision-aware packer places that side.
        const proposed = pack.leaves.map((leaf, index) => {
          const local = pack.small!.points[index];
          return {
            leaf,
            local,
            point: worldPoint(frame, hub, {
              x: side * (hubRadius + 8 + pack.radius + local.x),
              y: local.y,
              z: local.z,
            }),
          };
        });
        if (
          proposed.every(
            ({ leaf, local, point }) =>
              (!corridor || Math.abs(local.y) >= radius(leaf.node) + 7) &&
              occupancy.free(point, radius(leaf.node)),
          )
        ) {
          for (const { leaf, point } of proposed) put(leaf.node.id, point);
          continue;
        }
      }
      const pitch = Math.min(...pack.leaves.map((leaf) => radius(leaf.node))) * 2 + 1.8;
      // Space the footprint first; 3D leaves are then lifted onto a rounded shell.
      const projection = new Occupancy(cellSize, true);
      const added = new Set<string>();
      for (const leaf of pack.leaves)
        if (positions.has(leaf.node.id))
          projection.add(localPoint(frame, hub, positions.get(leaf.node.id)!), radius(leaf.node));
      let next = 0;
      for (let expansion = 0; next < pending.length && expansion < 12; expansion++) {
        const extent = pack.radius * (1 + expansion * 0.2);
        const candidates: Position[] = [];
        for (let ix = -Math.ceil(extent / pitch); ix <= Math.ceil(extent / pitch); ix++)
          for (let iy = -Math.ceil(extent / pitch); iy <= Math.ceil(extent / pitch); iy++) {
            const x = (ix + (iy % 2 ? 0.5 : 0)) * pitch,
              y = iy * pitch * 0.8660254;
            if (x * x + y * y > extent * extent) continue;
            candidates.push({ x, y, z: 0 });
          }
        candidates.sort(
          (a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y) || a.x - b.x || a.y - b.y,
        );
        const following = Int32Array.from(candidates, (_, index) => index + 1);
        let head = 0;
        const smallest = Math.min(...pack.leaves.map((leaf) => radius(leaf.node)));
        for (; next < pending.length; next++) {
          const leaf = pending[next],
            r = radius(leaf.node);
          let candidate: Position | undefined;
          let cursor = head,
            previous = -1;
          while (cursor < candidates.length) {
            const local = candidates[cursor];
            const planar = { x: side * (hubRadius + 8 + extent + local.x), y: local.y, z: 0 };
            const point = worldPoint(frame, hub, planar);
            const corridor = neighbors.get(hubId)!.some((neighbor) => neighbor.side === side);
            const fits =
              (!corridor || Math.abs(local.y) >= r + 7) &&
              projection.free(planar, r) &&
              occupancy.free(point, r);
            // Permanently occupied candidates cannot fit any remaining smaller
            // glyph. Unlink them once instead of rescanning the filled pack.
            if (
              fits ||
              (corridor && Math.abs(local.y) < smallest + 7) ||
              !projection.free(planar, smallest)
            ) {
              if (previous < 0) head = following[cursor];
              else following[previous] = following[cursor];
              if (fits) {
                candidate = local;
                break;
              }
            } else previous = cursor;
            cursor = following[cursor];
          }
          if (!candidate) break;
          const planar = { x: side * (hubRadius + 8 + extent + candidate.x), y: candidate.y, z: 0 };
          const point = worldPoint(frame, hub, planar);
          put(leaf.node.id, point);
          added.add(leaf.node.id);
          projection.add(planar, r);
        }
      }
      if (!flat && added.size) {
        const members = pack.leaves.filter((leaf) => positions.has(leaf.node.id));
        const xs = members.map((leaf) => localPoint(frame, hub, positions.get(leaf.node.id)!).x);
        const ys = members.map((leaf) => localPoint(frame, hub, positions.get(leaf.node.id)!).y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        // The occupied footprint, rather than the oversized candidate envelope,
        // sets the radius so the outer leaves reach the equator as well as poles.
        const shellRadius =
          Math.max(
            ...members.map((leaf) => {
              const point = localPoint(frame, hub, positions.get(leaf.node.id)!);
              return Math.hypot(point.x - cx, point.y - cy);
            }),
          ) * (members.length < 8 ? 1.12 : 1);
        // A sparse set can consist almost entirely of rim points. A small
        // allowance gives those few leaves depth on both hemispheres as well.
        occupancy = new Occupancy(cellSize, false);
        for (const node of nodes)
          if (positions.has(node.id) && !added.has(node.id))
            occupancy.add(positions.get(node.id)!, radius(node));
        const ordered = [...members].sort((a, b) => compare(a.node.id, b.node.id));
        for (let index = 0; index < ordered.length; index++) {
          const leaf = ordered[index];
          if (!added.has(leaf.node.id)) continue;
          const point = positions.get(leaf.node.id)!;
          const local = localPoint(frame, hub, point);
          const depth = Math.sqrt(
            Math.max(0, shellRadius ** 2 - (local.x - cx) ** 2 - (local.y - cy) ** 2),
          );
          const sign = index % 2 ? -1 : 1;
          const lifted = worldPoint(frame, hub, { ...local, z: sign * depth });
          const reverse = worldPoint(frame, hub, { ...local, z: -sign * depth });
          // Existing observations may occupy either hemisphere. Keep the original
          // valid position if both shell positions are obstructed.
          const placed = occupancy.free(lifted, radius(leaf.node))
            ? lifted
            : occupancy.free(reverse, radius(leaf.node))
              ? reverse
              : point;
          positions.set(leaf.node.id, placed);
          occupancy.add(placed, radius(leaf.node));
        }
      }
      // An unusually obstructed side can use the generic anchored fallback.
    }
  }
  const recognized = new Set([
    ...hubs.keys(),
    ...leaves.map((leaf) => leaf.node.id),
    ...bridges.map((bridge) => bridge.node.id),
  ]);
  return nodes
    .filter((node) => recognized.has(node.id) && positions.has(node.id))
    .map((node) => [node.id, positions.get(node.id)!]);
}
