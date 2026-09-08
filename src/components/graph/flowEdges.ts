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

/** Screen-space ribbons and arrowheads. Camera movement only changes uniforms/matrices,
 * never reconstructs edge buffers. Each observation retains its own instance. */
export function makeFlowEdges() {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 1, -1, 1,
      ]),
      3,
    ),
  );
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { viewport: { value: new Vector2(1, 1) } },
    vertexShader: `attribute vec3 start; attribute vec3 end; attribute vec3 tint;
      attribute vec4 style; attribute float progress; uniform vec2 viewport; varying vec4 color;
      void main(){
        vec4 av=modelViewMatrix*vec4(start,1.); vec4 bv=modelViewMatrix*vec4(end,1.);
        vec4 a=projectionMatrix*av; vec4 b=projectionMatrix*bv;
        vec2 ap=a.xy/a.w*viewport*.5; vec2 bp=b.xy/b.w*viewport*.5;
        vec2 delta=bp-ap; float len=max(length(delta),.001); vec2 dir=delta/len;
        vec2 side=vec2(-dir.y,dir.x);
        float ar=style.x*projectionMatrix[1][1]*viewport.y*.5/max(.1,-av.z);
        float br=style.y*projectionMatrix[1][1]*viewport.y*.5/max(.1,-bv.z);
        float trimA=min(ar,len*.3); float trimB=min(br,len*.3);
        vec2 from=ap+dir*trimA; vec2 to=bp-dir*trimB;
        float available=max(0.,len-trimA-trimB);
        float arrow=style.w>0.?min(max(5.,style.w),available*.35):0.;
        float t=position.x; vec2 p;
        if(position.z<.5){p=mix(from,to,t)+side*position.y*(style.z>0.?.55+style.z*.5:.5);}
        else {t=progress;vec2 tip=mix(from,to,t);p=tip-dir*position.x*arrow+side*position.y*arrow*.48;}
        vec4 clip=mix(a,b,t); clip.xy=p/viewport*2.*clip.w;
        if(av.z>=0.||bv.z>=0.)clip=vec4(2.,2.,2.,1.);
        gl_Position=clip; color=vec4(tint,position.z>.5?(style.z>0.?.72:.60):(style.z>0.?mix(.10,.70,style.z):.22));
      }`,
    fragmentShader:
      `varying vec4 color; void main(){gl_FragColor=color; #include <colorspace_fragment> }`
        .replace('; #include', ';\n#include')
        .replace('> }', '>\n}'),
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  const update = (
    links: readonly RenderLink[],
    nodes: ReadonlyMap<string, RenderNode>,
    positions: ReadonlyMap<string, Position>,
    dimensions: 2 | 3,
  ) => {
    const degrees = new Map<string, number>();
    for (const l of links)
      for (const id of [l.source, l.target]) degrees.set(id, (degrees.get(id) ?? 0) + 1);
    const start: number[] = [],
      end: number[] = [],
      tint: number[] = [],
      style: number[] = [],
      progress: number[] = [];
    for (const l of links) {
      const a = positions.get(l.source),
        b = positions.get(l.target);
      if (!a || !b) continue;
      start.push(a.x, a.y, dimensions === 2 ? 0 : a.z);
      end.push(b.x, b.y, dimensions === 2 ? 0 : b.z);
      new Color(l.color).toArray(tint, tint.length);
      // Stable staggering avoids a solid wall of coincident arrows at dense hubs.
      let hash = 0;
      for (let i = 0; i < l.id.length; i++) hash = (hash * 31 + l.id.charCodeAt(i)) | 0;
      progress.push(0.46 + (Math.abs(hash) % 35) / 100);
      style.push(
        nodeBoundsRadius(nodes.get(l.source)!),
        nodeBoundsRadius(nodes.get(l.target)!),
        l.width > 0
          ? 1 / (1 + Math.max(degrees.get(l.source) ?? 0, degrees.get(l.target) ?? 0) / 24)
          : 0,
        l.arrowLength,
      );
    }
    if (
      geometry.getAttribute('start') &&
      geometry.getAttribute('start').array.length !== start.length
    )
      geometry.dispose();
    for (const [name, values, size] of [
      ['start', start, 3],
      ['end', end, 3],
      ['tint', tint, 3],
      ['style', style, 4],
      ['progress', progress, 1],
    ] as const) {
      const old = geometry.getAttribute(name);
      if (old && old.array.length === values.length) {
        old.array.set(values);
        old.needsUpdate = true;
      } else
        geometry.setAttribute(name, new InstancedBufferAttribute(new Float32Array(values), size));
    }
    geometry.instanceCount = start.length / 3;
  };
  return {
    mesh,
    update,
    resize: (w: number, h: number) => material.uniforms.viewport.value.set(w, h),
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
