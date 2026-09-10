import { captureGraphPixels, type SampledCanvas } from '../fixtures/graph-pixels';
import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

// A controlled geometry fixture exercises the real renderer and browser picking.
// It never reads workspace storage, user environment files, or a live node.
let fixtureRoot: string;
let server: ViteDevServer;
const port = Number(process.env.CHAINGRAPH_GRAPH_TEST_PORT ?? 4184);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('CHAINGRAPH_GRAPH_TEST_PORT must be an integer between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const outputId = `out:${'a'.repeat(64)}:0`;

test.beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'chaingraph-hover-'));
  await symlink(path.join(process.cwd(), 'node_modules'), path.join(fixtureRoot, 'node_modules'));
  await writeFile(
    path.join(fixtureRoot, 'index.html'),
    '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/main.jsx"></script>',
  );
  await writeFile(
    path.join(fixtureRoot, 'main.jsx'),
    `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Graph from ${JSON.stringify(`/@fs${path.join(process.cwd(), 'src/components/GraphView.tsx')}`)};
const a='a'.repeat(64), b='b'.repeat(64), address='bc1qfixture';
const captionFit = new URLSearchParams(location.search).has('caption-fit');
const nodes=Object.freeze([
 {id:'tx:'+a,kind:'transaction',txid:a,label:'Creating transaction',value:10000,x:-100,y:0,z:0,fx:-100,fy:0,fz:0},
 {id:'out:'+a+':0',kind:'output',txid:a,vout:0,label:'Fixture output',value:10000,address,x:0,y:captionFit?80:0,z:0,fx:0,fy:captionFit?80:0,fz:0},
 {id:'tx:'+b,kind:'transaction',txid:b,label:'Spending transaction',value:9000,x:100,y:0,z:0,fx:100,fy:0,fz:0},
 {id:'addr:'+address,kind:'address',address,label:'Fixture address',x:0,y:captionFit?0:80,z:0,fx:0,fy:captionFit?0:80,fz:0},
].map(Object.freeze));
const links=Object.freeze([
 {id:'create-edge',source:'tx:'+a,target:'out:'+a+':0',kind:'creates'},
 {id:'spend-edge',source:'out:'+a+':0',target:'tx:'+b,kind:'spends'},
 {id:'address-edge',source:'out:'+a+':0',target:'addr:'+address,kind:'address'},
].map(Object.freeze));
const transactions={ [a]:{txid:a,vin:[{coinbase:'00'}],vout:[{n:0,value:0.0001,scriptPubKey:{address}}],confirmations:2} };
const params=new URLSearchParams(location.search);
const contractFactory=(container,events)=>{
 const canvas=document.createElement('canvas');container.append(canvas);
 const calls={updates:0,fit:0,focus:[],sizes:[],disposed:false};
 window.contract={events,calls};
 return {canvas,update:frame=>{calls.updates++;calls.frame=frame},resize:(w,h)=>{canvas.width=w;canvas.height=h;calls.sizes.push([w,h])},focus:id=>calls.focus.push(id),fit:()=>calls.fit++,dispose:()=>{calls.disposed=true;canvas.remove()}};
};
function App(){const [selected,setSelected]=React.useState();const [action,setAction]=React.useState('none');
const [dimensions,setDimensions]=React.useState(2),[fit,setFit]=React.useState(0),[focus,setFocus]=React.useState();
const [loaded,setLoaded]=React.useState(!params.has('empty'));
const [shown,setShown]=React.useState(true),[hidden,setHidden]=React.useState(false),[busy,setBusy]=React.useState(false);
const [caption,setCaption]=React.useState('Followed output');
const [labels,setLabels]=React.useState(true),[tags,setTags]=React.useState(true),[icons,setIcons]=React.useState(true);
window.fixture={setCaption,setLoaded,setSelected,setShown,setHidden,setBusy,setLabels,setTags,setIcons};
return <><input id="notes" aria-label="Notes editor"/><output style={{display:"block",overflowWrap:"anywhere",height:36,overflow:"hidden"}} data-testid="action">{action}</output><output style={{display:"block",overflowWrap:"anywhere",height:36,overflow:"hidden"}} data-testid="selected">{selected||'none'}</output>
<div><button onClick={()=>setDimensions(d=>d===2?3:2)}>Toggle dimensions</button><button onClick={()=>setFit(n=>n+1)}>Fixture fit graph</button><button onClick={()=>setFocus({id:'out:'+a+':0',token:Date.now()})}>Focus output</button><button onClick={()=>setLoaded(true)}>Load data</button></div>
<div id="fixture-graph" style={{display:hidden?'none':undefined,position:'relative',height:'600px',width:'min(900px, 100%)','--color-paper':'#111a20','--color-muted':'#74818b','--color-accent':'#eab66b'}}>
{shown && <Graph navigation={params.has('contract')||params.has('navigation')||captionFit?<button style={{pointerEvents:'auto',height:captionFit?64:undefined,width:captionFit?420:undefined}} onClick={()=>setFocus({id:'out:'+a+':0',token:Date.now()})}>Shared center</button>:undefined} toolbar={params.has('contract')?<button onClick={()=>setFit(n=>n+1)}>Shared fit</button>:undefined} legend={params.has('contract')?<span style={{position:'absolute',bottom:0}}>Shared legend</span>:undefined} adapterFactory={params.has('contract')?contractFactory:undefined} nodes={loaded?nodes:[]} links={loaded?links:[]} transactions={transactions} selectedId={selected} onSelect={setSelected} dimensions={dimensions} sizeBy="uniform" glow={false} fitToken={fit} focusRequest={focus}
showLabels={labels} showTags={tags} showIcons={icons} nodePresentation={captionFit?new Map(nodes.map(node=>[node.id,{label:node.kind==='output'?caption:''}])):params.has('captions')?new Map(nodes.map(node=>[node.id,{label:node.kind==='output'?'Deposit':'',icon:node.kind==='output'?'★':'',tags:node.kind==='output'?['Exchange']:[]}])):new Map(nodes.map(node=>[node.id,{label:''}]))}
onSnapshot={snapshot=>{window.lastGraphSnapshot=snapshot}} busy={busy} onTrace={id=>setAction('trace:'+id)} onEdit={id=>{setAction('edit:'+id);document.getElementById('notes').focus();}}/>}
</div></>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`,
  );
  server = await createServer({
    configFile: false,
    root: fixtureRoot,
    cacheDir: path.join(fixtureRoot, '.vite'),
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      fs: { allow: [fixtureRoot, process.cwd()] },
    },
  });
  await server.listen();
});
test.afterAll(async () => {
  await server?.close();
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

async function render(page: Page, query = '') {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(origin + query);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(7000);
  return errors;
}

// Read the composited frame, including when the renderer has stopped drawing.
// Colors identify the visible meshes; interactions below still use mouse picking.
async function visibleMeshes(page: Page) {
  await captureGraphPixels(page.locator('canvas'));
  const bounds = await page.locator('canvas').boundingBox();
  if (!bounds) throw new Error('Missing graph canvas');
  const meshes = await page.locator('canvas').evaluate(
    (canvas) =>
      new Promise<Record<string, { x: number; y: number; taper: number }>>((resolve) =>
        requestAnimationFrame(() => {
          const { width, height, pixels } = (canvas as SampledCanvas).testPixels;
          const groups: Record<string, { xs: number[]; ys: number[] }> = {};
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4,
                r = pixels[i],
                g = pixels[i + 1],
                b = pixels[i + 2];
              if (Math.max(r, g, b) < 60) continue;
              // Address meshes are distinctly violet-blue. Muted flow arrows
              // must not enter the node silhouette or shift its picking center.
              const kind =
                r > g * 1.1 && r > b * 1.2
                  ? x < width / 2
                    ? 'creating'
                    : 'spending'
                  : g > r * 1.13 && g > b * 1.03
                    ? 'output'
                    : b > r * 1.3 && b > g * 1.23
                      ? 'address'
                      : undefined;
              if (!kind) continue;
              const group = (groups[kind] ??= { xs: [], ys: [] });
              group.xs.push(x);
              group.ys.push(y);
            }
          const results: Record<string, { x: number; y: number; taper: number }> = {};
          for (const [kind, group] of Object.entries(groups)) {
            const minX = Math.min(...group.xs),
              maxX = Math.max(...group.xs),
              minY = Math.min(...group.ys),
              maxY = Math.max(...group.ys);
            const rowWidth = (row: number) => {
              const xs = group.xs.filter((_x, i) => group.ys[i] === row);
              return xs.length ? Math.max(...xs) - Math.min(...xs) + 1 : 0;
            };
            results[kind] = {
              x: ((minX + maxX) / 2 / width) * canvas.clientWidth,
              y: ((height - 1 - (minY + maxY) / 2) / height) * canvas.clientHeight,
              taper:
                rowWidth(Math.round(minY + (maxY - minY) * 0.25)) /
                rowWidth(Math.round((minY + maxY) / 2)),
            };
          }
          resolve(results);
        }),
      ),
  );
  return Object.fromEntries(
    Object.entries(meshes).map(([kind, mesh]) => [
      kind,
      { ...mesh, x: bounds.x + mesh.x, y: bounds.y + mesh.y },
    ]),
  );
}

async function hover(page: Page, point: { x: number; y: number }) {
  await page.mouse.move(10, 10);
  // Exercise leaving the canvas and returning, including to the same object.
  await page.waitForTimeout(80);
  await page.mouse.move(point.x, point.y);
  await expect(page.getByRole('dialog', { name: 'Graph item details' })).toBeVisible();
}

test('frames a returning small graph promptly and preserves a manual pan through final settlement', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(origin);
  await expect(page.locator('canvas')).toBeVisible();
  // Returning before the initial layout settles remounts GraphView without a
  // saved snapshot, as switching between newly populated workspaces does.
  await page.evaluate(() => (window as any).fixture.setShown(false));
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.evaluate(() => (window as any).fixture.setShown(true));
  await expect(page.locator('canvas')).toBeVisible();
  await expect
    .poll(
      async () => {
        const meshes = await visibleMeshes(page);
        return meshes.creating && meshes.spending ? meshes.spending.x - meshes.creating.x : 0;
      },
      { timeout: 1500, intervals: [50, 100] },
    )
    .toBeGreaterThan(250);

  const framed = await visibleMeshes(page);
  const bounds = (await page.locator('canvas').boundingBox())!;
  const start = { x: bounds.x + bounds.width * 0.8, y: bounds.y + bounds.height * 0.8 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y - 25, { steps: 6 });
  await page.mouse.up();
  const panned = await visibleMeshes(page);
  expect(
    Math.hypot(panned.output.x - framed.output.x, panned.output.y - framed.output.y),
  ).toBeGreaterThan(20);
  // Covers the full 6s engine deadline: automatic final fit must not undo the pan.
  await page.waitForTimeout(6500);
  const settled = await visibleMeshes(page);
  expect(
    Math.hypot(settled.output.x - panned.output.x, settled.output.y - panned.output.y),
  ).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test('floating navigation preserves distinct silhouettes, actual picking, card actions, and keyboard details', async ({
  page,
}) => {
  const errors = await render(page, '?navigation');
  await page.getByRole('button', { name: 'Shared center' }).click();
  await expect(page.getByTestId('selected')).toHaveText('none');
  await page.waitForTimeout(800);
  const meshes = await visibleMeshes(page);
  expect(Object.keys(meshes).sort()).toEqual(['address', 'creating', 'output', 'spending']);
  expect(meshes.creating.taper).toBeGreaterThan(0.85);
  expect(meshes.output.taper).toBeGreaterThan(meshes.address.taper + 0.1);
  await hover(page, meshes.output);
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  await expect(card).toContainText('10,000 sats');
  await expect(card).toContainText('Saved confirmations');
  const toolbar = card.getByRole('group', { name: 'Graph item actions' });
  const toolbarBounds = (await toolbar.boundingBox())!;
  const factsBounds = (await card.locator('.graph-card-facts').boundingBox())!;
  expect(toolbarBounds.y + toolbarBounds.height).toBeLessThan(factsBounds.y);
  expect(
    (await toolbar.getByRole('button', { name: 'Edit label and notes' }).boundingBox())!.height,
  ).toBeLessThanOrEqual(30);
  await page.screenshot({ path: test.info().outputPath('compact-node-card.png') });
  await card.getByRole('button', { name: /Load previous level|Open creating transaction/ }).hover();
  await page.waitForTimeout(800);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Load previous level|Open creating transaction/ }).click();
  await expect(page.getByTestId('action')).toHaveText(`trace:${outputId}`);
  await page.mouse.move(10, 10);
  await hover(page, meshes.output);
  await card.getByRole('button', { name: 'Edit label and notes' }).click();
  await expect(page.getByLabel('Notes editor')).toBeFocused();
  await expect(page.getByTestId('action')).toHaveText(`edit:${outputId}`);
  await page.mouse.move(10, 10);
  await hover(page, meshes.output);
  await page.mouse.click(meshes.output.x, meshes.output.y);
  await expect(page.getByTestId('selected')).toHaveText(outputId);
  await page.locator('canvas').focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('canvas')).toBeFocused();
  expect(errors).toEqual([]);
});

