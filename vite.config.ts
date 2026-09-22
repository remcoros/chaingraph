import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const defaultSource = 'https://github.com/remcoros/chaingraph';
const source = process.env.CHAINGRAPH_SOURCE_URL ?? defaultSource;
if (source && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(source))
  throw new Error('CHAINGRAPH_SOURCE_URL must be an HTTPS GitHub repository URL.');
export default defineConfig({
  plugins: [
    react({
      // React Compiler memoizes components and hooks automatically, which is the
      // safety net for a UI written with almost no hand-rolled useCallback/memo.
      //
      // App also owns pure helpers used by workers, not just React modules.
      // oxc-transform-react can register capitalised constants for Fast Refresh
      // even without JSX. Workers have no $RefreshReg$ runtime: instrumenting
      // tagColors.ts broke example creation before its message handler loaded.
      // Compile JSX modules and the use*.ts hook modules, not whole folders.
      // Keep explicit extensions so imported CSS is not parsed as JavaScript.
      // devWorkers.test.ts guards worker graphs and React compilation together.
      include: [
        /\/src\/(App|Shared)\/.*\.[jt]sx$/,
        /\/src\/(App|Shared)\/(?:.*\/)?use[A-Z0-9][^/]*\.[jt]s$/,
      ],
      compiler: { logDiagnostics: true },
    }),
  ],
  envDir: false,
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __SOURCE_URL__: JSON.stringify(source.replace(/\/$/, '')),
  },
  server: {
    port: 3001,
    strictPort: true,
    watch: {
      // Git checkouts and editor writes can briefly leave modules empty. Wait
      // for the completed write before invalidating and transforming for HMR.
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 25 },
    },
    proxy: {
      '/api': {
        target: process.env.CHAINGRAPH_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        // Preserve the browser-facing Host so the backend can validate the
        // same-origin request on a separate local preview port.
        changeOrigin: false,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    // Template snapshots are fetched and JSON.parsed at runtime. Small ones
    // would otherwise be inlined as base64 data URLs, which both bloats the
    // chunk that holds them and gives two of the nine templates a different
    // loading path from the rest. Keep every snapshot an emitted file.
    assetsInlineLimit: (filePath: string) =>
      /templateData\/.*\.json$/.test(filePath) ? false : undefined,
  },
  // `vite preview` does not inherit `server.proxy`. Mirror it so a production
  // build can be exercised against a local backend the same way the dev server
  // is.
  preview: {
    proxy: {
      '/api': {
        target: process.env.CHAINGRAPH_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
});
