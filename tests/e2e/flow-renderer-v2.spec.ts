import type { RenderNode } from '../../src/components/graph/adapter';
import type { LayoutRequest, LayoutResult } from '../../src/components/graph/flowLayout';
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
let server: ViteDevServer, root: string;
const port = Number(process.env.CHAINGRAPH_GRAPH_TEST_PORT ?? 4184);
const origin = `http://127.0.0.1:${port}`;
test.beforeAll(async () => {
  await mkdir('artifacts', { recursive: true });
  root = await mkdtemp(path.resolve('artifacts/flow-fixture-'));
  await writeFile(
    path.join(root, 'index.html'),
    '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><div id="host" style="position:absolute;left:37px;top:83px;width:calc(100vw - 74px);height:calc(100vh - 140px);background:#111a20"></div><script type="module" src="/fixture.ts"></script>',
  );
  await writeFile(
    path.join(root, 'fixture.ts'),
    `
import {FlowRenderer} from '/@fs'+'';
`.replace(
      "'/@fs'+''",
      JSON.stringify(`/@fs${path.resolve('src/components/graph/FlowRenderer.ts')}`),
    ) +
      `
const host=document.getElementById('host');
const node=(id,shape,x,y,z,radius=5)=>({id,shape,x,y,z,radius,color:shape==='box'?'#e3a54f':shape==='sphere'?'#84c2ae':'#919fd1',highlight:false,text:id});
const initial={dimensions:3,background:'#111a20',nodes:[node('creating','box',-80,0,-24),node('output','sphere',0,0,0),node('spending','box',80,0,24),node('address','octahedron',0,65,0)],links:[{id:'create',source:'creating',target:'output',color:'#74818b',width:0,arrowLength:3.6},{id:'spend',source:'output',target:'spending',color:'#74818b',width:0,arrowLength:3.6},{id:'association',source:'output',target:'address',color:'#74818b',width:0,arrowLength:0}]};
let frame=structuredClone(initial);const snapshots=[],activity=[],selects=[],hovers=[],layouts=[];let errors=0,recovered=0;
let graph;const make=()=>new FlowRenderer(host,{snapshot:s=>snapshots.push(s),layout:s=>layouts.push(s),activity:a=>activity.push(a),hover:e=>hovers.push(e),select:e=>selects.push(e),dismiss:()=>{},error:()=>errors++,recovered:()=>recovered++});
graph=make();const resize=()=>{const r=host.getBoundingClientRect();graph.resize(r.width,r.height,30)};resize();
new ResizeObserver(resize).observe(host);
const freeze=f=>{f.nodes.forEach(Object.freeze);f.links.forEach(Object.freeze);Object.freeze(f.nodes);Object.freeze(f.links);return Object.freeze(f)};
graph.update(freeze(frame));
window.fixture={get graph(){return graph},snapshots,activity,selects,hovers,layouts,get errors(){return errors},get recovered(){return recovered},get frame(){return frame},update:f=>{frame=f;graph.update(freeze(f))},reset:()=>{graph.dispose();graph=make();resize();graph.update(freeze(frame))},project:id=>{const p=graph.positions.get(id);const n=graph.nodes.find(n=>n.id===id);const v=graph.project(p);const r=graph.canvas.getBoundingClientRect();return{x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2}},render:()=>graph.renderer.render(graph.scene,graph.camera)};
`,
  );
  server = await createServer({
    configFile: false,
    envDir: false,
    root,
    cacheDir: path.join(root, '.vite'),
    server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [process.cwd()] } },
  });
  await server.listen();
});
test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(origin);
  await expect(page.locator('canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.graph.positions.size))
    .toBe(4);
  await page.waitForTimeout(200);
  return errors;
}
const project = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).fixture.project(id), id);
const camera = (page: Page) =>
  page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.flushSnapshot();
    return f.snapshots.at(-1).camera;
  });
const geometry = (page: Page) =>
  page.evaluate(() =>
    [...(window as any).fixture.graph.positions].sort(([a], [b]) => a.localeCompare(b)),
  );

