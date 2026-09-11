import assert from 'node:assert/strict';

// No browser or upstream RPC: verify the real production HTTP surface.
const base = new URL(process.env.CHAINGRAPH_SMOKE_URL ?? 'http://127.0.0.1:4300');
let step = 'application document';
async function get(url: URL) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  return response;
}
try {
  const document = await get(base);
  assert.match(document.headers.get('content-type') ?? '', /text\/html/);
  const directives = new Map(
    (document.headers.get('content-security-policy') ?? '')
      .split(';')
      .filter((part) => part.trim())
      .map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values];
      }),
  );
  for (const name of ['default-src', 'script-src', 'connect-src'])
    assert.deepEqual(directives.get(name), ["'self'"]);
  for (const name of ['object-src', 'base-uri', 'frame-ancestors'])
    assert.deepEqual(directives.get(name), ["'none'"]);
  const workers = directives.get('worker-src') ?? [];
  assert.ok(workers.includes("'self'"));
  assert.ok(workers.every((source) => ["'self'", 'blob:'].includes(source)));

  step = 'built JavaScript and stylesheet assets';
  const html = await document.text();
  assert.ok(!html.includes('/@vite/client'));
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
    (match) => new URL(match[1], base),
  );
  assert.ok(assets.some((asset) => asset.pathname.endsWith('.js')));
  assert.ok(assets.some((asset) => asset.pathname.endsWith('.css')));
  for (const asset of assets) {
    assert.equal(asset.origin, base.origin);
    assert.ok(asset.pathname.startsWith('/assets/'));
    const response = await get(asset);
    assert.match(
      response.headers.get('content-type') ?? '',
      asset.pathname.endsWith('.css') ? /text\/css/ : /(?:text|application)\/javascript/,
    );
    assert.ok((await response.text()).length > 0);
  }

  step = 'configured network discovery';
  const discovery = await get(new URL('/api/networks', base));
  assert.equal(discovery.headers.get('cache-control'), 'no-store');
  const { networks } = await discovery.json();
  assert.ok(Array.isArray(networks) && networks.length > 0);
  assert.equal(new Set(networks).size, networks.length);
  assert.ok(networks.every((network) => ['mainnet', 'testnet4'].includes(network)));
  console.log(
    'Production HTTP smoke passed: built assets, security headers, configured networks. No upstream requests.',
  );
} catch {
  console.error(`Production HTTP smoke failed at ${step}.`);
  process.exitCode = 1;
}
