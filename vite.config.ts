import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const source = process.env.CHAINGRAPH_SOURCE_URL ?? '';
if (source && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(source))
  throw new Error('CHAINGRAPH_SOURCE_URL must be an HTTPS GitHub repository URL.');
export default defineConfig({
  plugins: [
    react({
      // React Compiler memoizes components and hooks automatically, which is the
      // safety net for a UI written with almost no hand-rolled useCallback/memo.
      //
      // Scoped to where React actually lives. Enabling the compiler hands the
      // TypeScript, JSX and Fast Refresh transforms to oxc-transform-react, and
      // its refresh pass instruments every file it is given rather than only
      // files containing JSX. A module with no JSX still gains $RefreshReg$
      // registration for each capitalised export.
      //
      // Web workers have no Fast Refresh runtime, so any such module in a
      // worker's import graph throws 'ReferenceError: $RefreshReg$ is not
      // defined' and the worker dies on load. Unlocking a workspace then failed
      // with "The workspace worker stopped" and returned to the home screen. In
      // this project the encryption worker reached both a Domain module of
      // colour constants and, through dependency prebundling, bitcoinjs-lib.
      //
      // Domain and Infra hold no React, which the import boundaries in
      // .oxlintrc.json already enforce, so naming App and Shared states that
      // rather than working around the transform. The filter must keep the
      // extension test: include replaces the default one, and without it the
      // plugin tries to parse imported CSS as JavaScript.
      include: [/\/src\/(App|Shared)\/.*\.[jt]sx?$/],
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