test('connection hover stays quiet while deliberate connection clicks select the relevant entity', async ({
  page,
}) => {
  const errors = await render(page);
  const meshes = await visibleMeshes(page);
  const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  for (const [point, entity] of [
    [midpoint(meshes.creating, meshes.output), outputId],
    [midpoint(meshes.spending, meshes.output), outputId],
    [midpoint(meshes.address, meshes.output), 'addr:bc1qfixture'],
  ] as const) {
    await page.mouse.move(10, 10);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(700);
    await expect(card).toBeHidden();
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('selected')).toHaveText(entity);
  }
  expect(errors).toEqual([]);
});

test('shared GraphView handles a substitute adapter with identical semantic actions and lifecycle', async ({
  page,
}) => {
  const errors = await render(page, '?contract');
  const toolbar = (await page.getByRole('button', { name: 'Shared fit' }).boundingBox())!;
  const canvas = (await page.locator('canvas').boundingBox())!;
  expect(canvas.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  const navigation = (await page.getByRole('button', { name: 'Shared center' }).boundingBox())!;
  expect(navigation.y).toBeGreaterThanOrEqual(canvas.y);
  expect(navigation.y + navigation.height).toBeLessThan(canvas.y + canvas.height);
  await page.getByRole('button', { name: 'Shared center' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).contract.calls.focus))
    .toContain(outputId);
  await expect(page.getByText('Shared legend')).toBeVisible();
  const emit = (
    type: 'hover' | 'select',
    hit?: { type: 'node' | 'link'; id: string },
    pointerType = 'mouse',
  ) =>
    page.evaluate(
      ({ type, hit, pointerType }) => {
        (window as any).contract.events[type]({ hit, point: { x: 100, y: 100, pointerType } });
      },
      { type, hit, pointerType },
    );
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  await emit('select', { type: 'node', id: outputId });
  await expect(page.getByTestId('selected')).toHaveText(outputId);
  await page.locator('canvas').focus();
  await page.keyboard.press('Enter');
  await expect(card).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('canvas')).toBeFocused();
  for (const [id, entity] of [
    ['create-edge', outputId],
    ['spend-edge', outputId],
    ['address-edge', 'addr:bc1qfixture'],
  ]) {
    await emit('select', { type: 'link', id });
    await expect(page.getByTestId('selected')).toHaveText(entity);
    await emit('hover', { type: 'link', id });
    await page.waitForTimeout(450);
    await expect(card).toBeHidden();
    await emit('hover', { type: 'node', id: entity });
    await expect(card).toBeVisible();
    if (id !== 'address-edge') {
      await card
        .getByRole('button', { name: /Load previous level|Open creating transaction/ })
        .click();
      await expect(page.getByTestId('action')).toHaveText(`trace:${entity}`);
      await emit('hover', { type: 'node', id: entity });
    }
    await card.getByRole('button', { name: 'Edit label and notes' }).click();
    await expect(page.getByTestId('action')).toHaveText(`edit:${entity}`);
    await expect(page.getByLabel('Notes editor')).toBeFocused();
  }
  await page.evaluate(() => (window as any).fixture.setBusy(true));
  await emit('hover', { type: 'node', id: outputId });
  await expect(
    card.getByRole('button', { name: /Load previous level|Open creating transaction/ }),
  ).toBeDisabled();
  await expect(card).toContainText('Another operation is running.');
  await emit('select');
  await expect(card).toBeHidden();
  await page.evaluate(() => (window as any).fixture.setBusy(false));
  await emit('hover', { type: 'node', id: outputId }, 'touch');
  await expect(card).toBeHidden();
  await emit('hover', { type: 'node', id: outputId });
  await expect(card).toBeVisible();
  await page.evaluate(() => (window as any).fixture.setLoaded(false));
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Load data' }).click();
  await page.getByRole('button', { name: 'Fixture fit graph' }).click();
  await page.getByRole('button', { name: 'Focus output' }).click();
  await page.getByRole('button', { name: 'Toggle dimensions' }).click();
  const calls = await page.evaluate(() => (window as any).contract.calls);
  expect(calls.fit).toBe(1);
  expect(calls.focus).toContain(outputId);
  expect(calls.frame.dimensions).toBe(3);
  expect(calls.sizes.length).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).fixture.setShown(false));
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).contract.calls.disposed)).toBe(true);
  expect(errors).toEqual([]);
});

