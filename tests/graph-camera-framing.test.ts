import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  frameCamera,
  nodeBoundsRadius,
} from '../src/App/Workspace/Workbenches/Graph/Renderer/cameraFraming';
import type { RenderNode } from '../src/App/Workspace/Workbenches/Graph/Renderer/adapter';

const node = (id: string, x: number, y: number, z: number, radius = 10): RenderNode => ({
  id,
  x,
  y,
  z,
  radius,
  shape: 'sphere',
  color: '#fff',
  highlight: false,
});
const options = {
  dimensions: 3 as const,
  position: { x: 0, y: 0, z: 600 },
  orbitTarget: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  fov: 50,
  width: 1000,
  height: 400,
  padding: 60,
};
function expectVisible(
  nodes: RenderNode[],
  opts: typeof options,
  pose: NonNullable<ReturnType<typeof frameCamera>>,
) {
  const camera = new PerspectiveCamera(opts.fov, opts.width / opts.height, 0.1, 1e8);
  camera.up.set(opts.up.x, opts.up.y, opts.up.z);
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateMatrixWorld();
  const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const backward = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
  for (const item of nodes) {
    const radius = nodeBoundsRadius(item);
    // Project enclosing camera-oriented cube corners, a conservative mesh bound.
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const point = new Vector3(item.x, item.y, item.z)
            .addScaledVector(right, x * radius)
            .addScaledVector(up, y * radius)
            .addScaledVector(backward, z * radius)
            .project(camera);
          expect(Math.abs(point.x)).toBeLessThanOrEqual(1 - (2 * opts.padding) / opts.width + 1e-8);
          expect(Math.abs(point.y)).toBeLessThanOrEqual(
            1 - (2 * opts.padding) / opts.height + 1e-8,
          );
          expect(point.z).toBeGreaterThan(-1);
          expect(point.z).toBeLessThan(1);
        }
  }
}