// Hold and replay worker messages at the browser boundary. This deliberately lets
// tests deliver callbacks after termination to verify the renderer rejects them.
async function controlLayoutWorkers(page: Page) {
  await page.addInitScript(() => {
    (window as any).layoutWorkers = [];
    class ControlledWorker {
      requests: LayoutRequest[] = [];
      terminateCount = 0;
      onmessage: ((event: MessageEvent<LayoutResult>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      constructor() {
        (window as any).layoutWorkers.push(this);
      }
      postMessage(request: LayoutRequest) {
        this.requests.push(structuredClone(request));
      }
      terminate() {
        this.terminateCount++;
      }
      reply(positions?: LayoutResult['positions']) {
        const request = this.requests.at(-1)!;
        const previous = new Map(request.previous);
        this.onmessage?.(
          new MessageEvent<LayoutResult>('message', {
            data: {
              revision: request.revision,
              positions:
                positions ??
                request.nodes.map((node, i) => [
                  node.id,
                  previous.get(node.id) ?? {
                    x: node.fx ?? node.x ?? 200 + i * 20,
                    y: node.fy ?? node.y ?? 30,
                    z: node.fz ?? node.z ?? 0,
                  },
                ]),
            },
          }),
        );
      }
    }
    (window as any).Worker = ControlledWorker;
  });
}
async function drag(page: Page, button: 'left' | 'right' = 'left') {
  const b = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.75, b.y + b.height * 0.8);
  await page.mouse.down({ button });
  await page.mouse.move(b.x + b.width * 0.75 - 90, b.y + b.height * 0.8 - 35, { steps: 10 });
  await page.mouse.up({ button });
  await page.waitForTimeout(500);
}

test('real node and line picking, pointer coordinates, silhouettes, directional arrows and bounded rendering', async ({
  page,
}) => {
  const errors = await open(page);
  const p = await project(page, 'output');
  await page.mouse.move(p.x, p.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.hovers.at(-1)?.hit?.id))
    .toBe('output');
  const bounds = (await page.locator('canvas').boundingBox())!;
  const event = await page.evaluate(() => (window as any).fixture.hovers.at(-1));
  expect(event.point.x).toBeCloseTo(p.x - bounds.x, 0);
  expect(event.point.y).toBeCloseTo(p.y - bounds.y, 0);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.selects.at(-1)?.hit?.id))
    .toBe('output');
  const a = await project(page, 'creating');
  await page.mouse.move((a.x + p.x) / 2, (a.y + p.y) / 2);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).fixture.hovers.at(-1).hit)).toBeUndefined();
  await page.mouse.click((a.x + p.x) / 2, (a.y + p.y) / 2);
  expect(await page.evaluate(() => (window as any).fixture.selects.at(-1).hit.id)).toBe('create');
  const rendered = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.render();
    const gl = f.graph.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 100) colored++;
    return {
      colored,
      draws: f.graph.renderer.info.render.calls,
      geometries: f.graph.renderer.info.memory.geometries,
      shapes: f.graph.batches.map(
        (b: { mesh: { geometry: { type: string } } }) => b.mesh.geometry.type,
      ),
    };
  });
  // Actual framebuffer difference catches winding/culling bugs that GPU instance
  // counts and line-only screenshots cannot detect.
  const arrowPixels = await page.evaluate(() => {
    const f = (window as any).fixture;
    const frame = f.frame;
    const gl = f.graph.renderer.getContext();
    const read = () => {
      f.render();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      return pixels;
    };
    const arrows = read();
    f.update({
      ...frame,
      links: frame.links.map((l: { arrowLength: number }) => ({ ...l, arrowLength: 0 })),
    });
    const lines = read();
    f.update(frame);
    let changed = 0;
    for (let i = 0; i < arrows.length; i += 4)
      if (
        Math.max(
          Math.abs(arrows[i] - lines[i]),
          Math.abs(arrows[i + 1] - lines[i + 1]),
          Math.abs(arrows[i + 2] - lines[i + 2]),
        ) > 8
      )
        changed++;
    return changed;
  });
  expect(arrowPixels).toBeGreaterThan(15);
  expect(rendered.colored).toBeGreaterThan(100);
  expect(rendered.draws).toBe(4);
  expect(rendered.shapes).toEqual(['BoxGeometry', 'SphereGeometry', 'OctahedronGeometry']);
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => (window as any).fixture.graph.raf)).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/flow-renderer-v2/controlled-shapes.png' });
});