test('fits first data after an empty mount, pans in 2D, focuses and fits, then orbits in 3D', async ({
  page,
}) => {
  const errors = await render(page, '?empty');
  await expect(page.getByText('No visible graph nodes')).toBeVisible();
  await page.getByRole('button', { name: 'Load data' }).click();
  await page.waitForTimeout(7000);
  const initial = await visibleMeshes(page);
  expect(Object.keys(initial).sort()).toEqual(['address', 'creating', 'output', 'spending']);
  const bounds = (await page.locator('canvas').boundingBox())!;
  const drag = async (dx: number, dy: number) => {
    await page.mouse.move(bounds.x + bounds.width - 100, bounds.y + bounds.height - 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 100 + dx, bounds.y + bounds.height - 100 + dy, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(800);
  };
  await drag(-80, -40);
  const panned = await visibleMeshes(page);
  expect(panned.output.x).toBeLessThan(initial.output.x - 30);
  expect(panned.output.y).toBeLessThan(initial.output.y - 15);
  await expect(page.getByTestId('selected')).toHaveText('none');
  await page.getByRole('button', { name: 'Focus output' }).click();
  await page.waitForTimeout(800);
  const focused = await visibleMeshes(page);
  expect(Math.abs(focused.output.x - bounds.x - bounds.width / 2)).toBeLessThan(4);
  expect(Math.abs(focused.output.y - bounds.y - bounds.height / 2)).toBeLessThan(4);
  await page.getByRole('button', { name: 'Fixture fit graph' }).click();
  await page.waitForTimeout(800);
  const fitted = await visibleMeshes(page);
  expect(Object.keys(fitted)).toHaveLength(4);
  await page.getByRole('button', { name: 'Toggle dimensions' }).click();
  await page.waitForTimeout(7000);
  const beforeOrbit = await visibleMeshes(page);
  await drag(-65, 30);
  const afterOrbit = await visibleMeshes(page);
  expect(
    Math.abs(
      afterOrbit.spending.x -
        afterOrbit.creating.x -
        (beforeOrbit.spending.x - beforeOrbit.creating.x),
    ),
  ).toBeGreaterThan(10);
  await expect(page.getByTestId('selected')).toHaveText('none');
  await page.getByRole('button', { name: 'Fixture fit graph' }).click();
  await page.waitForTimeout(800);
  expect(Object.keys(await visibleMeshes(page))).toHaveLength(4);
  await page.screenshot({ path: test.info().outputPath('desktop-force.png') });
  expect(errors).toEqual([]);
});

test('mobile touch taps select without hover and touch drags pan without selection', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = await render(page);
  const meshes = await visibleMeshes(page);
  expect(Object.keys(meshes)).toHaveLength(4);
  await page.touchscreen.tap(meshes.output.x, meshes.output.y);
  await expect(page.getByTestId('selected')).toHaveText(outputId);
  await expect(page.getByRole('dialog', { name: 'Graph item details' })).toBeHidden();
  await page.evaluate(() => (window as any).fixture.setSelected(undefined));
  // Tap the actual creation segment, which resolves to its output in shared React.
  await page.touchscreen.tap(
    (meshes.creating.x + meshes.output.x) / 2,
    (meshes.creating.y + meshes.output.y) / 2,
  );
  await expect(page.getByTestId('selected')).toHaveText(outputId);
  await page.evaluate(() => (window as any).fixture.setSelected(undefined));
  const cdp = await context.newCDPSession(page);
  const bounds = (await page.locator('canvas').boundingBox())!;
  const x = bounds.x + bounds.width - 40,
    y = bounds.y + bounds.height - 80;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 10; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - step * 5, y: y - step * 3 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  await expect(page.getByTestId('selected')).toHaveText('none');
  await expect(page.getByRole('dialog', { name: 'Graph item details' })).toBeHidden();
  const panned = await visibleMeshes(page);
  expect(panned.output.x).toBeLessThan(meshes.output.x - 20);
  const centerX = bounds.x + bounds.width / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 40, y },
      { x: centerX + 40, y },
    ],
  });
  for (let step = 1; step <= 6; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: centerX - 40 - step * 2, y },
        { x: centerX + 40 + step * 2, y },
      ],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  await expect(page.getByTestId('selected')).toHaveText('none');
  await expect(page.getByRole('dialog', { name: 'Graph item details' })).toBeHidden();

  await page.getByRole('button', { name: 'Fixture fit graph' }).tap();
  await page.waitForTimeout(800);
  await page.evaluate((id) => (window as any).fixture.setSelected(id), outputId);
  await page.locator('canvas').focus();
  await page.keyboard.press('Enter');
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  await expect(card).toBeVisible();
  const cardBounds = (await card.boundingBox())!;
  expect(cardBounds.x).toBeGreaterThanOrEqual(0);
  expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('mobile-force.png') });
  await card.getByRole('button', { name: 'Edit label and notes' }).tap();
  await expect(page.getByLabel('Notes editor')).toBeFocused();
  expect(errors).toEqual([]);
  await context.close();
});

