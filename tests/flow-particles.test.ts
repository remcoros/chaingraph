import { InstancedBufferAttribute } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { RenderLink, RenderNode } from '../src/components/graph/adapter';
import {
  FLOW_DOTS_PER_LINK,
  FLOW_PARTICLE_TARGET,
  makeFlowParticles,
} from '../src/components/graph/flowParticles';
import { makeEdgePickIndex } from '../src/components/graph/flowEdgePicking';
const link = (
  id: string,
  source: string,
  target: string,
  directed = true,
  flowSide: RenderLink['flowSide'] = 'outgoing',
): RenderLink => ({
  id,
  source,
  target,
  directed,
  flowSide,
  color: '#88aacc',
  width: 1,
  arrowLength: 4,
});
const node = (id: string): RenderNode => ({
  id,
  shape: 'sphere',
  radius: 4,
  color: '#88aacc',
  highlight: false,
});

describe('adaptive flow particle density', () => {
  it.each([
    [20, 4],
    [110, 3],
    [150, 2],
    [350, 1],
    [650, 1],
  ] as const)(
    'animates every one of %d chosen visible edges at %d dots per edge',
    (edgeCount, dotsPerEdge) => {
      const particles = makeFlowParticles();
      const nodes = new Map([['source', node('source')]]),
        positions = new Map([['source', { x: 0, y: 0, z: 0 }]]);
      const links: RenderLink[] = [];
      for (let i = 0; i < edgeCount; i++) {
        const id = `target-${i}`;
        nodes.set(id, node(id));
        positions.set(id, { x: i + 1, y: 20, z: 40 });
        links.push(link(`edge-${i}`, 'source', id));
      }
      // Missing endpoints must not consume density or truncate valid edges.
      links.unshift(link('not-displayed', 'missing', 'source'));
      const count = particles.update(links, nodes, positions, 3);
      expect(count).toBe(edgeCount * dotsPerEdge);
      const end = particles.mesh.geometry.getAttribute('end');
      expect(new Set(Array.from({ length: count }, (_, i) => end.getX(i))).size).toBe(edgeCount);
      expect(end.count).toBeGreaterThanOrEqual(count);
      expect(end.count).toBeLessThan(count * 2);
      expect(Math.log2(end.count) % 1).toBe(0);
      if (edgeCount <= FLOW_PARTICLE_TARGET)
        expect(count).toBeLessThanOrEqual(FLOW_PARTICLE_TARGET);
      else expect(count).toBe(edgeCount);
      particles.dispose();
    },
  );

  it('grows GPU capacity without omitting edges, reuses it for ticks, and releases a large previous scope', () => {
    const particles = makeFlowParticles(),
      geometry = particles.mesh.geometry;
    const nodes = new Map([
        ['a', node('a')],
        ['b', node('b')],
      ]),
      positions = new Map([
        ['a', { x: 0, y: 0, z: 8 }],
        ['b', { x: 100, y: 50, z: 12 }],
      ]);
    const links = Array.from({ length: 650 }, (_, i) => link(`edge-${i}`, 'a', 'b'));
    expect(particles.update(links.slice(0, 20), nodes, positions, 3)).toBe(20 * FLOW_DOTS_PER_LINK);
    const small = geometry.getAttribute('start');
    expect(particles.update(links, nodes, positions, 3)).toBe(650);
    const start = geometry.getAttribute('start') as InstancedBufferAttribute,
      version = start.version;
    expect(start).not.toBe(small);
    expect(start.count).toBe(1024);
    expect(particles.mesh.material.uniforms.diameter.value).toBe(5);
    particles.resize(900, 600);
    expect(particles.mesh.material.uniforms.viewport.value.toArray()).toEqual([900, 600]);
    const phase = particles.mesh.material.uniforms.phase.value;
    particles.advance(30);
    expect(particles.mesh.material.uniforms.phase.value - phase).toBeCloseTo(0.011);
    expect(start.version).toBe(version);
    particles.update(links, nodes, positions, 3);
    expect(start.version).toBe(version);
    expect(geometry.getAttribute('start')).toBe(start);
    particles.update([links[0]], nodes, positions, 2);
    expect(geometry.instanceCount).toBe(4);
    expect(geometry.getAttribute('start').count).toBe(4);
    expect(geometry.getAttribute('start').getZ(0)).toBe(0);
    expect(geometry.getAttribute('end').getZ(0)).toBe(0);
    const offsets = geometry.getAttribute('offset');
    expect(offsets.getX(1) - offsets.getX(0)).toBeCloseTo(0.25);
    expect(offsets.getX(3) - offsets.getX(0)).toBeCloseTo(0.75);
    particles.update([], nodes, positions, 3);
    expect(geometry.instanceCount).toBe(0);
    const disposeGeometry = vi.spyOn(geometry, 'dispose'),
      disposeMaterial = vi.spyOn(particles.mesh.material, 'dispose');
    particles.dispose();
    particles.dispose();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });
});

describe('cached edge hover candidates', () => {
  it('picks directed and association segments locally with a five-pixel hit margin', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0, z: 0 }],
      ['b', { x: 900, y: 600, z: 0 }],
      ['c', { x: 100, y: 400, z: 0 }],
      ['d', { x: 400, y: 400, z: 0 }],
      ['behind', { x: 400, y: 200, z: 2 }],
    ]);
    const pick = makeEdgePickIndex(
      [
        link('diagonal', 'a', 'b'),
        link('association', 'c', 'd', false),
        link('clipped', 'a', 'behind'),
      ],
      positions,
      900,
      600,
    );
    expect(pick(450, 300)).toBe('diagonal');
    expect(pick(220, 403)).toBe('association');
    expect(pick(220, 406)).toBeUndefined();
    expect(pick(200, 100)).toBeUndefined();
  });

  it('clips enormous offscreen segments and still finds them across grid boundaries', () => {
    const positions = new Map([
      ['a', { x: -1e12, y: 48, z: 0 }],
      ['b', { x: 1e12, y: 48, z: 0 }],
      ['c', { x: -100, y: -100, z: 0 }],
      ['d', { x: -10, y: -10, z: 0 }],
    ]);
    const pick = makeEdgePickIndex(
      [link('crossing', 'a', 'b'), link('outside', 'c', 'd')],
      positions,
      900,
      600,
    );
    for (const x of [0, 47, 48, 49, 500, 899]) expect(pick(x, 52)).toBe('crossing');
    expect(pick(450, 54)).toBeUndefined();
  });
});