test('orbit, pan, cursor zoom, Flat mode, focus and manual resize preserve geometry without drag selection', async ({
  page,
}) => {
  const errors = await open(page),
    positions = await geometry(page),
    initial = await camera(page);
  await drag(page);
  expect(await camera(page)).not.toEqual(initial);
  expect(await geometry(page)).toEqual(positions);
  expect(await page.evaluate(() => (window as any).fixture.selects)).toEqual([]);
  const edgeBuffersStable = await page.evaluate(() => {
    const graph = (window as any).fixture.graph;
    const buffer = graph.edges.mesh.geometry.getAttribute('start');
    const version = buffer.version;
    for (let i = 0; i < 12; i++) {
      graph.camera.position.x += 1;
      graph.renderer.render(graph.scene, graph.camera);
    }
    return graph.edges.mesh.geometry.getAttribute('start') === buffer && buffer.version === version;
  });
  expect(edgeBuffersStable).toBe(true);
  const beforePan = await camera(page);
  await drag(page, 'right');
  expect((await camera(page)).target).not.toEqual(beforePan.target);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({ ...f.frame, dimensions: 2 });
    f.graph.fit();
  });
  const p = await project(page, 'output');
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(600);
  const after = await project(page, 'output');
  expect(Math.hypot(after.x - p.x, after.y - p.y)).toBeLessThan(3);
  await drag(page);
  const manual = await camera(page);
  await page.setViewportSize({ width: 1100, height: 850 });
  expect(await camera(page)).toEqual(manual);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.focus('output');
  });
  expect((await camera(page)).target.x).toBeCloseTo(0, 1);
  expect(await geometry(page)).toEqual(positions);
  expect(errors).toEqual([]);
});

test('immutable style edits, filters, loaded parents, labels and legacy snapshots keep the same investigation', async ({
  page,
}) => {
  const errors = await open(page);
  await drag(page);
  const before = await camera(page),
    positions = await geometry(page);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({
      ...f.frame,
      nodes: f.frame.nodes.map((n: RenderNode) => ({
        ...n,
        text: n.id === 'output' ? '<img src=x onerror=alert(1)>\n#Savings' : n.text,
        selected: n.id === 'output',
        radius: n.id === 'output' ? 10 : n.radius,
      })),
    });
  });
  expect(await camera(page)).toEqual(before);
  expect(await geometry(page)).toEqual(positions);
  await expect(page.locator('.flow-node-caption.selected')).toContainText('<img');
  expect(await page.locator('img').count()).toBe(0);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.hidden = f.frame.nodes.find((n: RenderNode) => n.id === 'address');
    f.update({ ...f.frame, nodes: f.frame.nodes.filter((n: RenderNode) => n.id !== 'address') });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.graph.positions.size))
    .toBe(3);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({
      ...f.frame,
      nodes: [
        ...f.frame.nodes,
        f.hidden,
        { id: 'parent', shape: 'box', color: '#e3a54f', radius: 5, highlight: false },
      ],
      links: [
        ...f.frame.links,
        {
          id: 'parent-edge',
          source: 'parent',
          target: 'creating',
          color: '#74818b',
          width: 0,
          arrowLength: 3.6,
        },
      ],
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.graph.positions.size))
    .toBe(5);
  const expanded = new Map(await geometry(page));
  for (const [id, p] of positions) expect(expanded.get(id)).toEqual(p);
  expect(await camera(page)).toEqual(before);
  const snapshot = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.flushSnapshot();
    return f.snapshots.at(-1);
  });
  await page.evaluate((s) => {
    const f = (window as any).fixture;
    f.reset();
    f.graph.restoreSnapshot(s);
    f.graph.update({ ...f.frame });
  }, snapshot);
  await expect
    .poll(() => page.evaluate(() => (window as any).fixture.graph.positions.size))
    .toBe(5);
  expect(await camera(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('touch taps select, orbit and pinch never hover or accidentally select', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = await open(page);
  const p = await project(page, 'output');
  await page.touchscreen.tap(p.x, p.y);
  expect(await page.evaluate(() => (window as any).fixture.selects.at(-1)?.hit?.id)).toBe('output');
  expect(await page.evaluate(() => (window as any).fixture.hovers.length)).toBe(0);
  const before = await camera(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 180, y: 500 }],
  });
  for (let step = 1; step <= 8; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 180 - step * 5, y: 500 - step * 3 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  expect(await camera(page)).not.toEqual(before);
  expect(await page.evaluate(() => (window as any).fixture.selects.length)).toBe(1);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({ ...f.frame, dimensions: 2 });
  });
  const points = [
    { x: 100, y: 500 },
    { x: 220, y: 500 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 100 - i * 4, y: 500 - i * 3 },
        { x: 220 + i * 4, y: 500 - i * 3 },
      ],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  expect(await camera(page)).not.toEqual(before);
  expect(await page.evaluate(() => (window as any).fixture.selects.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).fixture.hovers.length)).toBe(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/flow-renderer-v2/mobile-gesture.png' });
  await context.close();
});