test('first data loaded while the canvas is hidden fits on reveal', async ({ page }) => {
  const errors = await render(page, '?empty');
  await page.evaluate(() => (window as any).fixture.setHidden(true));
  await expect(page.locator('canvas')).toBeHidden();
  await page.getByRole('button', { name: 'Load data' }).click();
  await page.waitForTimeout(7000);
  await page.evaluate(() => (window as any).fixture.setHidden(false));
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  expect(Object.keys(await visibleMeshes(page)).sort()).toEqual([
    'address',
    'creating',
    'output',
    'spending',
  ]);
  expect(errors).toEqual([]);
});

test('fit keeps nodes visible and selectable in a short transaction-panel canvas', async ({
  page,
}) => {
  const errors = await render(page);
  await page.addStyleTag({
    content:
      '#fixture-graph { height: 110px !important; width: 390px !important; } .graph-view { min-height: 0; }',
  });
  await expect.poll(async () => (await page.locator('canvas').boundingBox())?.height).toBe(110);
  await page.getByRole('button', { name: 'Fixture fit graph' }).click();
  await page.waitForTimeout(800);
  const meshes = await visibleMeshes(page);
  expect(Object.keys(meshes).sort()).toEqual(['address', 'creating', 'output', 'spending']);
  // The short viewport may place the hover card over its node. Its title remains
  // an explicit selection action instead of requiring a click through the card.
  await hover(page, meshes.output);
  const select = page.getByRole('button', { name: 'Select graph item', exact: true });
  await expect(select).toBeInViewport({ ratio: 1 });
  await select.click();
  await expect(page.getByTestId('selected')).toHaveText(outputId);
  expect(errors).toEqual([]);
});

