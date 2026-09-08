import type { RenderNode } from '../../src/components/graph/adapter';
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
let frame=structuredClone(initial);const snapshots=[],activity=[],selects=[],hovers=[];let errors=0,recovered=0;
let graph;const make=()=>new FlowRenderer(host,{snapshot:s=>snapshots.push(s),activity:a=>activity.push(a),hover:e=>hovers.push(e),select:e=>selects.push(e),dismiss:()=>{},error:()=>errors++,recovered:()=>recovered++});
graph=make();const resize=()=>{const r=host.getBoundingClientRect();graph.resize(r.width,r.height,30)};resize();
new ResizeObserver(resize).observe(host);
const freeze=f=>{f.nodes.forEach(Object.freeze);f.links.forEach(Object.freeze);Object.freeze(f.nodes);Object.freeze(f.links);return Object.freeze(f)};
graph.update(freeze(frame));
window.fixture={get graph(){return graph},snapshots,activity,selects,hovers,get errors(){return errors},get recovered(){return recovered},get frame(){return frame},update:f=>{frame=f;graph.update(freeze(f))},reset:()=>{graph.dispose();graph=make();resize();graph.update(freeze(frame))},project:id=>{const p=graph.positions.get(id);const n=graph.nodes.find(n=>n.id===id);const v=graph.project(p);const r=graph.canvas.getBoundingClientRect();return{x:r.x+(v.x+1)*r.width/2,y:r.y+(1-v.y)*r.height/2}},render:()=>graph.renderer.render(graph.scene,graph.camera)};
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
const geometry = (page: Page) => page.evaluate(() => [...(window as any).fixture.graph.positions]);
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

test('hidden empty mount defers fit and unavailable workers retain the same fallback layout', async ({
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
    f.frame = { ...f.frame, nodes: [], links: [] };
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

test('an immediate checkpoint completes pending layout and rejects its later worker reply', async ({
  page,
}) => {
  const errors = await open(page);
  await drag(page);
  const before = await camera(page);
  const saved = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.worker.terminate();
    // Leave a real adapter request pending as if the worker were busy at Lock.
    f.graph.worker = { postMessage() {}, terminate() {} };
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
    const pending = Boolean(f.graph.pending);
    f.graph.flushSnapshot();
    const snapshot = f.snapshots.at(-1);
    f.graph.accept({ revision: f.graph.revision, positions: [['late', { x: 0, y: 0, z: 0 }]] });
    return { pending, snapshot, late: f.graph.positions.has('late') };
  });
  expect(saved.pending).toBe(true);
  expect(saved.snapshot.nodes).toHaveLength(5);
  expect(saved.snapshot.camera).toEqual(before);
  expect(saved.late).toBe(false);
  expect(errors).toEqual([]);
});

test('layout choices are reversible, dimension-specific, keyboard accessible and snapshot compatible', async ({
  page,
}) => {
  const errors = await open(page);
  await page.evaluate(() => {
    const f = (window as any).fixture;
    f.update({ ...f.frame, nodes: f.frame.nodes.map(({ x, y, z, ...n }: RenderNode) => n) });
  });
  const select = page.getByLabel('Graph layout', { exact: true });
  await expect(select).toHaveValue('compact');
  await select.selectOption('directed');
  await expect.poll(() => page.evaluate(() => !(window as any).fixture.graph.pending)).toBe(true);
  const directed = await geometry(page);
  await drag(page);
  const directedCamera = await camera(page);
  await select.focus();
  await page.keyboard.press('ArrowUp');
  await expect(select).toHaveValue('compact');
  await expect.poll(() => page.evaluate(() => !(window as any).fixture.graph.pending)).toBe(true);
  const compact = await geometry(page);
  expect(compact).not.toEqual(directed);
  await drag(page, 'right');
  const compactCamera = await camera(page);
  await select.selectOption('directed');
  await expect.poll(() => geometry(page)).toEqual(directed);
  expect(await camera(page)).toEqual(directedCamera);
  await select.selectOption('compact');
  await expect.poll(() => geometry(page)).toEqual(compact);
  expect(await camera(page)).toEqual(compactCamera);
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
  await expect(select).toHaveValue('saved');
  await select.selectOption('directed');
  await expect.poll(() => page.evaluate(() => !(window as any).fixture.graph.pending)).toBe(true);
  await select.selectOption('saved');
  await expect.poll(() => geometry(page)).toEqual(compact);
  expect(await camera(page)).toEqual(compactCamera);
  expect(errors).toEqual([]);
});

test('rapid layout changes checkpoint the latest choice and discard obsolete worker results', async ({
  page,
}) => {
  const errors = await open(page);
  const result = await page.evaluate(() => {
    const f = (window as any).fixture;
    f.graph.worker.terminate();
    const requests: any[] = [];
    f.graph.worker = { postMessage: (r: any) => requests.push(r), terminate() {} };
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Graph layout"]')!;
    select.value = 'directed';
    select.dispatchEvent(new Event('change'));
    select.value = 'compact';
    select.dispatchEvent(new Event('change'));
    f.graph.accept({
      revision: requests[0].revision,
      positions: [['obsolete', { x: 0, y: 0, z: 0 }]],
    });
    const pending = f.graph.pending.strategy;
    f.graph.flushSnapshot();
    const snapshot = f.snapshots.at(-1);
    f.graph.accept({ revision: requests[1].revision, positions: [['late', { x: 0, y: 0, z: 0 }]] });
    return { pending, snapshot, positions: [...f.graph.positions] };
  });
  expect(result.pending).toBe('compact');
  expect(result.snapshot.nodes).toHaveLength(4);
  expect(result.positions.map(([id]: [string]) => id).sort()).toEqual([
    'address',
    'creating',
    'output',
    'spending',
  ]);
  expect(errors).toEqual([]);
});