test('context recovery, repeated disposal and stale worker results cannot revive old geometry', async ({
  page,
}) => {
  const errors = await open(page);
  const before = await camera(page);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() =>
      (window as any).fixture.graph.renderer
        .getContext()
        .getExtension('WEBGL_lose_context')
        .loseContext(),
    );
    await expect.poll(() => page.evaluate(() => (window as any).fixture.recovered)).toBe(i + 1);
    expect(await camera(page)).toEqual(before);
  }
  await page.evaluate(() => {
    const f = (window as any).fixture;
    const graph = f.graph;
    graph.accept({ revision: graph.revision - 1, positions: [['stale', { x: 0, y: 0, z: 0 }]] });
  });
  expect(await page.evaluate(() => (window as any).fixture.graph.positions.has('stale'))).toBe(
    false,
  );
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window as any).fixture.reset());
    await expect
      .poll(() => page.evaluate(() => (window as any).fixture.graph.positions.size))
      .toBe(4);
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  await drag(page);
  const info = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.dispose();
    f.graph.dispose();
    return { geometries: f.graph.renderer.info.memory.geometries, active: f.activity.at(-1) };
  });
  expect(info.geometries).toBe(0);
  expect(info.active).toBe(false);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('hidden empty mount defers fit and known coordinates render without a worker', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).Worker = class {
      constructor() {
        throw new Error('Public worker unavailable fixture');
      }
    };
  });
  const errors = await open(page);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.dispose();
    f.update({ ...f.frame, nodes: [], links: [] });
    f.reset();
    f.graph.resize(0, 0);
    f.update({
      dimensions: 2,
      background: '#111a20',
      nodes: [
        {
          id: 'later',
          shape: 'sphere',
          radius: 6,
          color: '#84c2ae',
          highlight: false,
          x: 300,
          y: 200,
          z: 0,
        },
      ],
      links: [],
    });
  });
  await page.evaluate(() => {
    const f = (window as any).fixture;
    const r = f.graph.canvas.getBoundingClientRect();
    f.graph.resize(r.width, r.height);
  });
  const p = await project(page, 'later');
  const b = (await page.locator('canvas').boundingBox())!;
  expect(p.x).toBeGreaterThan(b.x + 20);
  expect(p.x).toBeLessThan(b.x + b.width - 20);
  expect(p.y).toBeGreaterThan(b.y + 20);
  expect(errors).toEqual([]);
});

test('disposing before initial layout does not replace automatic framing with an empty camera snapshot', async ({
  page,
}) => {
  await controlLayoutWorkers(page);
  await open(page);
  const result = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({
      ...f.frame,
      nodes: f.frame.nodes.map(({ x, y, z, ...node }: RenderNode) => node),
    });
    f.reset();
    f.snapshots.length = 0;
    const pending = Boolean(f.graph.pending);
    f.graph.dispose();
    const published = f.snapshots.length;
    f.reset();
    (window as any).layoutWorkers.at(-1).reply();
    f.graph.flushSnapshot();
    return { pending, published, snapshot: f.snapshots.at(-1) };
  });
  expect(result.pending).toBe(true);
  expect(result.published).toBe(0);
  expect(result.snapshot.nodes).toHaveLength(4);
  expect(result.snapshot.camera.position).not.toEqual({ x: 260, y: 140, z: 1000 });
});

