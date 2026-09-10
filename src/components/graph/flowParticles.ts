import {
  BufferAttribute,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector2,
} from 'three';
import type { RenderLink, RenderNode } from './adapter';
import type { Position } from './flowLayout';
import { nodeBoundsRadius } from './cameraFraming';

export const FLOW_DOTS_PER_LINK = 4;
/** Desired total density, not an edge limit: larger scopes still animate every edge. */
export const FLOW_PARTICLE_TARGET = 400;

/** Adaptive density keeps large scopes readable without dropping chosen edges.
 * Only scope/geometry changes upload instances; animation advances one uniform
 * and leaves the static edge/arrow buffers untouched. */
export function makeFlowParticles() {
  let capacity = 4;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
      ]),
      3,
    ),
  );
  const attributes = [
    ['start', 3],
    ['end', 3],
    ['tint', 3],
    ['radii', 2],
    ['offset', 1],
  ] as const;
  const allocate = () => {
    for (const [name, size] of attributes)
      geometry.setAttribute(
        name,
        new InstancedBufferAttribute(new Float32Array(capacity * size), size),
      );
  };
  allocate();
  geometry.instanceCount = 0;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    uniforms: {
      viewport: { value: new Vector2(1, 1) },
      phase: { value: 0 },
      diameter: { value: 5 },
    },
    vertexShader: `attribute vec3 start; attribute vec3 end; attribute vec3 tint;
      attribute vec2 radii; attribute float offset; uniform float phase;
      uniform float diameter; uniform vec2 viewport; varying vec2 disc; varying vec3 color;
      void main(){
        float len=max(length(end-start),.001);
        float from=min(.3,radii.x/len); float to=1.-min(.3,radii.y/len);
        float t=mix(from,to,fract(phase+offset));
        vec4 view=modelViewMatrix*vec4(mix(start,end,t),1.);
        vec4 clip=projectionMatrix*view;
        clip.xy+=position.xy*diameter*2./viewport*clip.w;
        if(view.z>=0.)clip=vec4(2.,2.,2.,1.);
        gl_Position=clip;disc=position.xy*2.;color=tint;
      }`,
    fragmentShader: `varying vec2 disc;varying vec3 color;
      void main(){float r=length(disc);if(r>=1.)discard;
        gl_FragColor=vec4(color,1.-smoothstep(.78,1.,r));
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'flow-particles';
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  let signature = '',
    disposed = false;
  return {
    mesh,
    update(
      links: readonly RenderLink[],
      nodes: ReadonlyMap<string, RenderNode>,
      positions: ReadonlyMap<string, Position>,
      dimensions: 2 | 3,
    ) {
      const visible = links.filter(
        (link) =>
          positions.has(link.source) &&
          positions.has(link.target) &&
          nodes.has(link.source) &&
          nodes.has(link.target),
      );
      const dotsPerLink = Math.max(
        1,
        Math.min(
          FLOW_DOTS_PER_LINK,
          Math.floor(FLOW_PARTICLE_TARGET / Math.max(1, visible.length)),
        ),
      );
      const count = visible.length * dotsPerLink;
      const next = JSON.stringify([
        dimensions,
        visible.map((link) => [
          link.id,
          link.color,
          positions.get(link.source),
          positions.get(link.target),
          nodeBoundsRadius(nodes.get(link.source)!),
          nodeBoundsRadius(nodes.get(link.target)!),
        ]),
      ]);
      if (next === signature) return geometry.instanceCount;
      signature = next;
      if (count > capacity || (capacity > 4 && count < capacity / 4)) {
        // Release the previous GPU attributes before replacing their arrays.
        geometry.dispose();
        capacity = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
        allocate();
      }
      let instance = 0;
      for (const link of visible) {
        const a = positions.get(link.source)!,
          b = positions.get(link.target)!,
          color = new Color(link.color).lerp(new Color('#ffffff'), 0.25);
        let hash = 0;
        for (let i = 0; i < link.id.length; i++) hash = (hash * 31 + link.id.charCodeAt(i)) | 0;
        for (let dot = 0; dot < dotsPerLink; dot++, instance++) {
          geometry.getAttribute('start').setXYZ(instance, a.x, a.y, dimensions === 2 ? 0 : a.z);
          geometry.getAttribute('end').setXYZ(instance, b.x, b.y, dimensions === 2 ? 0 : b.z);
          geometry.getAttribute('tint').setXYZ(instance, color.r, color.g, color.b);
          geometry
            .getAttribute('radii')
            .setXY(
              instance,
              nodeBoundsRadius(nodes.get(link.source)!),
              nodeBoundsRadius(nodes.get(link.target)!),
            );
          geometry
            .getAttribute('offset')
            .setX(instance, dot / dotsPerLink + (Math.abs(hash) % 997) / 997 / dotsPerLink);
        }
      }
      geometry.instanceCount = instance;
      for (const name of ['start', 'end', 'tint', 'radii', 'offset']) {
        const attr = geometry.getAttribute(name) as InstancedBufferAttribute;
        attr.clearUpdateRanges();
        if (instance) attr.addUpdateRange(0, instance * attr.itemSize);
        attr.needsUpdate = true;
      }
      return instance;
    },
    advance(seconds: number) {
      material.uniforms.phase.value =
        (material.uniforms.phase.value + Math.max(0, Math.min(0.05, seconds)) * 0.22) % 1;
    },
    resize(width: number, height: number) {
      material.uniforms.viewport.value.set(Math.max(1, width), Math.max(1, height));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