test('fit protects an upper label from floating navigation and reframes a resized flow area without undoing gestures', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await render(page, '?caption-fit');
  await page.addStyleTag({ content: '.graph-view { min-height: 0; }' });
  const canvas = page.locator('canvas');
  const captionBounds = async () => {
    await captureGraphPixels(canvas, true);
    return canvas.evaluate(
      (canvas) =>
        new Promise<{ top: number; pixels: number }>((resolve) =>
          requestAnimationFrame(() => {
            const { width, height, pixels } = (canvas as SampledCanvas).testPixels;
            let top = height,
              count = 0;
            for (let y = 0; y < height; y++)
              for (let x = 0; x < width; x++) {
                const at = (y * width + x) * 4;
                const colors = [pixels[at], pixels[at + 1], pixels[at + 2]];
                if (Math.min(...colors) > 120 && Math.max(...colors) - Math.min(...colors) < 35) {
                  top = Math.min(top, height - 1 - y);
                  count++;
                }
              }
            resolve({
              top: canvas.getBoundingClientRect().top + (top / height) * canvas.clientHeight,
              pixels: count,
            });
          }),
        ),
    );
  };
  const assertCaptionClear = async () => {
    const navigation = (await page.getByRole('button', { name: 'Shared center' }).boundingBox())!;
    await expect.poll(async () => (await captionBounds()).pixels).toBeGreaterThan(20);
    await expect
      .poll(async () => (await captionBounds()).top)
      .toBeGreaterThan(navigation.y + navigation.height + 4);
  };
  await page.getByRole('button', { name: 'Fixture fit graph', exact: true }).click();
  await assertCaptionClear();
  await page.screenshot({ path: test.info().outputPath('fit-upper-caption.png') });
  await page.locator('#fixture-graph').evaluate((element) => (element.style.height = '280px'));
  await expect.poll(async () => (await canvas.boundingBox())?.height).toBe(280);
  await assertCaptionClear();
  await page.screenshot({ path: test.info().outputPath('fit-upper-caption-short-flow.png') });
  // Fit uses the current annotation dimensions after an edit, without remounting.
  await page.evaluate(() =>
    (window as any).fixture.setCaption('Followed output with a longer annotation'),
  );
  await page.getByRole('button', { name: 'Fixture fit graph', exact: true }).click();
  await assertCaptionClear();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.8 + 35, bounds.y + bounds.height * 0.75 - 15, {
    steps: 6,
  });
  await page.mouse.up();
  await page.waitForTimeout(1600);
  const camera = await page.evaluate(() =>
    JSON.stringify((window as any).lastGraphSnapshot.camera),
  );
  await page.locator('#fixture-graph').evaluate((element) => (element.style.height = '420px'));
  await expect.poll(async () => (await canvas.boundingBox())?.height).toBe(420);
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => JSON.stringify((window as any).lastGraphSnapshot.camera))).toBe(
    camera,
  );
  expect(errors).toEqual([]);
});

