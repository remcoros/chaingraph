// Pre-compresses built static assets so the server can serve them without
// spending CPU per request.
//
// Chaingraph is self-hosted and often reached over a LAN, VPN or tunnel, where
// transfer dominates. The largest asset is a ~9.9 MB workspace template
// snapshot that gzips to roughly 2 MB. Compressing at build time keeps the
// runtime a plain static file server with no compression dependency.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.html', '.svg', '.map', '.txt']);
// Below roughly one packet there is nothing to win.
const MIN_BYTES = 1024;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

const root = process.argv[2] ?? 'dist';
let count = 0;
let original = 0;
let compressed = 0;

for await (const file of files(root)) {
  if (file.endsWith('.gz') || file.endsWith('.br')) continue;
  if (!COMPRESSIBLE.has(path.extname(file))) continue;
  const { size } = await stat(file);
  if (size < MIN_BYTES) continue;
  const source = await readFile(file);
  const gzip = gzipSync(source, { level: 9 });
  const brotli = brotliCompressSync(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
    },
  });
  // Only keep an encoding that actually pays for itself.
  if (gzip.length < size) await writeFile(`${file}.gz`, gzip);
  if (brotli.length < size) await writeFile(`${file}.br`, brotli);
  count++;
  original += size;
  compressed += Math.min(gzip.length, brotli.length);
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
console.log(
  `Pre-compressed ${count} assets: ${mb(original)} MB to ${mb(compressed)} MB best-encoding.`,
);