test('an immediate checkpoint preserves the visible graph without completing a pending layout, and disposal rejects its reply', async ({
  page,
}) => {
  await controlLayoutWorkers(page);
  const errors = await open(page);
  await drag(page);
  const before = await camera(page);
  const visible = await geometry(page);
  const saved = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({
      ...f.frame,
      nodes: [
        ...f.frame.nodes,
        { id: 'arriving', shape: 'sphere', radius: 5, color: '#84c2ae', highlight: false },
      ],
      links: [
        ...f.frame.links,
        {
          id: 'new',
          source: 'spending',
          target: 'arriving',
          color: '#74818b',
          width: 0,
          arrowLength: 3.6,
        },
      ],
    });
    const worker = (window as any).layoutWorkers[0];
    const pendingBefore = Boolean(f.graph.pending);
    f.graph.flushSnapshot();
    const snapshot = f.snapshots.at(-1);
    const pendingAfter = Boolean(f.graph.pending);
    const busy = f.graph.canvas.getAttribute('aria-busy');
    const positions = [...f.graph.positions].sort(([a], [b]) => a.localeCompare(b));
    f.graph.dispose();
    const snapshotCount = f.snapshots.length;
    worker.reply([['late', { x: 0, y: 0, z: 0 }]]);
    return {
      pendingBefore,
      pendingAfter,
      busy,
      snapshot,
      positions,
      terminated: worker.terminateCount,
      late: f.graph.positions.has('late'),
      afterDispose: f.graph.positions.size,
      snapshotCount,
      afterLateSnapshotCount: f.snapshots.length,
    };
  });
  expect(saved.pendingBefore && saved.pendingAfter).toBe(true);
  expect(saved.busy).toBe('true');
  expect(saved.positions).toEqual(visible);
  expect(saved.snapshot.nodes).toHaveLength(4);
  expect(saved.snapshot.nodes.some((node: { id: string }) => node.id === 'arriving')).toBe(false);
  expect(saved.snapshot.camera).toEqual(before);
  expect(saved.terminated).toBe(1);
  expect(saved.late).toBe(false);
  expect(saved.afterDispose).toBe(0);
  expect(saved.afterLateSnapshotCount).toBe(saved.snapshotCount);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('repack removes old arrangements explicitly while dimensions and snapshots preserve return views', async ({
  page,
}) => {
  const errors = await open(page);
  await expect(page.getByLabel('Graph layout', { exact: true })).toHaveCount(0);
  const original = await geometry(page);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({ ...f.frame, nodes: f.frame.nodes.map(({ x, y, z, ...n }: RenderNode) => n) });
    f.graph.repack();
  });
  await expect.poll(() => page.evaluate(() => !(window as any).fixture.graph.pending)).toBe(true);
  const compact = await geometry(page);
  expect(compact).not.toEqual(original);
  await drag(page, 'right');
  const compactCamera = await camera(page);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({ ...f.frame, dimensions: 2 });
  });
  await expect.poll(() => page.evaluate(() => !(window as any).fixture.graph.pending)).toBe(true);
  const flat = await geometry(page);
  expect(flat.every(([, p]: [string, { z: number }]) => p.z === 0)).toBe(true);
  expect(flat).not.toEqual(compact);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({ ...f.frame, dimensions: 3 });
  });
  await expect.poll(() => geometry(page)).toEqual(compact);
  expect(await camera(page)).toEqual(compactCamera);
  const restored = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.flushSnapshot();
    const snapshot = f.snapshots.at(-1);
    f.reset();
    f.graph.restoreSnapshot(snapshot);
    f.graph.update(f.frame);
    f.graph.flushSnapshot();
    return { before: snapshot, after: f.snapshots.at(-1) };
  });
  expect(restored.after).toEqual(restored.before);
  const beforeZoom = await camera(page);
  await page.evaluate(() => (window as any).fixture.graph.zoom(0.8));
  expect((await camera(page)).target).toEqual(beforeZoom.target);
  expect((await camera(page)).position).not.toEqual(beforeZoom.position);
  expect(await geometry(page)).toEqual(compact);
  expect(errors).toEqual([]);
});