describe('camera framing for real geometry', () => {
  it.each([2, 3] as const)(
    'preserves zoom when centering away from the old target in %d dimensions',
    (dimensions) => {
      const position = dimensions === 2 ? { x: 10, y: 20, z: 800 } : options.position;
      const orbitTarget = dimensions === 2 ? { x: 10, y: 20, z: 0 } : options.orbitTarget;
      const before = new Vector3(position.x, position.y, position.z).sub(
        new Vector3(orbitTarget.x, orbitTarget.y, orbitTarget.z),
      );
      for (const radius of [3, 100]) {
        const selected = node('selected', 1500, 1200, 400, radius);
        const pose = frameCamera([selected], {
          ...options,
          dimensions,
          position,
          orbitTarget,
          target: { x: selected.x!, y: selected.y!, z: selected.z! },
          topInset: 90,
          rightInset: 140,
          nodeWidth: 24,
          preserveZoom: true,
        })!;
        const after = new Vector3(pose.position.x, pose.position.y, pose.position.z).sub(
          new Vector3(pose.target.x, pose.target.y, pose.target.z),
        );
        expect(after.distanceTo(before)).toBeLessThan(1e-8);
        const camera = new PerspectiveCamera(options.fov, options.width / options.height, 0.1, 1e8);
        camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
        camera.updateMatrixWorld();
        const p = new Vector3(selected.x, selected.y, dimensions === 2 ? 0 : selected.z).project(
          camera,
        );
        expect(((p.x + 1) * options.width) / 2).toBeCloseTo((60 + 1000 - 140) / 2);
        expect(((1 - p.y) * options.height) / 2).toBeCloseTo((90 + 400 - 60) / 2);
      }
    },
  );
  it.each(['sphere', 'box', 'octahedron'] as const)(
    'centers a %s at about 24 CSS pixels across viewport sizes and viewing angles',
    (shape) => {
      for (const radius of [3, 25])
        for (const height of [300, 900])
          for (const position of [options.position, { x: 500, y: 300, z: 800 }]) {
            const selected = { ...node('selected', 1000, -200, 400, radius), shape };
            const opts = { ...options, height, position, nodeWidth: 24 };
            const pose = frameCamera([selected], opts)!;
            const camera = new PerspectiveCamera(opts.fov, opts.width / opts.height, 0.1, 1e8);
            camera.position.set(pose.position.x, pose.position.y, pose.position.z);
            camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
            camera.updateMatrixWorld();
            const center = new Vector3(selected.x, selected.y, selected.z);
            const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const vertices: Vector3[] = [];
            if (shape === 'box') {
              for (const x of [-0.8, 0.8])
                for (const y of [-0.8, 0.8])
                  for (const z of [-0.8, 0.8]) vertices.push(new Vector3(x, y, z));
            } else if (shape === 'octahedron') {
              for (const sign of [-1.4, 1.4])
                vertices.push(
                  new Vector3(sign, 0, 0),
                  new Vector3(0, sign, 0),
                  new Vector3(0, 0, sign),
                );
            } else vertices.push(right.clone(), right.clone().negate());
            const projected = vertices.map((vertex) =>
              vertex.multiplyScalar(radius).add(center).project(camera),
            );
            const width =
              ((Math.max(...projected.map((p) => p.x)) - Math.min(...projected.map((p) => p.x))) *
                opts.width) /
              2;
            expect(width).toBeGreaterThan(21);
            expect(width).toBeLessThanOrEqual(25);
            expect(center.project(camera).length()).toBeLessThan(1);
          }
    },
  );
  it('reserves the right action rail without shifting node positions or orbit direction', () => {
    const nodes = [node('left', -120, 0, 0, 20), node('right', 120, 10, 30, 35)];
    const before = structuredClone(nodes);
    const opts = { ...options, width: 700, rightInset: 120 };
    const pose = frameCamera(nodes, opts)!;
    const camera = new PerspectiveCamera(opts.fov, opts.width / opts.height, 0.1, 1e8);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    for (const n of nodes)
      for (const dx of [-n.radius, n.radius])
        for (const dz of [-n.radius, n.radius]) {
          const p = new Vector3(n.x! + dx, n.y!, n.z! + dz).project(camera);
          const screenX = ((p.x + 1) * opts.width) / 2;
          expect(screenX).toBeGreaterThanOrEqual(opts.padding - 1e-7);
          expect(screenX).toBeLessThanOrEqual(opts.width - opts.rightInset + 1e-7);
        }
    expect(nodes).toEqual(before);
    expect(pose.position.x).toBe(pose.target.x);
    expect(pose.position.y).toBe(pose.target.y);
  });
  it('centers translated geometry and keeps the same useful framing distance', () => {
    const original = [node('a', -100, 0, 0), node('b', 100, 20, 0)];
    const shifted = original.map((item) => ({
      ...item,
      x: item.x! + 10000,
      y: item.y! - 5000,
      z: item.z! + 3000,
    }));
    const first = frameCamera(original, options)!;
    const second = frameCamera(shifted, options)!;
    expect(second.target).toEqual({ x: 10000, y: -4990, z: 3000 });
    expect(second.position.z - second.target.z).toBeCloseTo(first.position.z - first.target.z);
    expectVisible(shifted, options, second);
  });
  it('preserves orbit direction and fits a large foreground neighbor around the selected node', () => {
    const nodes = [
      node('selected', 1000, -200, 400, 12),
      { ...node('foreground', 1100, -180, 550, 20), shape: 'box' as const },
    ];
    const target = { x: 1000, y: -200, z: 400 };
    const pose = frameCamera(nodes, { ...options, target })!;
    expect(pose.position.x).toBe(target.x);
    expect(pose.position.y).toBe(target.y);
    expect(pose.position.z - target.z).toBeGreaterThan(180);
    expectVisible(nodes, options, pose);
  });
  it('accounts for a narrow viewport, short panel, field of view and tilted orbit direction', () => {
    const nodes = [node('a', -100, -30, 0), node('b', 100, 30, 0)];
    const broad = frameCamera(nodes, options)!;
    const narrowOptions = { ...options, width: 250 };
    const narrow = frameCamera(nodes, narrowOptions)!;
    expect(narrow.position.z).toBeGreaterThan(broad.position.z * 2);
    expectVisible(nodes, narrowOptions, narrow);
    const narrowLens = frameCamera(nodes, { ...options, fov: 25 })!;
    expect(narrowLens.position.z).toBeGreaterThan(broad.position.z);
    const tiltedOptions = { ...options, position: { x: 500, y: 300, z: 800 } };
    const tilted = frameCamera(nodes, tiltedOptions)!;
    expectVisible(nodes, tiltedOptions, tilted);
  });
  it('reserves navigation and actual caption bounds without wasting matching space below the graph', () => {
    const nodes = [node('upper', 0, 70, 0, 3.2), node('lower', 0, -70, 0, 3.2)];
    const captions = new Map([['upper', { width: 100, height: 20, offsetY: 15 }]]);
    const baseline = frameCamera(nodes, options)!;
    const pose = frameCamera(nodes, { ...options, topInset: 95, captions })!;
    const camera = new PerspectiveCamera(options.fov, options.width / options.height, 0.1, 1e8);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateMatrixWorld();
    for (const x of [-50, 50])
      for (const y of [75, 95]) {
        const projected = new Vector3(x, y, 0).project(camera);
        const top = ((1 - projected.y) * options.height) / 2;
        expect(top).toBeGreaterThanOrEqual(95 - 1e-8);
        expect(top).toBeLessThan(options.height - options.padding);
      }
    expect(pose.position.z).toBeLessThan(baseline.position.z * 1.5);
    // Removing the caption for the next Fit removes its framing allowance too.
    expect(frameCamera(nodes, { ...options, topInset: 95 })!.position.z).toBeLessThan(
      pose.position.z,
    );
    const tiny = frameCamera(nodes, {
      ...options,
      width: 120,
      height: 90,
      topInset: 200,
      captions,
    })!;
    expect(Object.values(tiny.position).every(Number.isFinite)).toBe(true);
    expect(tiny.position.z).toBeLessThan(5000);
  });
  it('looks down the flat graph and safely defers missing geometry or zero-size viewports', () => {
    const flat = frameCamera([node('a', 10, 20, 400)], { ...options, dimensions: 2 })!;
    expect(flat.target).toEqual({ x: 10, y: 20, z: 0 });
    expect(flat.position).toMatchObject({ x: 10, y: 20 });
    expect(flat.position.z).toBeGreaterThanOrEqual(40);
    expect(flat.position.z).toBeLessThan(50);
    expect(frameCamera([], options)).toBeUndefined();
    expect(frameCamera([node('invalid', NaN, 0, 0)], options)).toBeUndefined();
    expect(frameCamera([node('a', 0, 0, 0)], { ...options, width: 0 })).toBeUndefined();
    const degenerate = frameCamera([node('a', 0, 0, 0)], {
      ...options,
      position: options.orbitTarget,
      up: { x: 0, y: 0, z: 1 },
    })!;
    expect(Object.values(degenerate.position).every(Number.isFinite)).toBe(true);
  });
});
