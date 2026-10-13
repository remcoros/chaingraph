import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from './app';
import { loadConfig, loadNetworkConfig } from './config';

let directory: string;
let base: string;
let server: http.Server;
let application: ReturnType<typeof createApp>;

const assets = {
  'assets/index-Ab12_-cd.js': 'export const value = 1;',
  'assets/index-Ab12_-cd.css': 'body { color: black; }',
  'assets/example-Ab12_-cd.json': '{"publicFixture":true}',
  'assets/workspaceCodec.worker-Ab12_-cd.js': 'self.onmessage = () => {};',
  'assets/font-Ab12_-cd.woff2': 'synthetic-font',
};

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'chaingraph-static-assets-'));
  await mkdir(path.join(directory, 'assets'));
  for (const [file, content] of Object.entries({
    ...assets,
    'index.html': '<html>public application fixture</html>',
    'favicon.svg': '<svg></svg>',
    'assets/unversioned.js': 'export const value = 2;',
    'outside-Ab12_-cd.js': 'export const value = 3;',
    'assets/help-Ab12_-cd.html': '<html>public help fixture</html>',
  })) {
    await writeFile(path.join(directory, file), content);
  }
  const network = loadNetworkConfig('testnet4', {
    BITCOIN_RPC_URL: 'http://127.0.0.1:9',
    BITCOIN_RPC_USER: 'public-fixture',
    BITCOIN_RPC_PASSWORD: 'synthetic-password',
    FULCRUM_HOST: '127.0.0.1',
    FULCRUM_PORT: '9',
  });
  application = createApp(loadConfig({}, { testnet4: network }), {
    staticDirectory: directory,
  });
  server = http.createServer(application.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  application?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('allows long-lived reuse of hashed build assets, including workers and query strings', async () => {
  for (const [file, content] of Object.entries(assets)) {
    const response = await fetch(`${base}/${file}?version=fixture`);
    expect(response.status, file).toBe(200);
    expect(response.headers.get('cache-control'), file).toBe('public, max-age=31536000, immutable');
    expect(await response.text(), file).toBe(content);
  }
});

it('revalidates the application document, client routes and missing asset fallbacks', async () => {
  for (const route of ['/', '/index.html', '/workspace/fixture', '/assets/missing-Ab12_-cd.js']) {
    const response = await fetch(`${base}${route}`);
    expect(response.headers.get('content-type'), route).toMatch(/text\/html/);
    expect(response.headers.get('cache-control'), route).toBe('no-cache');
  }
});

it('keeps unversioned files, files outside assets and HTML out of the immutable cache', async () => {
  for (const file of [
    'favicon.svg',
    'assets/unversioned.js',
    'outside-Ab12_-cd.js',
    'assets/help-Ab12_-cd.html',
  ]) {
    const response = await fetch(`${base}/${file}`);
    expect(response.status, file).toBe(200);
    expect(response.headers.get('cache-control'), file).toBe('no-cache');
  }
});

it('serves updated HTML after revalidation instead of retaining the previous deployment', async () => {
  const original = await fetch(`${base}/`);
  const etag = original.headers.get('etag');
  expect(etag).not.toBeNull();
  const headers = { 'if-none-match': etag! };
  const unchanged = await fetch(`${base}/workspace/fixture`, { headers, cache: 'no-cache' });
  expect(unchanged.status).toBe(304);
  expect(unchanged.headers.get('cache-control')).toBe('no-cache');

  const updated = '<html>updated public application deployment fixture</html>';
  await writeFile(path.join(directory, 'index.html'), updated);
  const response = await fetch(`${base}/workspace/fixture`, { headers, cache: 'no-cache' });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-cache');
  expect(await response.text()).toBe(updated);
});

it('never stores API discovery or API error responses', async () => {
  const discovery = await fetch(`${base}/api/networks`);
  expect(discovery.headers.get('cache-control')).toBe('no-store');
  expect(await discovery.json()).toEqual({ networks: ['testnet4'] });
  const missing = await fetch(`${base}/api/missing-Ab12_-cd.js`);
  expect(missing.status).toBe(404);
  expect(missing.headers.get('cache-control')).toBe('no-store');
});
