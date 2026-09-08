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
    '<link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/main.jsx"></script>',
  );
  await writeFile(
    path.join(fixtureRoot, 'main.jsx'),
    `
import React from 'react';
import {createRoot} from 'react-dom/client';
import Graph from ${JSON.stringify(`/@fs${path.join(process.cwd(), 'src/components/GraphView.tsx')}`)};
const a='a'.repeat(64), b='b'.repeat(64), address='bc1qfixture';
const nodes=Object.freeze([
 {id:'tx:'+a,kind:'transaction',txid:a,label:'Creating transaction',value:10000,x:-100,y:0,z:0,fx:-100,fy:0,fz:0},
 {id:'out:'+a+':0',kind:'output',txid:a,vout:0,label:'Fixture output',value:10000,address,x:0,y:0,z:0,fx:0,fy:0,fz:0},
 {id:'tx:'+b,kind:'transaction',txid:b,label:'Spending transaction',value:9000,x:100,y:0,z:0,fx:100,fy:0,fz:0},
 {id:'addr:'+address,kind:'address',address,label:'Fixture address',x:0,y:80,z:0,fx:0,fy:80,fz:0},
].map(Object.freeze));
const links=Object.freeze([
 {id:'create-edge',source:'tx:'+a,target:'out:'+a+':0',kind:'creates'},
 {id:'spend-edge',source:'out:'+a+':0',target:'tx:'+b,kind:'spends'},
 {id:'address-edge',source:'out:'+a+':0',target:'addr:'+address,kind:'address'},
].map(Object.freeze));
const transactions={ [a]:{txid:a,vin:[{coinbase:'00'}],vout:[{n:0,value:0.0001,scriptPubKey:{address}}],confirmations:2} };
function App(){const [selected,setSelected]=React.useState();const [action,setAction]=React.useState('none');
return <><input id="notes" aria-label="Notes editor"/><output data-testid="action">{action}</output><output data-testid="selected">{selected||'none'}</output>
<div style={{position:'relative',height:'600px',width:'900px','--color-paper':'#111a20','--color-muted':'#74818b','--color-accent':'#eab66b'}}>
<Graph nodes={nodes} links={links} transactions={transactions} selectedId={selected} onSelect={setSelected} dimensions={2} sizeBy="uniform" glow={false} fitToken={0}
onTrace={id=>setAction('trace:'+id)} onEdit={id=>{setAction('edit:'+id);document.getElementById('notes').focus();}}/>
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

async function render(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(origin);
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(7000);
  return errors;
}

// Read the rendered frame during RAF before compositing clears its back buffer.
// Colors identify the visible meshes; interactions below still use mouse picking.
async function visibleMeshes(page: Page) {
  const bounds = await page.locator('canvas').boundingBox();
  if (!bounds) throw new Error('Missing graph canvas');
  const meshes = await page.locator('canvas').evaluate(
    (canvas) =>
      new Promise<Record<string, { x: number; y: number; taper: number }>>((resolve) =>
        requestAnimationFrame(() => {
          const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
          const width = gl.drawingBufferWidth,
            height = gl.drawingBufferHeight;
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const groups: Record<string, { xs: number[]; ys: number[] }> = {};
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const i = (y * width + x) * 4,
                r = pixels[i],
                g = pixels[i + 1],
                b = pixels[i + 2];
              if (Math.max(r, g, b) < 60) continue;
              const kind =
                r > g * 1.1 && r > b * 1.2
                  ? x < width / 2
                    ? 'creating'
                    : 'spending'
                  : g > r * 1.13 && g > b * 1.03
                    ? 'output'
                    : b > r * 1.15 && b > g * 1.13
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

test('renders distinct silhouettes and supports actual node hover, card actions, and keyboard details', async ({
  page,
}) => {
  const errors = await render(page);
  const meshes = await visibleMeshes(page);
  expect(Object.keys(meshes).sort()).toEqual(['address', 'creating', 'output', 'spending']);
  expect(meshes.creating.taper).toBeGreaterThan(0.85);
  expect(meshes.output.taper).toBeGreaterThan(meshes.address.taper + 0.1);
  await hover(page, meshes.output);
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  await expect(card).toContainText('10,000 sats');
  await expect(card).toContainText('Saved confirmations');
  await card.getByRole('button', { name: 'Load previous level' }).hover();
  await page.waitForTimeout(800);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Load previous level' }).click();
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

test('picks creation, spending, and address links and routes actions to their relevant entity', async ({
  page,
}) => {
  const errors = await render(page);
  const meshes = await visibleMeshes(page);
  const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const card = page.getByRole('dialog', { name: 'Graph item details' });
  for (const [kind, point] of [
    ['Creates output', midpoint(meshes.creating, meshes.output)],
    ['Spends output', midpoint(meshes.spending, meshes.output)],
  ] as const) {
    await page.mouse.move(10, 10);
    await hover(page, point);
    await expect(card.locator('.graph-card-heading')).toContainText(kind);
    await card.getByRole('button', { name: 'Load previous level' }).click();
    await expect(page.getByTestId('action')).toHaveText(`trace:${outputId}`);
  }
  await page.mouse.move(10, 10);
  await hover(page, midpoint(meshes.address, meshes.output));
  await expect(card.locator('.graph-card-heading')).toContainText('Address association');
  await expect(card).toContainText('does not establish common ownership');
  await expect(card.getByRole('button', { name: 'Load previous level' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Edit label and notes' }).click();
  await expect(page.getByTestId('action')).toHaveText('edit:addr:bc1qfixture');
  await expect(page.getByLabel('Notes editor')).toBeFocused();
  expect(errors).toEqual([]);
});
