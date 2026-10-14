import assert from 'node:assert/strict';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

// Inspect the emitted static artifact only. No server, browser or chain requests.
const root = await realpath(resolve(process.argv[2] ?? 'dist-demo'));
const entries = await readdir(root, { recursive: true, withFileTypes: true });
assert(!entries.some((entry) => entry.isSymbolicLink()), 'Pages assets must not contain symlinks.');
const files = entries
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name));
const html = (await readFile(resolve(root, 'index.html'), 'utf8')).replaceAll('&#39;', "'");
const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
assert(script?.includes('/assets/'), 'Expected a bundled application entry.');
const base = script.slice(0, script.indexOf('/assets/') + 1);
assert(base.startsWith('/') && !base.startsWith('//'), 'Expected a same-origin base path.');
assert(
  html.indexOf('Content-Security-Policy') >= 0 &&
    html.indexOf('Content-Security-Policy') < html.indexOf('<script'),
  'Demo CSP must precede scripts.',
);
assert(
  html.includes("worker-src 'self' blob:") && html.includes("object-src 'none'"),
  'Demo CSP is missing.',
);
assert(html.includes('name="referrer" content="no-referrer"'), 'Demo referrer policy is missing.');
const emitted = new Set(files);
const origin = 'https://static.invalid';
function checkReference(reference, from = 'index.html') {
  if (reference.startsWith('data:')) return;
  const url = new URL(reference, `${origin}${base}${from}`);
  assert(
    url.origin === origin && url.pathname.startsWith(base),
    `Asset leaves the build base: ${reference}`,
  );
  const file = resolve(root, decodeURIComponent(url.pathname.slice(base.length)));
  assert(file.startsWith(root + sep) && emitted.has(file), `Missing emitted asset: ${reference}`);
}
for (const [, reference] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) checkReference(reference);
let workers = 0,
  fonts = 0,
  snapshots = 0;
let javascript = '';
for (const file of files) {
  const relative = file.slice(root.length + 1).replaceAll('\\', '/');
  if (extname(file) === '.js') {
    const source = await readFile(file, 'utf8');
    javascript += source;
    if (relative.includes('.worker-')) workers++;
    for (const [, reference] of source.matchAll(/["'](\/[^"'\s]+\.(?:js|json|css|woff2))["']/g))
      checkReference(reference, relative);
    for (const [, reference] of source.matchAll(
      /\b(?:from|import(?:\s*\()?)\s*["'](\.[^"']+\.js)["']/g,
    ))
      checkReference(reference, relative);
  }
  if (extname(file) === '.css') {
    const source = await readFile(file, 'utf8');
    for (const [, reference] of source.matchAll(/url\(["']?([^"')]+)["']?\)/g))
      checkReference(reference, relative);
  }
  if (file.endsWith('.woff2')) fonts++;
  if (/demo-(public-wallet|branching-path|equal-outputs)-[^/]+\.json$/.test(file)) snapshots++;
}
assert(
  workers >= 4 && fonts >= 2 && snapshots === 3,
  'Expected demo workers, fonts and three captured investigations.',
);
for (const endpoint of ['/api/rpc', '/api/networks', '/api/status'])
  assert(!javascript.includes(endpoint), 'Live chain transport was emitted in the demo.');
assert(
  javascript.includes(`${base}examples/bip329/`),
  'Public download links do not use the build base.',
);
for (const file of ['sparrow', 'review-cases'])
  checkReference(`${base}examples/bip329/${file}.jsonl`);
console.log(
  `Demo artifact passed: base ${base}, ${files.length} files, ${workers} workers, ${fonts} fonts, ${snapshots} snapshots. No browser or live requests.`,
);