test('rapid expansions cancel obsolete workers, checkpoint the visible graph and retain GPU capacity when the latest result arrives', async ({
  page,
}) => {
  await controlLayoutWorkers(page);
  const errors = await open(page);
  const before = await camera(page);
  const result = await page.evaluate(() => {
    const f = (window as any).fixture;
    const g = f.graph;
    const buffers = g.batches.map((b: any) => b.mesh);
    const edges = g.edges.mesh.geometry.getAttribute('start');
    for (let i = 0; i < 3; i++)
      f.update({
        ...f.frame,
        nodes: [
          ...f.frame.nodes,
          { id: `new-${i}`, shape: 'sphere', radius: 5, color: '#84c2ae', highlight: false },
        ],
        links: [
          ...f.frame.links,
          {
            id: `edge-${i}`,
            source: 'output',
            target: `new-${i}`,
            color: '#74818b',
            width: 0,
            arrowLength: 3.6,
          },
        ],
      });
    const workers = (window as any).layoutWorkers;
    for (const worker of workers.slice(0, -1)) worker.reply([['obsolete', { x: 0, y: 0, z: 0 }]]);
    g.flushSnapshot();
    const pendingSnapshot = f.snapshots.at(-1);
    const pending = Boolean(g.pending);
    const latest = workers.at(-1);
    latest.reply();
    g.flushSnapshot();
    const settledSnapshot = f.snapshots.at(-1);
    const positions = [...g.positions];
    // Both a duplicate current reply and terminated-worker replies must be inert.
    latest.reply([['late', { x: 0, y: 0, z: 0 }]]);
    workers[0].reply([['obsolete', { x: 0, y: 0, z: 0 }]]);
    return {
      requestedSizes: workers.map((worker: any) =>
        worker.requests.map((r: LayoutRequest) => r.nodes.length),
      ),
      terminated: workers.map((worker: any) => worker.terminateCount),
      pending,
      pendingSnapshot,
      settledSnapshot,
      positions,
      afterLatePositions: [...g.positions],
      busy: g.canvas.getAttribute('aria-busy'),
      status: f.layouts.at(-1),
      stableNodes: buffers.every((b: any, i: number) => g.batches[i].mesh === b),
      edgeCapacity: g.edges.mesh.geometry.getAttribute('start').count,
      oldEdgeCapacity: edges.count,
    };
  });
  expect(result.requestedSizes).toEqual([[5], [6], [7]]);
  expect(result.terminated).toEqual([1, 1, 0]);
  expect(result.pending).toBe(true);
  expect(result.pendingSnapshot.nodes).toHaveLength(4);
  expect(result.pendingSnapshot.camera).toEqual(before);
  expect(result.settledSnapshot.nodes).toHaveLength(7);
  expect(result.settledSnapshot.camera).toEqual(before);
  expect(result.positions.map(([id]: [string]) => id).sort()).toEqual([
    'address',
    'creating',
    'new-0',
    'new-1',
    'new-2',
    'output',
    'spending',
  ]);
  expect(result.afterLatePositions).toEqual(result.positions);
  expect(result.busy).toBe('false');
  expect(result.status).toEqual({ busy: false, nodeCount: 7 });
  expect(result.stableNodes).toBe(true);
  expect(result.oldEdgeCapacity).toBe(4);
  expect(result.edgeCapacity).toBe(8);
  expect(errors).toEqual([]);
});

