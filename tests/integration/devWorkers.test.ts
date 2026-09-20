import { readFileSync, readdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build, transform } from 'esbuild';
import { transformSync } from 'oxc-transform-react';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer, loadConfigFromFile, type ViteDevServer } from 'vite';

let server: ViteDevServer;

beforeAll(async () => {
  // Load the real dev config. SSR tests and production builds do not run the
  // client Fast Refresh transform that can break worker-only dependencies.
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    'vite.config.ts',
  );
  if (!loaded) throw new Error('Could not load the Vite development configuration.');
  server = await createServer({
    ...loaded.config,
    configFile: false,
    mode: 'development',
    logLevel: 'silent',
    server: { ...loaded.config.server, middlewareMode: true, watch: null },
    optimizeDeps: { ...loaded.config.optimizeDeps, noDiscovery: true, include: [] },
  });
});

afterAll(async () => {
  await server?.close();
});

it('runs the transform checks without watching the repository', () => {
  expect(server.config.server.watch).toBeNull();
});

it('can evaluate the example worker tag palette without a React window runtime', async () => {
  const result = await server.transformRequest('/src/App/Controls/Metadata/tagColors.ts');
  expect(result).not.toBeNull();
  const { code } = await transform(result!.code, { format: 'cjs' });
  const module = { exports: {} as { TAG_COLORS: string[] } };
  runInNewContext(code, { module, exports: module.exports });
  expect(module.exports.TAG_COLORS).toContain('#65cbbb');
});

it('keeps every worker source dependency free of React development instrumentation', async () => {
  const workers = readdirSync('src', { recursive: true })
    .filter((path): path is string => typeof path === 'string' && path.endsWith('.worker.ts'))
    .map((path) => `src/${path}`);
  expect(workers).toContain('src/App/Examples/templateWorkspace.worker.ts');
  const result = await build({
    entryPoints: workers,
    bundle: true,
    write: false,
    outdir: 'artifacts/dev-worker-check',
    metafile: true,
    format: 'esm',
    platform: 'browser',
    external: ['node:*'],
    loader: { '.json': 'file' },
    logLevel: 'silent',
  });
  const modules = Object.keys(result.metafile.inputs).filter((path) =>
    /^src\/.*\.tsx?$/.test(path),
  );
  expect(modules).toContain('src/App/Controls/Metadata/tagColors.ts');
  for (const path of modules) {
    const transformed = await server.transformRequest(`/${path}`);
    expect(transformed, path).not.toBeNull();
    expect(transformed!.code, path).not.toMatch(/\$Refresh(?:Reg|Sig)\$|@react-refresh/);
    expect(transformed!.code, path).not.toMatch(/react[/_]compiler-runtime/);
  }
});

it.each(['/src/App/App.tsx', '/src/App/useAppState.ts'])(
  'preserves React compilation and Fast Refresh for %s',
  async (path) => {
    const result = await server.transformRequest(path);
    expect(result?.code).toMatch(/react[/_]compiler-runtime/);
    expect(result?.code).toMatch(/\$Refresh(?:Reg|Sig)\$/);
  },
);

it('does not silently drop memoization for hook modules outside the filename convention', async () => {
  for (const path of readdirSync('src', { recursive: true })) {
    if (typeof path !== 'string' || !path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
    const file = `src/${path}`;
    const source = readFileSync(file, 'utf8');
    if (!/\buse[A-Z0-9]/.test(source)) continue;
    const compiled = transformSync(file, source, {});
    if (!compiled.code.includes('react/compiler-runtime')) continue;
    const served = await server.transformRequest(`/${file}`);
    expect(served?.code, file).toMatch(/react[/_]compiler-runtime/);
  }
});
