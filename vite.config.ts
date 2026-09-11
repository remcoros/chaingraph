import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const source = process.env.CHAINGRAPH_SOURCE_URL ?? '';
if (source && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(source))
  throw new Error('CHAINGRAPH_SOURCE_URL must be an HTTPS GitHub repository URL.');
export default defineConfig(({ command }) => ({
  plugins: [
    react({
      // React Compiler memoizes components and hooks automatically, which is the
      // safety net for a UI written with almost no hand-rolled useCallback/memo.
      //
      // Build-only on purpose. With @vitejs/plugin-react 6.1.1, enabling the
      // compiler also changes the Fast Refresh hook-signature instrumentation it
      // emits ($RefreshSig$ registrations that are absent otherwise). In the dev
      // server that remounts the workspace store and drops the unlocked session,
      // so unlocking a workspace silently returns to the home screen. Verified by
      // A/B on unmodified sources: dev + compiler fails the e2e smoke test, dev
      // without it passes, and a production build with it passes. The breakage is
      // not memoization: it reproduces with 'use no memo' on every source file.
      // Revisit once the plugin's dev-mode refresh handling is fixed.
      compiler: command === 'build' ? { logDiagnostics: true } : false,
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
  // build, which is the only build React Compiler runs on, can be exercised
  // against a local backend the same way the dev server is.
  preview: {
    proxy: {
      '/api': {
        target: process.env.CHAINGRAPH_PROXY_TARGET ?? 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
}));