test('annotation captions render over the graph and all three display toggles remove them', async ({
  page,
}) => {
  const errors = await render(page, '?captions');
  const captionPixels = async () => {
    await captureGraphPixels(page.locator('canvas'), true);
    return page.locator('canvas').evaluate(
      (canvas) =>
        new Promise<number>((resolve) =>
          requestAnimationFrame(() => {
            const { pixels } = (canvas as SampledCanvas).testPixels;
            let count = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
              const colors = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
              if (Math.min(...colors) > 120 && Math.max(...colors) - Math.min(...colors) < 35)
                count++;
            }
            resolve(count);
          }),
        ),
    );
  };
  await expect.poll(captionPixels).toBeGreaterThan(40);
  const visibleCaptionPixels = await captionPixels();
  await page.screenshot({ path: test.info().outputPath('graph-annotation-captions.png') });
  await page.evaluate(() => {
    const fixture = (window as any).fixture;
    fixture.setLabels(false);
    fixture.setTags(false);
    fixture.setIcons(false);
  });
  // Specular highlights on node meshes can also be nearly white. Measure the
  // stable no-caption baseline, then require each independent toggle to add
  // visible text and return to exactly that baseline.
  await expect.poll(captionPixels).toBeLessThan(visibleCaptionPixels / 10);
  const meshHighlights = await captionPixels();
  for (const setter of ['setLabels', 'setTags', 'setIcons']) {
    await page.evaluate((setter) => (window as any).fixture[setter](true), setter);
    await expect.poll(captionPixels).toBeGreaterThan(meshHighlights + 5);
    await page.evaluate((setter) => (window as any).fixture[setter](false), setter);
    await expect.poll(captionPixels).toBe(meshHighlights);
  }
  expect(errors).toEqual([]);
});

