import type { LayoutNode, LayoutRequest, Position } from './flowLayout';
import {
  flowFrame,
  inferredAxis,
  localPoint,
  normalized,
  rayExit,
  scaled,
  sideCenter,
  subtract,
  worldPoint,
  type FlowFrame,
} from './flowOrientation';

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const radius = (node: LayoutNode) => Math.max(2.4, node.radius ?? 5);
type Side = -1 | 1;
type Leaf = { node: LayoutNode; hub: string; side: Side };
type Bridge = { node: LayoutNode; source: string; target: string };
type Pack = { leaves: Leaf[]; radius: number; outer: number };

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
  for (const hub of hubs.values()) {
    const sides = new Map<Side, Pack>();
    for (const side of [-1, 1] as const) {
      const members = leaves.filter((leaf) => leaf.hub === hub.id && leaf.side === side);
      const amount = members.reduce((sum, leaf) => sum + (radius(leaf.node) + 1.2) ** 2, 0);
      const extent = members.length ? Math.max(6, Math.sqrt(amount * 1.65)) : 0;
      sides.set(side, {
        leaves: members,
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
  const visibleGroups: { center: Position; radius: number }[] = [];
  for (const hub of hubs.values()) {
    const at = cached.get(hub.id);
    const sides = ([-1, 1] as const).map((side) => ({
      side,
      points: packs
        .get(hub.id)!
        .get(side)!
        .leaves.map((leaf) => cached.get(leaf.node.id))
        .filter((point): point is Position => !!point),
    }));
    const directions: Position[] = [];
    if (at)
      for (const neighbor of neighbors.get(hub.id)!) {
        const point = cached.get(neighbor.bridge.node.id);
        if (!point) continue;
        directions.push(scaled(subtract(point, at), neighbor.side));
        // An opened remote transaction promotes an existing terminal to a bridge.
        // Include that observation in the old side's established geometry.
        if (!cached.has(neighbor.id))
          sides.find((item) => item.side === neighbor.side)!.points.push(point);
      }
    frames.set(
      hub.id,
      flowFrame(at ? inferredAxis(at, sides, directions, flat) : { x: 1, y: 0, z: 0 }, flat),
    );
    for (const side of sides)
      if (side.points.length >= 3) {
        const center = sideCenter(side.points, flat);
        visibleGroups.push({
          center,
          radius:
            Math.max(
              ...side.points.map((point) =>
                Math.hypot(point.x - center.x, point.y - center.y, flat ? 0 : point.z - center.z),
              ),
            ) +
            cellSize / 2,
        });
      }
  }
  const placedHubs = new Set([...hubs.keys()].filter((id) => positions.has(id)));
  const savedHubs = new Set(placedHubs);
  const localHubs = new Set(placedHubs);
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
    let distance = radius(hub) + radius(byId.get(anchorId)!) + 24;
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
      localHubs.add(hub.id);
    }
  }
  const siblingFans = new Map<string, ReturnType<typeof roundedFootprint>>();
  let componentY = 0;
  while (placedHubs.size < hubs.size) {
    const queue = [...placedHubs].sort(compare);
    if (!queue.some((id) => neighbors.get(id)!.some((next) => !placedHubs.has(next.id)))) {
      const root = [...hubs.values()]
        .filter((hub) => !placedHubs.has(hub.id))
        .sort(
          (a, b) => incident.get(b.id)!.length - incident.get(a.id)!.length || compare(a.id, b.id),
        )[0];
      while (
        !occupancy.free({ x: 0, y: componentY, z: 0 }, radius(root)) ||
        !groupFree(root.id, { x: 0, y: componentY, z: 0 })
      )
        componentY += 40;
      put(root.id, { x: 0, y: componentY, z: 0 });
      placedHubs.add(root.id);
      queue.push(root.id);
      componentY +=
        Math.max(...[...packs.get(root.id)!.values()].map((pack) => pack.radius)) * 2 + 80;
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i],
        current = positions.get(id)!;
      const fresh = neighbors
        .get(id)!
        .filter((next) => !placedHubs.has(next.id))
        .filter((next, index, all) => all.findIndex((other) => other.id === next.id) === index);
      for (let index = 0; index < fresh.length; index++) {
        const next = fresh[index],
          ownPack = packs.get(id)!.get(next.side)!,
          otherPack = packs.get(next.id)!.get(next.side === 1 ? -1 : 1)!;
        const span =
          ownPack.outer + otherPack.outer + bridgeGap(next.bridge.source, next.bridge.target);
        const siblings = fresh.filter((other) => other.side === next.side);
        const lane =
          (siblings.indexOf(next) - (siblings.length - 1) / 2) *
          (Math.max(ownPack.radius, otherPack.radius) * 2 + 24);
        // Bulk expansion can introduce both the connecting outpoint and its hub.
        // Carry the visible branch frame through that path too; fresh components
        // still use the common world-X skeleton below.
        let fan: Position | undefined;
        if (!flat && !localHubs.has(id) && siblings.length >= 3) {
          const key = JSON.stringify([id, next.side]);
          let rounded = siblingFans.get(key);
          if (!rounded) {
            const spacing = Math.max(
              ...siblings.map(
                (sibling) =>
                  Math.max(
                    radius(hubs.get(sibling.id)!),
                    ...[...packs.get(sibling.id)!.values()].map((pack) => pack.radius),
                  ) *
                    2 +
                  24,
              ),
            );
            rounded = roundedFootprint(siblings.length, spacing);
            siblingFans.set(key, rounded);
          }
          const at = rounded.points[siblings.indexOf(next)];
          fan = {
            x: Math.sqrt(Math.max(0, rounded.radius ** 2 - at.x ** 2 - at.y ** 2)),
            y: at.x,
            z: at.y,
          };
        }
        const point = localHubs.has(id)
          ? worldPoint(frames.get(id)!, current, { x: next.side * span, y: lane, z: 0 })
          : {
              x: current.x + next.side * (span + (fan?.x ?? 0)),
              y: current.y + (fan?.y ?? lane),
              z: flat ? 0 : current.z + (fan?.z ?? 0),
            };
        if (localHubs.has(id)) {
          frames.set(next.id, flowFrame(scaled(subtract(point, current), next.side), flat));
          localHubs.add(next.id);
        }
        put(next.id, point);
        placedHubs.add(next.id);
        queue.push(next.id);
      }
    }
  }
  // Reconnection can join unequal path lengths. Fresh components use directed
  // topological constraints; undirected discovery order is only an initial seed.
  const checked = new Set<string>();
  const settled = new Set(savedHubs);
  for (const start of [...hubs.keys()].sort(compare)) {
    if (checked.has(start)) continue;
    const component = [start];
    checked.add(start);
    for (let i = 0; i < component.length; i++)
      for (const next of neighbors.get(component[i])!) {
        if (!checked.has(next.id)) {
          checked.add(next.id);
          component.push(next.id);
        }
      }
    if (component.some((id) => savedHubs.has(id))) {
      for (const id of component) settled.add(id);
      continue;
    }
    const children = new Map(component.map((id) => [id, new Set<string>()]));
    const parents = new Map(component.map((id) => [id, new Set<string>()]));
    for (const id of component)
      for (const next of neighbors.get(id)!)
        if (next.side === 1) {
          children.get(id)!.add(next.id);
          parents.get(next.id)!.add(id);
        }
    const counts = new Map(component.map((id) => [id, parents.get(id)!.size]));
    const order = component.filter((id) => !counts.get(id)).sort(compare);
    for (let i = 0; i < order.length; i++)
      for (const id of children.get(order[i])!) {
        counts.set(id, counts.get(id)! - 1);
        if (!counts.get(id)) order.push(id);
      }
    // Cyclic or malformed render hints retain their finite initial placement.
    if (order.length !== component.length) {
      for (const id of component) settled.add(id);
      continue;
    }
    for (const id of order) {
      const point = { ...positions.get(id)! };
      for (const parent of parents.get(id)!)
        point.x = Math.max(
          point.x,
          positions.get(parent)!.x +
            packs.get(parent)!.get(1)!.outer +
            packs.get(id)!.get(-1)!.outer +
            bridgeGap(parent, id),
        );
      const lane = Math.max(
        24,
        ...[...packs.get(id)!.values()].map((pack) => pack.radius * 2 + 16),
      );
      const initialY = point.y;
      for (let attempt = 0; !groupFree(id, point, settled) && attempt < 200; attempt++)
        point.y = initialY + (attempt % 2 ? -1 : 1) * (Math.floor(attempt / 2) + 1) * lane;
      positions.set(id, point);
      settled.add(id);
    }
  }
  // Discard tentative skeleton occupancy before attaching its glyphs.
  occupancy = new Occupancy(cellSize, flat);
  for (const node of nodes)
    if (positions.has(node.id)) occupancy.add(positions.get(node.id)!, radius(node));
  // A bridge is a single canonical outpoint on the transaction connection.
  for (const peers of bridgeGroups.values()) {
    const source = positions.get(peers[0].source)!,
      target = positions.get(peers[0].target)!;
    const pitch = Math.max(...peers.map((peer) => radius(peer.node))) * 2 + 3;
    if (!flat && peers.length >= 3) {
      const delta = subtract(target, source),
        length = Math.hypot(delta.x, delta.y, delta.z);
      const frame = flowFrame(delta, false);
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
        const depth =
          Math.sqrt(Math.max(0, shellRadius * shellRadius - x * x - y * y)) * (i % 2 ? -1 : 1);
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
    const columns = Math.ceil(Math.sqrt(peers.length)),
      rows = Math.ceil(peers.length / columns);
    const transverse = (columns - 1) * pitch >= Math.abs(target.x - source.x) - 12;
    for (let i = 0; i < peers.length; i++) {
      const bridge = peers[i];
      if (positions.has(bridge.node.id)) continue;
      const column = ((i % columns) - (columns - 1) / 2) * pitch,
        row = (Math.floor(i / columns) - (rows - 1) / 2) * pitch;
      const point = {
        x: (source.x + target.x) / 2 + (transverse ? 0 : column),
        y: (source.y + target.y) / 2 + row + (transverse && flat ? column * rows : 0),
        z: flat ? 0 : (source.z + target.z) / 2 + (transverse ? column : 0),
      };
      for (let attempt = 0; !occupancy.free(point, radius(bridge.node)) && attempt < 100; attempt++)
        point.y += pitch;
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