test('dense incremental expansion keeps the camera, fixed nodes and allocated GPU buffers', async ({
  page,
}, info) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    const nodes = Array.from({ length: 1500 }, (_, i) => ({
      id: `dense-${i}`,
      shape: i % 4 ? 'sphere' : 'box',
      radius: 3.2,
      color: '#84c2ae',
      highlight: false,
      x: (i % 25) * 18,
      y: (Math.floor(i / 25) % 20) * 18,
      z: Math.floor(i / 500) * 18,
    }));
    const links = nodes.slice(1).map((n, i) => ({
      id: `dense-edge-${i}`,
      source: nodes[i].id,
      target: n.id,
      color: '#74818b',
      width: 0,
      arrowLength: 3.6,
    }));
    f.update({ ...f.frame, nodes, links });
  });
  await expect.poll(() => page.evaluate(() => !(window as any).fixture.graph.pending)).toBe(true);
  const before = await camera(page);
  const measurement = await page.evaluate(async () => {
    const f = (window as any).fixture,
      g = f.graph;
    const meshes = g.batches.map((b: any) => b.mesh),
      edges = g.edges.mesh.geometry.getAttribute('start');
    const fixed = new Map(g.positions),
      start = performance.now();
    f.update({
      ...f.frame,
      nodes: [
        ...f.frame.nodes,
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `added-${i}`,
          shape: 'sphere',
          radius: 3.2,
          color: '#e3a54f',
          highlight: false,
        })),
      ],
      links: [
        ...f.frame.links,
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `added-edge-${i}`,
          source: `dense-${i}`,
          target: `added-${i}`,
          color: '#74818b',
          width: 0,
          arrowLength: 3.6,
        })),
      ],
    });
    await new Promise<void>((resolve) => {
      const ready = () => (g.pending ? requestAnimationFrame(ready) : resolve());
      ready();
    });
    const elapsed = performance.now() - start;
    f.render();
    return {
      elapsed,
      nodes: g.positions.size,
      links: g.links.length,
      fixed: [...fixed].every(
        ([id, p]) => JSON.stringify(g.positions.get(id)) === JSON.stringify(p),
      ),
      meshes: meshes.every((mesh: any, i: number) => mesh === g.batches[i].mesh),
      edges: edges === g.edges.mesh.geometry.getAttribute('start'),
      draws: g.renderer.info.render.calls,
    };
  });
  expect(measurement.nodes).toBe(1512);
  expect(measurement.links).toBe(1511);
  expect(measurement.fixed && measurement.meshes && measurement.edges).toBe(true);
  expect(await camera(page)).toEqual(before);
  const observationPath = info.outputPath('incremental-browser-observation.json');
  await writeFile(observationPath, JSON.stringify(measurement, null, 2));
  await info.attach('incremental-browser-observation.json', {
    path: observationPath,
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});

for (const manual of [false, true])
  test(`isolated address focus waits for its frame and final layout, manual gesture=${manual}`, async ({
    page,
  }) => {
    await controlLayoutWorkers(page);
    const errors = await open(page);
    const originalCamera = await camera(page);
    await page.evaluate(() => {
      const f = (window as any).fixture,
        g = f.graph;
      // The controlled worker holds its reply through frame arrival and manual input.
      g.focus('isolated');
      f.update({
        ...f.frame,
        nodes: [
          ...f.frame.nodes,
          {
            id: 'isolated',
            shape: 'octahedron',
            radius: 5,
            color: '#919fd1',
            highlight: false,
            selected: true,
          },
        ],
      });
    });
    await expect(page.locator('canvas')).toHaveAttribute('aria-busy', 'true');
    expect(await geometry(page)).toHaveLength(4);
    expect(await camera(page)).toEqual(originalCamera);
    if (manual) await drag(page);
    const pose = await page.evaluate(() => {
      const f = (window as any).fixture,
        g = f.graph;
      const cameraBefore = g.cameraRecord();
      const worker = (window as any).layoutWorkers[0];
      worker.reply([...g.positions, ['isolated', { x: 5000, y: 2000, z: -500 }]]);
      g.flushSnapshot();
      return { before: cameraBefore, after: f.snapshots.at(-1).camera };
    });
    await expect(page.locator('canvas')).toHaveAttribute('aria-busy', 'false');
    expect(await geometry(page)).toHaveLength(5);
    if (manual) expect(pose.after).toEqual(pose.before);
    else {
      expect(pose.after).not.toEqual(originalCamera);
      const p = await project(page, 'isolated'),
        b = (await page.locator('canvas').boundingBox())!;
      expect(p.x).toBeGreaterThan(b.x + 20);
      expect(p.x).toBeLessThan(b.x + b.width - 20);
      expect(p.y).toBeGreaterThan(b.y + 30);
      expect(p.y).toBeLessThan(b.y + b.height - 20);
      await page.waitForTimeout(1600);
      expect(await camera(page)).toEqual(pose.after);
      expect(await project(page, 'isolated')).toEqual(p);
    }
    expect(errors).toEqual([]);
  });