test('hover dwell ignores passing nodes and the compact card stays usable at a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await render(page, '?contract');
  const emit = (hit?: { type: 'node' | 'link'; id: string }) =>
    page.evaluate((hit) => {
      (window as any).contract.events.hover({
        hit,
        point: { x: 360, y: 510, pointerType: 'mouse' },
      });
    }, hit);
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  for (let index = 0; index < 8; index++) {
    await emit({ type: 'node', id: index % 2 ? outputId : `tx:${'a'.repeat(64)}` });
    await page.waitForTimeout(20);
    await emit({ type: 'link', id: 'create-edge' });
  }
  await expect(card).toBeHidden();
  await emit({ type: 'node', id: outputId });
  await expect(card).toBeVisible();
  const bounds = (await card.boundingBox())!;
  const canvas = (await page.locator('canvas').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(canvas.x);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  const edit = card.getByRole('button', { name: 'Edit label and notes' });
  await edit.hover();
  await emit({ type: 'node', id: `tx:${'b'.repeat(64)}` });
  await page.waitForTimeout(700);
  await expect(card.getByTitle(outputId.slice(4), { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('narrow-node-card.png') });
  await edit.click();
  await expect(page.getByLabel('Notes editor')).toBeFocused();
  await expect(card).toBeHidden();
  expect(errors).toEqual([]);
});
