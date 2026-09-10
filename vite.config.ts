import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const source = process.env.CHAINGRAPH_SOURCE_URL ?? '';
if (source && !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/?$/.test(source))
  throw new Error('CHAINGRAPH_SOURCE_URL must be an HTTPS GitHub repository URL.');
export default defineConfig({
  plugins: [react()],
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
  build: { chunkSizeWarningLimit: 1500 },
});
